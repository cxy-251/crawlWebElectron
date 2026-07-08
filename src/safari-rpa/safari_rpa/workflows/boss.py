from __future__ import annotations

import csv
import io
import random
import re
from collections import Counter
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

from safari_rpa.contracts.errors import RpaError
from safari_rpa.contracts.runtime import JsonObject, RetryPolicy, WorkflowContextPort, WorkflowDescriptor
from safari_rpa.sites.boss import BossPageAdapter
from safari_rpa.sites.common import page_ref_from_dict, page_ref_to_dict


class BossWorkflow:
    descriptor = WorkflowDescriptor(
        id="boss.search-and-communicate.v1",
        version="1.0.0",
        title="Boss job search, filtering, and optional communication",
        capabilities=("safari.dom", "safari.navigation", "safari.write.click"),
        config_schema={
            "type": "object",
            "required": ["search"],
            "properties": {
                "search": {"type": "object"},
                "criteria": {"type": "object"},
                "limits": {"type": "object"},
                "ordering": {"type": "object"},
                "communication": {"type": "object"},
                "profile": {"type": "string"},
                "profiles": {"type": "object"},
            },
        },
    )

    async def execute(self, context: WorkflowContextPort) -> JsonObject:
        config = self._config(context.config)
        adapter = BossPageAdapter(context.safari)
        today = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        initial_effects = await context.list_completed_side_effects("communicate.", today)
        initial_confirmed = self._confirmed_effects(initial_effects)
        report_date = datetime.now().astimezone().strftime("%Y-%m-%d")
        report_id = f"boss-confirmed-daily-{report_date}"

        async def materialize_daily_report() -> tuple[Any, list[JsonObject]]:
            effects = await context.list_completed_side_effects("communicate.", today)
            records = [self._ledger_record(effect, output) for effect, output in self._confirmed_effects(effects)]
            report = await context.write_daily_report(
                report_id, report_date, self._csv(records), record_count=len(records),
                metadata={"date": report_date, "source": "confirmed_side_effects"},
            )
            return report, records

        # Rebuild first so a prior database commit is repaired after a crash before any new browser action.
        daily_report, _ = await materialize_daily_report()
        daily_completed = len(initial_confirmed)
        run_completed = sum(1 for effect, _ in initial_confirmed if effect.run_id == context.run_id)
        remaining_daily = max(0, config["limits"]["daily"] - daily_completed)
        remaining_run = max(0, config["limits"]["run"] - run_completed)
        target_new = min(remaining_daily, remaining_run) if config["communication"]["enabled"] else 0
        prior_by_city = Counter(
            str(output.get("city_code") or "") for _, output in initial_confirmed if output.get("city_code")
        )
        keywords = self._keywords(config["search"])
        cities = config["search"]["cities"]
        collection_records: list[dict[str, Any]] = []
        matched = 0
        rejected = 0
        already_communicated = 0
        unavailable = 0
        experience_mismatch_skipped = 0
        scanned = 0
        newly_confirmed = 0
        seen: set[str] = set()
        city_order: list[JsonObject] = []

        should_scan = not config["communication"]["enabled"] or target_new > 0
        if should_scan:
            async def ensure() -> JsonObject:
                return page_ref_to_dict(await adapter.ensure_page())

            page_data = await context.step("session.ensure_site", ensure, retry=RetryPolicy(max_attempts=2))
            page = page_ref_from_dict(page_data)

            async def plan_city_order() -> JsonObject:
                start = random.randrange(len(cities)) if config["ordering"]["strategy"] == "random_rotated" else 0
                ordered = cities[start:] + cities[:start]
                return {"strategy": config["ordering"]["strategy"], "start_index": start, "cities": ordered}

            order_data = await context.step("plan.city_order", plan_city_order, retry=RetryPolicy(max_attempts=1))
            city_order = [dict(city) for city in order_data.get("cities", []) if isinstance(city, dict)]

            stop_run = False
            # Iterate up to 3 passes as requested to find new jobs
            for idx, city in enumerate(city_order * 3):
                scan_pass = idx // max(1, len(city_order))
                if stop_run:
                    break
                city_code = str(city["code"])
                city_remaining = max(0, config["limits"]["per_city"] - prior_by_city.get(city_code, 0))
                if config["communication"]["enabled"] and city_remaining == 0:
                    await context.emit("boss.city_skipped", {"city": city["name"], "reason": "daily_city_limit"})
                    continue
                city_confirmed = 0
                for keyword in keywords:
                    if stop_run or (config["communication"]["enabled"] and city_confirmed >= city_remaining):
                        break
                    page_signatures: set[tuple[str, ...]] = set()
                    keyword_seen: set[str] = set()
                    for page_number in range(1, config["limits"]["max_pages"] + 1):
                        await context.check_cancelled()
                        if config["communication"]["enabled"] and (
                            newly_confirmed >= target_new or city_confirmed >= city_remaining
                        ):
                            stop_run = newly_confirmed >= target_new
                            break
                        search_url = self._search_url(keyword, city, page_number, config["search"]["query_params"])
                        search_key = f"search.pass-{scan_pass}.{self._key(keyword)}.{city_code}.page-{page_number}"

                        async def search(page_num: int = page_number, url: str = search_url) -> list[dict[str, str]]:
                            if page_num == 1:
                                return await adapter.open_search(page, url)
                            else:
                                return await adapter.next_page(page)

                        jobs = await context.step(search_key, search, retry=RetryPolicy(max_attempts=2))
                        if not jobs:
                            await context.emit("boss.city_page_stopped", {"city": city["name"], "page": page_number, "reason": "empty"})
                            break
                        signature = tuple(self._job_id(str(item.get("url") or "")) for item in jobs)
                        if signature in page_signatures:
                            await context.emit("boss.city_page_stopped", {"city": city["name"], "page": page_number, "reason": "repeated_page"})
                            break
                        page_signatures.add(signature)
                        new_on_page = 0
                        for listed in jobs:
                            if config["communication"]["enabled"] and (
                                newly_confirmed >= target_new or city_confirmed >= city_remaining
                            ):
                                stop_run = newly_confirmed >= target_new
                                break
                            url = str(listed.get("url") or "")
                            if not url:
                                continue
                            provisional_id = self._job_id(url)
                            if provisional_id not in keyword_seen:
                                new_on_page += 1
                                keyword_seen.add(provisional_id)
                            if provisional_id in seen:
                                continue
                            seen.add(provisional_id)

                            effect_key = f"communicate.{provisional_id}"
                            prior_effect = await context.completed_side_effect(effect_key)
                            if prior_effect is not None:
                                if prior_effect.output.get("outcome") == "skipped_experience_mismatch":
                                    experience_mismatch_skipped += 1
                                else:
                                    already_communicated += 1
                                continue

                            reject_key = f"reject.{provisional_id}"
                            if await context.completed_side_effect(reject_key):
                                rejected += 1
                                continue

                            scanned += 1
                            detail_key = f"job.{provisional_id}.detail"

                            async def detail(job_url: str = url) -> JsonObject:
                                return await adapter.read_job(page, job_url)

                            job = await context.step(detail_key, detail, retry=RetryPolicy(max_attempts=2))
                            decision = self._match(job, config["criteria"])
                            await context.emit(
                                "boss.job_evaluated",
                                {
                                    "job_id": job.get("job_id"),
                                    "matched": decision["matched"],
                                    "reasons": decision["reasons"],
                                    "hr_active_time": job.get("hr_active_time", ""),
                                    "hr_boss_raw": job.get("hr_boss_raw", ""),
                                },
                            )
                            if not decision["matched"]:
                                rejected += 1
                                async def mark_reject(reasons: list[str] = decision["reasons"]) -> JsonObject:
                                    return {"reasons": reasons}
                                await context.step(reject_key, mark_reject, side_effect=True)
                                continue
                            matched += 1
                            record = {
                                **job,
                                "keyword": keyword,
                                "city": city["name"],
                                "city_code": city_code,
                                "decision": decision,
                            }
                            if not config["communication"]["enabled"]:
                                collection_records.append(record)
                                continue

                            job_id = str(job["job_id"])
                            preflight = await adapter.communication_state(page, job_id)
                            if preflight.get("status") == "communicated":
                                already_communicated += 1
                                await context.emit("boss.communication_skipped", {"job_id": job_id, "reason": "preexisting"})
                                continue
                            if preflight.get("status") != "available":
                                unavailable += 1
                                await context.emit("boss.communication_skipped", {"job_id": job_id, "reason": "unavailable", "state": preflight})
                                continue

                            async def communicate(job_record: JsonObject = record, expected: str = job_id) -> JsonObject:
                                evidence = await adapter.communicate(page, expected)
                                return {**job_record, **evidence}

                            async def reconcile(job_record: JsonObject = record, expected: str = job_id) -> JsonObject | None:
                                evidence = await adapter.reconcile_communication(page, expected)
                                return {**job_record, **evidence} if evidence is not None else None

                            result = await context.step(
                                effect_key,
                                communicate,
                                side_effect=True,
                                reconcile=reconcile,
                                retry=RetryPolicy(max_attempts=1),
                            )
                            if result.get("confirmed") and result.get("performed") and not result.get("preexisting"):
                                newly_confirmed += 1
                                city_confirmed += 1
                                prior_by_city[city_code] += 1
                                await context.emit(
                                    "boss.communication_confirmed",
                                    {"job_id": job_id, "city": city["name"], "city_confirmed": city_confirmed,
                                     "run_confirmed": run_completed + newly_confirmed,
                                     "daily_confirmed": daily_completed + newly_confirmed},
                                )
                                daily_report, _ = await materialize_daily_report()
                            elif result.get("outcome") == "skipped_experience_mismatch":
                                experience_mismatch_skipped += 1
                                await context.emit(
                                    "boss.communication_skipped",
                                    {"job_id": job_id, "reason": "experience_mismatch"},
                                )
                            else:
                                already_communicated += 1
                        if new_on_page == 0:
                            await context.emit("boss.city_page_stopped", {"city": city["name"], "page": page_number, "reason": "no_new_jobs"})
                            break

        final_effects = await context.list_completed_side_effects("communicate.", today)
        final_confirmed = self._confirmed_effects(final_effects)
        daily_records = [self._ledger_record(effect, output) for effect, output in final_confirmed]
        run_records = [
            self._ledger_record(effect, output)
            for effect, output in final_confirmed
            if effect.run_id == context.run_id
        ]
        run_artifact = await context.write_text_artifact(
            f"boss-confirmed-{context.run_id}.csv",
            self._csv(run_records),
            "boss_confirmed_run_csv",
            {"records": len(run_records)},
        )
        daily_report, daily_records = await materialize_daily_report()
        collection_artifact = None
        if collection_records:
            collection_artifact = await context.write_text_artifact(
                f"boss-matches-{context.run_id}.csv",
                self._csv(collection_records),
                "boss_matches_csv",
                {"records": len(collection_records)},
            )
        return {
            "matched": matched,
            "rejected": rejected,
            "scanned": scanned,
            "communicated": len(run_records),
            "run_confirmed": len(run_records),
            "daily_confirmed_total": len(daily_records),
            "already_communicated": already_communicated,
            "unavailable": unavailable,
            "experience_mismatch_skipped": experience_mismatch_skipped,
            "skipped": already_communicated + unavailable + experience_mismatch_skipped,
            "daily_completed_before_run": daily_completed,
            "profile": config["profile"],
            "run_target": config["limits"]["run"],
            "new_target": target_new,
            "city_order": city_order,
            "artifact_id": run_artifact.id,
            "artifact_path": run_artifact.path,
            "daily_report_id": daily_report.id,
            "daily_report_path": daily_report.path,
            "daily_artifact_id": daily_report.id,
            "daily_artifact_path": daily_report.path,
            "collection_artifact_id": collection_artifact.id if collection_artifact else None,
        }

    @staticmethod
    def _config(value: JsonObject) -> JsonObject:
        value = BossWorkflow._profiled_config(value)
        search = value.get("search")
        if not isinstance(search, dict) or not isinstance(search.get("cities"), list) or not search["cities"]:
            raise RpaError("INVALID_BOSS_CONFIG", "search.cities must be a non-empty list")
        cities = []
        for city in search["cities"]:
            if not isinstance(city, dict) or not city.get("name") or not city.get("code"):
                raise RpaError("INVALID_BOSS_CONFIG", "Each city requires name and code")
            cities.append({"name": str(city["name"]), "code": str(city["code"])})
        limits = value.get("limits") if isinstance(value.get("limits"), dict) else {}
        criteria = value.get("criteria") if isinstance(value.get("criteria"), dict) else {}
        communication = value.get("communication") if isinstance(value.get("communication"), dict) else {}
        ordering = value.get("ordering") if isinstance(value.get("ordering"), dict) else {}
        profile = str(value.get("profile") or "legacy").strip() or "legacy"
        daily_limit = max(0, int(limits.get("daily", 110)))
        run_limit = max(0, int(limits.get("run", daily_limit)))
        strategy = str(ordering.get("strategy", "random_rotated"))
        if strategy not in {"random_rotated", "configured"}:
            raise RpaError("INVALID_BOSS_CONFIG", "ordering.strategy must be random_rotated or configured")
        return {
            "search": {
                "cities": cities,
                "keywords": search.get("keywords", []),
                "weekday_keywords": search.get("weekday_keywords", {}),
                "query_params": search.get("query_params", {}),
            },
            "profile": profile,
            "limits": {
                "run": run_limit,
                "daily": daily_limit,
                "per_city": max(0, int(limits.get("per_city", 10))),
                "max_pages": max(1, int(limits.get("max_pages", 10))),
            },
            "ordering": {"strategy": strategy},
            "criteria": {
                "title_allow": [str(item) for item in criteria.get("title_allow", [])],
                "title_deny": [str(item) for item in criteria.get("title_deny", [])],
                "experience_allow": [str(item) for item in criteria.get("experience_allow", [])],
                "education_deny": [str(item) for item in criteria.get("education_deny", [])],
                "company_size_min": max(0, int(criteria.get("company_size_min", 0))),
                "salary_min_k": max(0, int(criteria.get("salary_min_k", 0))),
                "salary_max_k": max(0, int(criteria.get("salary_max_k", 0))),
                "allow_unknown": bool(criteria.get("allow_unknown", True)),
                "hr_active_allow": [str(item) for item in criteria.get("hr_active_allow", [])],
                "hr_title_deny": [str(item) for item in criteria.get("hr_title_deny", [])],
            },
            "communication": {"enabled": bool(communication.get("enabled", False))},
        }

    @staticmethod
    def _profiled_config(value: JsonObject) -> JsonObject:
        profiles = value.get("profiles")
        if not isinstance(profiles, dict):
            return value
        selected = str(value.get("profile") or "production").strip() or "production"
        override = profiles.get(selected)
        if not isinstance(override, dict):
            raise RpaError("INVALID_BOSS_CONFIG", f"Boss profile does not exist: {selected}")
        base = {key: item for key, item in value.items() if key not in {"profile", "profiles"}}
        resolved = BossWorkflow._deep_merge(base, override)
        resolved["profile"] = selected
        return resolved

    @staticmethod
    def _deep_merge(base: JsonObject, override: JsonObject) -> JsonObject:
        merged = dict(base)
        for key, value in override.items():
            existing = merged.get(key)
            if isinstance(existing, dict) and isinstance(value, dict):
                merged[key] = BossWorkflow._deep_merge(existing, value)
            else:
                merged[key] = value
        return merged

    @staticmethod
    def _keywords(search: JsonObject) -> list[str]:
        direct = [str(item).strip() for item in search.get("keywords", []) if str(item).strip()]
        if direct:
            return direct
        weekday = datetime.now().strftime("%a").lower()[:3]
        mapping = search.get("weekday_keywords", {})
        selected = mapping.get(weekday) if isinstance(mapping, dict) else None
        if isinstance(selected, list):
            return [str(item).strip() for item in selected if str(item).strip()]
        if selected:
            return [str(selected).strip()]
        raise RpaError("INVALID_BOSS_CONFIG", "Configure search.keywords or weekday_keywords for today")

    @staticmethod
    def _search_url(keyword: str, city: JsonObject, page: int, query_params: JsonObject) -> str:
        params: dict[str, Any] = {"query": keyword, "city": city["code"], "page": page}
        params.update({str(key): value for key, value in query_params.items()})
        return f"https://www.zhipin.com/web/geek/jobs?{urlencode(params, doseq=True)}"

    @staticmethod
    def _match(job: JsonObject, criteria: JsonObject) -> JsonObject:
        reasons: list[str] = []
        unknown_allowed = criteria["allow_unknown"]
        title = str(job.get("title") or "")
        experience = str(job.get("experience") or "")
        education = str(job.get("education") or "")
        scale = str(job.get("scale") or "")
        salary = str(job.get("salary") or "")
        title_allow = [str(item) for item in criteria.get("title_allow", []) if str(item).strip()]
        title_deny = [str(item) for item in criteria.get("title_deny", []) if str(item).strip()]
        normalized_title = title.casefold()
        denied = next((token for token in title_deny if token.casefold() in normalized_title), "")
        if denied:
            reasons.append(f"title_denied:{denied}")
        if title_allow and not any(token.casefold() in normalized_title for token in title_allow):
            reasons.append(f"title_not_developer:{title or 'unknown'}")
        allowed_experience = criteria["experience_allow"]
        if allowed_experience and experience and experience not in allowed_experience:
            reasons.append(f"experience_not_allowed:{experience}")
        if allowed_experience and not experience and not unknown_allowed:
            reasons.append("experience_unknown")
        if education and education in criteria["education_deny"]:
            reasons.append(f"education_denied:{education}")
        scale_match = re.search(r"(\d+)(?:-(\d+))?人|少于(\d+)人", scale)
        if scale_match:
            scale_max = int(scale_match.group(2) or scale_match.group(1) or scale_match.group(3) or 0)
            if scale_max < criteria["company_size_min"]:
                reasons.append(f"company_too_small:{scale}")
        elif criteria["company_size_min"] and not unknown_allowed:
            reasons.append("company_size_unknown")
        salary_match = re.search(r"(\d+)-(\d+)K", salary, re.IGNORECASE)
        if salary_match:
            low, high = int(salary_match.group(1)), int(salary_match.group(2))
            if criteria["salary_min_k"] and high < criteria["salary_min_k"]:
                reasons.append(f"salary_below_range:{salary}")
            if criteria["salary_max_k"] and low > criteria["salary_max_k"]:
                reasons.append(f"salary_above_range:{salary}")
        elif (criteria["salary_min_k"] or criteria["salary_max_k"]) and not unknown_allowed:
            reasons.append("salary_unknown")
            
        hr_active_time = str(job.get("hr_active_time") or "")
        hr_active_allow = [str(item) for item in criteria.get("hr_active_allow", []) if str(item).strip()]
        if hr_active_allow:
            if not hr_active_time:
                reasons.append("hr_active_time_unknown")
            elif not any(token in hr_active_time for token in hr_active_allow):
                reasons.append(f"hr_not_active_recently:{hr_active_time}")
                
        hr_title = str(job.get("hr_title") or "")
        hr_title_deny = [str(item) for item in criteria.get("hr_title_deny", []) if str(item).strip()]
        if hr_title_deny and hr_title:
            denied_title = next((token for token in hr_title_deny if token in hr_title), "")
            if denied_title:
                reasons.append(f"hr_title_denied:{denied_title}")
            
        return {"matched": not reasons, "reasons": reasons}

    @staticmethod
    def _csv(records: list[dict[str, Any]]) -> str:
        output = io.StringIO(newline="")
        fields = [
            "job_id",
            "title",
            "company",
            "scale",
            "salary",
            "experience",
            "education",
            "location",
            "keyword",
            "city",
            "city_code",
            "url",
            "jd",
            "hr_active_time",
            "hr_title",
            "confirmed",
            "performed",
            "button_text",
            "confirmed_at",
            "source_run_id",
        ]
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            writer.writerow(record)
        return "\ufeff" + output.getvalue()

    @staticmethod
    def _confirmed_effects(effects: Any) -> list[tuple[Any, JsonObject]]:
        values: list[tuple[Any, JsonObject]] = []
        seen_job_ids: set[str] = set()
        for effect in effects:
            output = effect.output
            if not isinstance(output, dict):
                continue
            if output.get("confirmed") and output.get("performed", True) and not output.get("preexisting"):
                job_id = str(output.get("job_id") or effect.step_key.removeprefix("communicate."))
                if job_id in seen_job_ids:
                    continue
                seen_job_ids.add(job_id)
                values.append((effect, output))
        return values

    @staticmethod
    def _ledger_record(effect: Any, output: JsonObject) -> JsonObject:
        return {**output, "confirmed_at": effect.completed_at, "source_run_id": effect.run_id}

    @staticmethod
    def _job_id(url: str) -> str:
        match = re.search(r"/job_detail/([^.?/]+)", url)
        return BossWorkflow._key(match.group(1) if match else url)

    @staticmethod
    def _key(value: str) -> str:
        return re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")[:100] or "unknown"
