from __future__ import annotations

import csv
import io
import random
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from safari_rpa.contracts.errors import ErrorKind, RpaError
from safari_rpa.contracts.runtime import JsonObject, RetryPolicy, WorkflowContextPort, WorkflowDescriptor
from safari_rpa.contracts.safari import PageRef
from safari_rpa.sites.boss import BossPageAdapter
from safari_rpa.workflows.boss_matching import (
    match_job_detail,
    match_search_card,
    matcher_fingerprint,
    rejection_retry_days,
    resolve_keyword_rule,
)


@dataclass(slots=True)
class _BossPages:
    search: PageRef
    detail: PageRef
    generation: int
    detail_reads: int = 0
    search_reads: int = 0
    scroll_depth: int = 0


class BossWorkflow:
    descriptor = WorkflowDescriptor(
        id="boss.search-and-communicate.v1",
        version="1.3.0",
        title="Boss background relevance filtering and communication",
        capabilities=("safari.dom", "safari.navigation", "safari.write.click"),
        config_schema={
            "type": "object",
            "required": ["search", "profiles"],
            "properties": {
                "search": {"type": "object"},
                "criteria": {"type": "object"},
                "limits": {"type": "object"},
                "ordering": {"type": "object"},
                "communication": {"type": "object"},
                "profile": {"enum": ["test", "production"]},
                "profiles": {"type": "object"},
            },
        },
    )

    async def execute(self, context: WorkflowContextPort) -> JsonObject:
        config = self._config(context.config)
        adapter = BossPageAdapter(context.safari)
        local_now = datetime.now().astimezone()
        today = local_now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        report_date = local_now.strftime("%Y-%m-%d")
        report_id = f"boss-confirmed-daily-{report_date}"
        initial_effects = await context.list_completed_side_effects("communicate.", today)
        initial_confirmed = self._confirmed_effects(initial_effects)

        async def materialize_daily_report() -> tuple[Any, list[JsonObject]]:
            effects = await context.list_completed_side_effects("communicate.", today)
            records = [self._ledger_record(effect, output) for effect, output in self._confirmed_effects(effects)]
            report = await context.write_daily_report(
                report_id,
                report_date,
                self._csv(records),
                record_count=len(records),
                metadata={"date": report_date, "source": "confirmed_side_effects"},
            )
            return report, records

        # Repair a report after a prior crash before issuing another browser write.
        daily_report, _ = await materialize_daily_report()
        daily_completed = len(initial_confirmed)
        run_completed = sum(1 for effect, _ in initial_confirmed if effect.run_id == context.run_id)
        remaining_daily = max(0, config["limits"]["daily"] - daily_completed)
        remaining_run = max(0, config["limits"]["run"] - run_completed)
        target_new = min(remaining_daily, remaining_run)
        prior_by_city = Counter(
            str(output.get("city_code") or "") for _, output in initial_confirmed if output.get("city_code")
        )
        keywords = self._keywords(config["search"])
        overflow_keywords = self._overflow_keywords(config["search"], keywords)
        cities = config["search"]["cities"]
        fingerprint = matcher_fingerprint(config["search"], config["criteria"])
        rejection_effects = await context.list_completed_side_effects(
            f"reject.{fingerprint}.",
            (local_now - timedelta(days=31)).timestamp(),
        )
        rejection_cache = self._rejection_cache(rejection_effects)

        matched = 0
        card_rejected = 0
        job_card_reads = 0
        job_card_rejected = 0
        job_card_fallbacks = 0
        detail_rejected = 0
        cached_rejected = 0
        already_communicated = 0
        unavailable = 0
        experience_mismatch_skipped = 0
        scanned = 0
        detail_opened = 0
        newly_confirmed = 0
        page_recycles = 0
        last_report_checkpoint = 0
        pages: _BossPages | None = None
        page_generation = 0
        evaluated: set[tuple[str, str]] = set()
        job_card_cache: dict[str, JsonObject] = {}
        city_order: list[JsonObject] = []
        completed_phases: list[str] = []
        page_metrics: list[JsonObject] = []
        card_rejection_reasons: Counter[str] = Counter()
        job_card_rejection_reasons: Counter[str] = Counter()
        detail_rejection_reasons: Counter[str] = Counter()

        async def close_pages(reason: str) -> None:
            nonlocal pages
            if pages is None:
                return
            closing = pages
            pages = None
            metrics: JsonObject = {
                "reason": reason,
                "generation": closing.generation,
                "detail_reads": closing.detail_reads,
                "search_reads": closing.search_reads,
                "scroll_depth": closing.scroll_depth,
            }
            for label, page in (("search", closing.search), ("detail", closing.detail)):
                try:
                    metrics[label] = await adapter.page_metrics(page)
                except Exception as exc:  # Diagnostics must not hide the primary workflow result.
                    metrics[f"{label}_metrics_error"] = type(exc).__name__
            page_metrics.append(metrics)
            for label, page in (("detail", closing.detail), ("search", closing.search)):
                try:
                    await adapter.close_page(page)
                except Exception as exc:  # A lost tab is already effectively cleaned up.
                    await context.emit(
                        "boss.page_cleanup_failed",
                        {"page": label, "reason": reason, "error": type(exc).__name__},
                    )
            await context.emit("boss.page_batch_closed", metrics)

        async def open_pages(reason: str) -> _BossPages:
            nonlocal pages
            nonlocal page_generation
            nonlocal page_recycles
            if pages is not None:
                await close_pages(reason)
                page_recycles += 1
            search_page = await adapter.ensure_search_page()
            try:
                detail_page = await adapter.open_detail_page(search_page)
            except Exception:
                try:
                    await adapter.close_page(search_page)
                except Exception:
                    pass
                raise
            page_generation += 1
            pages = _BossPages(search_page, detail_page, page_generation)
            await context.emit(
                "boss.page_batch_opened",
                {"reason": reason, "generation": page_generation},
            )
            return pages

        async def current_pages(reason: str = "initial") -> _BossPages:
            if pages is None:
                return await open_pages(reason)
            return pages

        async def checkpoint_and_recycle(reason: str) -> None:
            nonlocal daily_report
            nonlocal last_report_checkpoint
            if newly_confirmed > last_report_checkpoint:
                daily_report, _ = await materialize_daily_report()
                last_report_checkpoint = newly_confirmed
            await open_pages(reason)

        async def mark_rejection(job_id: str, keyword: str, reasons: list[str], stage: str) -> None:
            days = rejection_retry_days(reasons)
            retry_after = (local_now + timedelta(days=days)).strftime("%Y-%m-%d")
            cache_key = (job_id, keyword)
            output = {
                "job_id": job_id,
                "keyword": keyword,
                "reasons": reasons,
                "stage": stage,
                "date": report_date,
                "retry_after": retry_after,
                "matcher_fingerprint": fingerprint,
            }

            async def persist() -> JsonObject:
                return output

            step_key = (
                f"reject.{fingerprint}.{self._key(keyword)}.{job_id}.{report_date}"
            )
            await context.step(step_key, persist, side_effect=True)
            rejection_cache[cache_key] = output

        async def read_detail(job_id: str, url: str, evaluation_scope: str) -> JsonObject:
            nonlocal detail_opened
            active = await current_pages()
            if active.detail_reads >= config["limits"]["max_detail_reads_per_batch"]:
                await checkpoint_and_recycle("detail_read_limit")
                active = await current_pages()
            detail_key = (
                f"job.{job_id}.detail.{self._key(evaluation_scope)}."
                f"{active.detail.session_id}"
            )

            async def action() -> JsonObject:
                return await adapter.read_job(active.detail, url)

            job = await context.step(detail_key, action, retry=RetryPolicy(max_attempts=2))
            active.detail_reads += 1
            detail_opened += 1
            return job

        async def read_job_card(job_id: str, listed: JsonObject) -> JsonObject | None:
            nonlocal job_card_reads
            nonlocal job_card_fallbacks
            if not listed.get("security_id") or not listed.get("lid"):
                job_card_fallbacks += 1
                await context.emit(
                    "boss.job_card_fallback",
                    {
                        "job_id": job_id,
                        "code": "BOSS_JOB_CARD_IDENTIFIERS_MISSING",
                        "reason": "identifiers_missing",
                    },
                )
                return None
            active = await current_pages()
            request_key = f"job.{job_id}.card.{active.search.session_id}"

            async def action() -> JsonObject:
                return await adapter.read_job_card(active.search, listed)

            try:
                job = await context.step(request_key, action, retry=RetryPolicy(max_attempts=2))
            except RpaError as exc:
                if exc.kind in {
                    ErrorKind.BLOCKED_AUTH,
                    ErrorKind.BLOCKED_RISK,
                    ErrorKind.CANCELLED,
                }:
                    raise
                job_card_fallbacks += 1
                await context.emit(
                    "boss.job_card_fallback",
                    {"job_id": job_id, "code": exc.code, "reason": "read_failed"},
                )
                return None
            job_card_reads += 1
            return job

        def merge_visible_job(background: JsonObject | None, visible: JsonObject) -> JsonObject:
            merged = dict(background or {})
            for key, value in visible.items():
                if value not in {"", None}:
                    merged[key] = value
            merged["source"] = "visible_detail"
            return merged

        try:
            if target_new > 0:
                await open_pages("initial")

                async def plan_city_order() -> JsonObject:
                    start = random.randrange(len(cities)) if config["ordering"]["strategy"] == "random_rotated" else 0
                    ordered = cities[start:] + cities[:start]
                    return {"strategy": config["ordering"]["strategy"], "start_index": start, "cities": ordered}

                order_data = await context.step("plan.city_order", plan_city_order, retry=RetryPolicy(max_attempts=1))
                city_order = [dict(city) for city in order_data.get("cities", []) if isinstance(city, dict)]

                async def scan_phase(
                    phase_name: str,
                    phase_index: int,
                    city_cap: int | None,
                    phase_keywords: list[str],
                ) -> None:
                    nonlocal matched
                    nonlocal card_rejected
                    nonlocal job_card_rejected
                    nonlocal detail_rejected
                    nonlocal cached_rejected
                    nonlocal already_communicated
                    nonlocal unavailable
                    nonlocal experience_mismatch_skipped
                    nonlocal scanned
                    nonlocal newly_confirmed
                    nonlocal daily_report

                    for city_index, city in enumerate(city_order):
                        if newly_confirmed >= target_new:
                            return
                        city_code = str(city["code"])
                        city_remaining = (
                            max(0, target_new - newly_confirmed)
                            if city_cap is None
                            else max(0, city_cap - prior_by_city.get(city_code, 0))
                        )
                        if city_remaining == 0:
                            await context.emit(
                                "boss.city_skipped",
                                {"city": city["name"], "reason": "phase_city_limit", "phase": phase_name},
                            )
                            continue

                        city_confirmed = 0
                        city_keywords = self._rotate(phase_keywords, city_index + phase_index)
                        for keyword in city_keywords:
                            if newly_confirmed >= target_new or city_confirmed >= city_remaining:
                                break
                            rule = resolve_keyword_rule(config["search"], keyword)
                            query_params = self._search_query_params(
                                config["search"]["query_params"],
                                rule,
                            )
                            consecutive_no_new_pages = 0
                            loaded_generation = -1
                            for page_number in range(1, config["limits"]["max_pages"] + 1):
                                await context.check_cancelled()
                                if newly_confirmed >= target_new or city_confirmed >= city_remaining:
                                    break
                                active = await current_pages()
                                if (
                                    active.search_reads >= config["limits"]["max_search_reads_per_batch"]
                                ):
                                    await checkpoint_and_recycle("search_read_limit")
                                    active = await current_pages()
                                search_url = self._search_url(keyword, city, 1, query_params)
                                session_key = active.search.session_id[:12]
                                search_key = (
                                    f"search.{phase_name}.{self._key(keyword)}.{city_code}."
                                    f"page-{page_number}.{session_key}"
                                )

                                async def search(
                                    expected_generation: int = active.generation,
                                    depth: int = page_number,
                                    url: str = search_url,
                                ) -> list[dict[str, Any]]:
                                    current = await current_pages()
                                    jobs: list[dict[str, Any]]
                                    if loaded_generation != expected_generation:
                                        jobs = await adapter.open_search(current.search, url)
                                        current.search_reads += 1
                                        current.scroll_depth = 1
                                        for _ in range(1, depth):
                                            jobs = await adapter.next_page(current.search)
                                            current.search_reads += 1
                                            current.scroll_depth += 1
                                    else:
                                        jobs = await adapter.next_page(current.search)
                                        current.search_reads += 1
                                        current.scroll_depth += 1
                                    return jobs

                                jobs = await context.step(search_key, search, retry=RetryPolicy(max_attempts=2))
                                loaded_generation = active.generation
                                if not jobs:
                                    await context.emit(
                                        "boss.city_page_stopped",
                                        {
                                            "city": city["name"],
                                            "keyword": keyword,
                                            "phase": phase_name,
                                            "page": page_number,
                                            "reason": "empty",
                                        },
                                    )
                                    break
                                new_on_page = 0

                                for listed in jobs:
                                    if newly_confirmed >= target_new or city_confirmed >= city_remaining:
                                        break
                                    url = str(listed.get("url") or "")
                                    if not url:
                                        continue
                                    job_id = self._job_id(url)
                                    evaluation_key = (job_id, keyword)
                                    if evaluation_key in evaluated:
                                        continue
                                    evaluated.add(evaluation_key)
                                    new_on_page += 1

                                    if await context.completed_side_effect(f"communicated.{job_id}"):
                                        already_communicated += 1
                                        continue
                                    effect_key = f"communicate.{job_id}"
                                    prior_effect = await context.completed_side_effect(effect_key)
                                    if prior_effect is not None:
                                        prior_output = prior_effect.output if isinstance(prior_effect.output, dict) else {}
                                        if prior_output.get("confirmed") or prior_output.get("preexisting"):
                                            already_communicated += 1
                                            continue
                                        if prior_output.get("outcome") == "skipped_experience_mismatch":
                                            effect_key = f"communicate.retry.{report_date}.{job_id}"
                                            if await context.completed_side_effect(effect_key):
                                                experience_mismatch_skipped += 1
                                                continue
                                        else:
                                            already_communicated += 1
                                            continue

                                    cached = rejection_cache.get(evaluation_key)
                                    if cached and str(cached.get("retry_after") or "") > report_date:
                                        cached_rejected += 1
                                        continue

                                    scanned += 1
                                    card_decision = match_search_card(listed, config["criteria"], rule)
                                    await context.emit(
                                        "boss.job_prefiltered",
                                        {
                                            "job_id": job_id,
                                            "title": listed.get("title", ""),
                                            "matched": card_decision["matched"],
                                            "reasons": card_decision["reasons"],
                                            "keyword": keyword,
                                            "city": city["name"],
                                            "phase": phase_name,
                                        },
                                    )
                                    if not card_decision["matched"]:
                                        card_rejected += 1
                                        card_rejection_reasons.update(card_decision["reasons"])
                                        await mark_rejection(
                                            job_id,
                                            keyword,
                                            list(card_decision["reasons"]),
                                            "search_card",
                                        )
                                        continue

                                    if job_id in job_card_cache:
                                        background_job = job_card_cache[job_id]
                                    else:
                                        background_job = await read_job_card(job_id, listed)
                                        if background_job is not None:
                                            job_card_cache[job_id] = background_job

                                    if background_job is not None:
                                        background_decision = match_job_detail(
                                            background_job,
                                            config["criteria"],
                                            rule,
                                        )
                                        await context.emit(
                                            "boss.job_evaluated",
                                            {
                                                "stage": "job_card_api",
                                                "job_id": background_job.get("job_id"),
                                                "matched": background_decision["matched"],
                                                "reasons": background_decision["reasons"],
                                                "score": background_decision["score"],
                                                "jd_core_hits": background_decision["jd_core_hits"],
                                                "hr_active_time": background_job.get("hr_active_time", ""),
                                                "hr_boss_raw": background_job.get("hr_boss_raw", ""),
                                                "keyword": keyword,
                                                "direction": background_decision["direction"],
                                                "city": city["name"],
                                                "phase": phase_name,
                                            },
                                        )
                                        if not background_decision["matched"]:
                                            job_card_rejected += 1
                                            job_card_rejection_reasons.update(background_decision["reasons"])
                                            await mark_rejection(
                                                job_id,
                                                keyword,
                                                list(background_decision["reasons"]),
                                                "job_card_api",
                                            )
                                            continue

                                    visible_job = await read_detail(job_id, url, keyword)
                                    job = merge_visible_job(background_job, visible_job)
                                    decision = match_job_detail(job, config["criteria"], rule)
                                    await context.emit(
                                        "boss.job_evaluated",
                                        {
                                            "stage": "visible_detail",
                                            "job_id": job.get("job_id"),
                                            "matched": decision["matched"],
                                            "reasons": decision["reasons"],
                                            "score": decision["score"],
                                            "jd_core_hits": decision["jd_core_hits"],
                                            "hr_active_time": job.get("hr_active_time", ""),
                                            "hr_boss_raw": job.get("hr_boss_raw", ""),
                                            "keyword": keyword,
                                            "direction": decision["direction"],
                                            "city": city["name"],
                                            "phase": phase_name,
                                        },
                                    )
                                    if not decision["matched"]:
                                        detail_rejected += 1
                                        detail_rejection_reasons.update(decision["reasons"])
                                        await mark_rejection(
                                            job_id,
                                            keyword,
                                            list(decision["reasons"]),
                                            "visible_detail",
                                        )
                                        continue

                                    matched += 1
                                    active = await current_pages()
                                    state = await adapter.communication_state(active.detail, job_id)
                                    if state.get("status") == "communicated":
                                        already_communicated += 1

                                        async def mark_preexisting(existing_job_id: str = job_id) -> JsonObject:
                                            return {"job_id": existing_job_id, "outcome": "preexisting"}

                                        await context.step(
                                            f"communicated.{job_id}",
                                            mark_preexisting,
                                            side_effect=True,
                                        )
                                        await context.emit(
                                            "boss.communication_skipped",
                                            {"job_id": job_id, "reason": "preexisting"},
                                        )
                                        continue
                                    if state.get("status") != "available":
                                        unavailable += 1
                                        await context.emit(
                                            "boss.communication_skipped",
                                            {"job_id": job_id, "reason": "unavailable", "state": state},
                                        )
                                        continue

                                    record = {
                                        **job,
                                        "keyword": keyword,
                                        "direction": decision["direction"],
                                        "city": city["name"],
                                        "city_code": city_code,
                                        "decision": decision,
                                    }

                                    async def communicate(
                                        job_record: JsonObject = record,
                                        expected: str = job_id,
                                        detail_page: PageRef = active.detail,
                                    ) -> JsonObject:
                                        evidence = await adapter.communicate(detail_page, expected)
                                        return {**job_record, **evidence}

                                    async def reconcile(
                                        job_record: JsonObject = record,
                                        expected: str = job_id,
                                        detail_page: PageRef = active.detail,
                                    ) -> JsonObject | None:
                                        evidence = await adapter.reconcile_communication(detail_page, expected)
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

                                        async def mark_confirmed(confirmed_job_id: str = job_id) -> JsonObject:
                                            return {"job_id": confirmed_job_id, "outcome": "confirmed"}

                                        await context.step(
                                            f"communicated.{job_id}",
                                            mark_confirmed,
                                            side_effect=True,
                                        )
                                        await context.emit(
                                            "boss.communication_confirmed",
                                            {
                                                "job_id": job_id,
                                                "city": city["name"],
                                                "keyword": keyword,
                                                "phase": phase_name,
                                                "city_confirmed": city_confirmed,
                                                "run_confirmed": run_completed + newly_confirmed,
                                                "daily_confirmed": daily_completed + newly_confirmed,
                                            },
                                        )
                                        if (
                                            newly_confirmed < target_new
                                            and newly_confirmed % config["limits"]["batch_size"] == 0
                                        ):
                                            await checkpoint_and_recycle("confirmed_batch")
                                            loaded_generation = -1
                                    elif result.get("outcome") == "skipped_experience_mismatch":
                                        experience_mismatch_skipped += 1
                                        await context.emit(
                                            "boss.communication_skipped",
                                            {"job_id": job_id, "reason": "experience_mismatch"},
                                        )
                                    else:
                                        already_communicated += 1

                                if new_on_page == 0:
                                    consecutive_no_new_pages += 1
                                    if consecutive_no_new_pages >= 2:
                                        await context.emit(
                                            "boss.city_page_stopped",
                                            {
                                                "city": city["name"],
                                                "keyword": keyword,
                                                "phase": phase_name,
                                                "page": page_number,
                                                "reason": "no_new_jobs",
                                            },
                                        )
                                        break
                                else:
                                    consecutive_no_new_pages = 0

                await scan_phase("balanced", 0, config["limits"]["per_city"], keywords)
                completed_phases.append("balanced")
                if newly_confirmed < target_new:
                    await scan_phase("overflow", 1, None, keywords)
                    completed_phases.append("overflow")
                if newly_confirmed < target_new and overflow_keywords:
                    await scan_phase("cross_direction_overflow", 2, None, overflow_keywords)
                    completed_phases.append("cross_direction_overflow")
        finally:
            await close_pages("workflow_exit")

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

        shortfall = max(0, target_new - newly_confirmed)
        if target_new == 0:
            stop_reason = "daily_limit_already_reached"
        elif shortfall == 0:
            stop_reason = "target_reached"
        else:
            stop_reason = "candidate_pool_exhausted"

        rejected = card_rejected + job_card_rejected + detail_rejected + cached_rejected
        return {
            "matched": matched,
            "rejected": rejected,
            "card_rejected": card_rejected,
            "card_rejection_reasons": dict(card_rejection_reasons.most_common()),
            "job_card_reads": job_card_reads,
            "job_card_rejected": job_card_rejected,
            "job_card_rejection_reasons": dict(job_card_rejection_reasons.most_common()),
            "job_card_fallbacks": job_card_fallbacks,
            "detail_rejected": detail_rejected,
            "detail_rejection_reasons": dict(detail_rejection_reasons.most_common()),
            "cached_rejected": cached_rejected,
            "scanned": scanned,
            "detail_opened": detail_opened,
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
            "shortfall": shortfall,
            "stop_reason": stop_reason,
            "keyword_order": keywords,
            "overflow_keyword_order": overflow_keywords,
            "completed_phases": completed_phases,
            "city_order": city_order,
            "matcher_fingerprint": fingerprint,
            "page_generations": page_generation,
            "page_recycles": page_recycles,
            "page_metrics": page_metrics,
            "artifact_id": run_artifact.id,
            "artifact_path": run_artifact.path,
            "daily_report_id": daily_report.id,
            "daily_report_path": daily_report.path,
            "daily_artifact_id": daily_report.id,
            "daily_artifact_path": daily_report.path,
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
        if not bool(communication.get("enabled", True)):
            raise RpaError("INVALID_BOSS_CONFIG", "Boss workflow only supports communication-enabled profiles")

        directions = BossWorkflow._mapping_of_objects(search.get("directions"), "search.directions")
        keyword_rules = BossWorkflow._mapping_of_objects(search.get("keyword_rules"), "search.keyword_rules")
        require_keyword_rules = bool(search.get("require_keyword_rules", False))
        require_position_filters = bool(search.get("require_position_filters", False))
        configured_keywords = BossWorkflow._configured_keywords(search)
        if require_keyword_rules:
            missing = [keyword for keyword in configured_keywords if keyword not in keyword_rules]
            if missing:
                raise RpaError(
                    "INVALID_BOSS_CONFIG",
                    f"Every Boss search keyword requires a keyword rule: {', '.join(missing)}",
                )
            unknown_directions = [
                str(rule.get("direction"))
                for rule in keyword_rules.values()
                if rule.get("direction") and str(rule.get("direction")) not in directions
            ]
            if unknown_directions:
                raise RpaError(
                    "INVALID_BOSS_CONFIG",
                    f"Boss keyword rules reference unknown directions: {', '.join(sorted(set(unknown_directions)))}",
                )
        if require_position_filters:
            missing_positions = [
                keyword
                for keyword in configured_keywords
                if not str(
                    (
                        keyword_rules.get(keyword, {}).get("query_params", {})
                        if isinstance(keyword_rules.get(keyword, {}).get("query_params", {}), dict)
                        else {}
                    ).get("position")
                    or ""
                ).strip()
            ]
            if missing_positions:
                raise RpaError(
                    "INVALID_BOSS_CONFIG",
                    f"Every Boss search keyword requires a position filter: {', '.join(missing_positions)}",
                )

        return {
            "search": {
                "cities": cities,
                "keywords": search.get("keywords", []),
                "weekday_keywords": search.get("weekday_keywords", {}),
                "query_params": search.get("query_params", {}),
                "directions": directions,
                "keyword_rules": keyword_rules,
                "require_keyword_rules": require_keyword_rules,
                "require_position_filters": require_position_filters,
                "expand_all_keywords_on_shortfall": bool(
                    search.get("expand_all_keywords_on_shortfall", False)
                ),
            },
            "profile": profile,
            "limits": {
                "run": run_limit,
                "daily": daily_limit,
                "per_city": max(0, int(limits.get("per_city", 10))),
                "max_pages": max(1, int(limits.get("max_pages", 10))),
                "batch_size": max(1, int(limits.get("batch_size", 30))),
                "max_detail_reads_per_batch": max(1, int(limits.get("max_detail_reads_per_batch", 30))),
                "max_scroll_rounds_per_batch": max(1, int(limits.get("max_scroll_rounds_per_batch", 10))),
                "max_search_reads_per_batch": max(
                    1,
                    int(
                        limits.get(
                            "max_search_reads_per_batch",
                            limits.get("max_scroll_rounds_per_batch", 30),
                        )
                    ),
                ),
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
                "allow_unknown_hr_activity": bool(criteria.get("allow_unknown_hr_activity", True)),
                "hr_active_allow": [str(item) for item in criteria.get("hr_active_allow", [])],
                "hr_title_deny": [str(item) for item in criteria.get("hr_title_deny", [])],
            },
            "communication": {"enabled": True},
        }

    @staticmethod
    def _profiled_config(value: JsonObject) -> JsonObject:
        profiles = value.get("profiles")
        if not isinstance(profiles, dict):
            return value
        expected_profiles = {"test", "production"}
        if set(profiles) != expected_profiles:
            raise RpaError("INVALID_BOSS_CONFIG", "Boss profiles must contain only production and test")
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
            values = direct
        else:
            weekday = datetime.now().strftime("%a").lower()[:3]
            mapping = search.get("weekday_keywords", {})
            selected = mapping.get(weekday) if isinstance(mapping, dict) else None
            if isinstance(selected, list):
                values = [str(item).strip() for item in selected if str(item).strip()]
            elif selected:
                values = [str(selected).strip()]
            else:
                raise RpaError("INVALID_BOSS_CONFIG", "Configure search.keywords or weekday_keywords for today")
        unique = list(dict.fromkeys(values))
        if len(unique) < 2:
            return unique
        offset = datetime.now().astimezone().toordinal() % len(unique)
        return BossWorkflow._rotate(unique, offset)

    @staticmethod
    def _configured_keywords(search: JsonObject) -> list[str]:
        values = [str(item).strip() for item in search.get("keywords", []) if str(item).strip()]
        mapping = search.get("weekday_keywords", {})
        if isinstance(mapping, dict):
            for selected in mapping.values():
                if isinstance(selected, list):
                    values.extend(str(item).strip() for item in selected if str(item).strip())
                elif selected:
                    values.append(str(selected).strip())
        return list(dict.fromkeys(values))

    @staticmethod
    def _overflow_keywords(search: JsonObject, primary: list[str]) -> list[str]:
        if not bool(search.get("expand_all_keywords_on_shortfall", False)):
            return []
        remaining = [
            keyword
            for keyword in BossWorkflow._configured_keywords(search)
            if keyword not in set(primary)
        ]
        if len(remaining) < 2:
            return remaining
        offset = datetime.now().astimezone().toordinal() % len(remaining)
        return BossWorkflow._rotate(remaining, offset)

    @staticmethod
    def _mapping_of_objects(value: Any, field: str) -> JsonObject:
        if value is None:
            return {}
        if not isinstance(value, dict) or any(not isinstance(item, dict) for item in value.values()):
            raise RpaError("INVALID_BOSS_CONFIG", f"{field} must map names to objects")
        return {str(key): dict(item) for key, item in value.items()}

    @staticmethod
    def _rotate(values: list[Any], offset: int) -> list[Any]:
        if not values:
            return []
        start = offset % len(values)
        return values[start:] + values[:start]

    @staticmethod
    def _search_url(keyword: str, city: JsonObject, page: int, query_params: JsonObject) -> str:
        params: dict[str, Any] = {"query": keyword, "city": city["code"], "page": page}
        params.update({str(key): value for key, value in query_params.items()})
        return f"https://www.zhipin.com/web/geek/jobs?{urlencode(params, doseq=True)}"

    @staticmethod
    def _search_query_params(global_params: JsonObject, rule: JsonObject) -> JsonObject:
        merged = dict(global_params)
        specific = rule.get("query_params")
        if isinstance(specific, dict):
            merged.update({str(key): value for key, value in specific.items()})
        return merged

    @staticmethod
    def _match(
        job: JsonObject,
        criteria: JsonObject,
        rule: JsonObject | None = None,
    ) -> JsonObject:
        return match_job_detail(job, criteria, rule or {})

    @staticmethod
    def _match_card(
        job: JsonObject,
        criteria: JsonObject,
        rule: JsonObject | None = None,
    ) -> JsonObject:
        return match_search_card(job, criteria, rule or {})

    @staticmethod
    def _rejection_cache(effects: Any) -> dict[tuple[str, str], JsonObject]:
        cache: dict[tuple[str, str], JsonObject] = {}
        for effect in effects:
            output = effect.output
            if not isinstance(output, dict):
                continue
            job_id = str(output.get("job_id") or "")
            keyword = str(output.get("keyword") or "")
            if not job_id or not keyword:
                continue
            key = (job_id, keyword)
            existing = cache.get(key)
            if existing is None or str(output.get("date") or "") >= str(existing.get("date") or ""):
                cache[key] = output
        return cache

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
            "direction",
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
