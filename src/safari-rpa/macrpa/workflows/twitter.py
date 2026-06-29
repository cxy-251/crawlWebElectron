from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import re
from typing import Any
from zoneinfo import ZoneInfo

from macrpa.contracts.errors import ErrorKind, RpaError
from macrpa.contracts.runtime import JsonObject, RetryPolicy, WorkflowContextPort, WorkflowDescriptor
from macrpa.sites.common import page_ref_from_dict, page_ref_to_dict
from macrpa.sites.twitter import TwitterPageAdapter


TWITTER_LEDGER_WORKFLOW_ID = "twitter.extract-prompts.v1"


class TwitterWorkflowSupport:
    @classmethod
    def _config(cls, config: JsonObject, input_data: JsonObject | None = None) -> JsonObject:
        input_data = input_data or {}
        target = dict(config.get("target") or {})
        if input_data.get("profile_url"):
            target["profile_url"] = input_data["profile_url"]
            target.pop("handle", None)
        elif input_data.get("handle"):
            target["handle"] = input_data["handle"]
        target = cls._normalize_target(target)
        if not target.get("handle") and not target.get("profile_url"):
            raise RpaError("TWITTER_TARGET_INVALID", "Twitter handle or profile_url is required")

        include = {"replies": False, "reposts": False, "quotes": False, **dict(config.get("include") or {})}
        limits = {
            "max_tweets": 50,
            "max_scrolls": 80,
            "max_no_new_rounds": 3,
            **dict(config.get("limits") or {}),
        }
        detail = {
            "detail_timeout_seconds": 15.0,
            "detail_pause_seconds": 2.0,
            "detail_retry_attempts": 2,
            "between_detail_seconds": 2.0,
            "max_consecutive_detail_timeouts": 3,
            **dict(config.get("detail") or {}),
        }
        llm = dict(config.get("llm") or {})
        llm_config = {
            "model": str(llm.get("model") or "local-model"),
            "temperature": float(llm.get("temperature", 0.2)),
            "timeout_seconds": float(llm.get("timeout_seconds", 60.0)),
            "max_tokens": int(llm.get("max_tokens", 2048)),
            "retries": int(llm.get("retries", 1)),
            "batch_size": max(1, int(llm.get("batch_size", 5))),
        }
        if llm.get("base_url"):
            llm_config["base_url"] = str(llm["base_url"])
        period = cls._period_config(
            config.get("period") or {},
            input_data.get("period") if isinstance(input_data, dict) else None,
        )
        return {
            "target": target,
            "include": include,
            "limits": {
                "max_tweets": max(1, int(limits["max_tweets"])),
                "max_scrolls": max(0, int(limits["max_scrolls"])),
                "max_no_new_rounds": max(1, int(limits["max_no_new_rounds"])),
            },
            "detail": {
                "detail_timeout_seconds": max(1.0, float(detail["detail_timeout_seconds"])),
                "detail_pause_seconds": max(0.0, float(detail["detail_pause_seconds"])),
                "detail_retry_attempts": max(1, int(detail["detail_retry_attempts"])),
                "between_detail_seconds": max(0.0, float(detail["between_detail_seconds"])),
                "max_consecutive_detail_timeouts": max(1, int(detail["max_consecutive_detail_timeouts"])),
            },
            "llm": llm_config,
            "period": period,
        }

    @classmethod
    async def _ensure_profile(
        cls,
        context: WorkflowContextPort,
        adapter: TwitterPageAdapter,
        config: JsonObject,
    ) -> Any:
        async def ensure() -> JsonObject:
            return page_ref_to_dict(
                await adapter.ensure_profile(
                    handle=config["target"].get("handle"),
                    profile_url=config["target"].get("profile_url"),
                )
            )

        page_data = await context.step("session.ensure_profile", ensure, retry=RetryPolicy(max_attempts=2))
        return page_ref_from_dict(page_data)

    @classmethod
    async def _collect_timeline_candidates(
        cls,
        context: WorkflowContextPort,
        adapter: TwitterPageAdapter,
        page: Any,
        config: JsonObject,
        target_handle: str,
    ) -> tuple[list[JsonObject], str]:
        tweets_by_id: dict[str, JsonObject] = {}
        no_new_rounds = 0
        stop_reason = "max_scrolls"
        max_tweets = int(config["limits"]["max_tweets"])
        max_scrolls = int(config["limits"]["max_scrolls"])
        max_no_new_rounds = int(config["limits"]["max_no_new_rounds"])

        for index in range(max_scrolls + 1):
            await context.check_cancelled()

            async def collect() -> list[JsonObject]:
                return await adapter.read_tweets(
                    page,
                    target_handle=target_handle,
                    include_replies=bool(config["include"]["replies"]),
                    include_reposts=bool(config["include"]["reposts"]),
                    include_quotes=bool(config["include"]["quotes"]),
                )

            items = await context.step(f"collect.batch-{index + 1}", collect, retry=RetryPolicy(max_attempts=2))
            added = 0
            saw_before_period = False
            for item in items:
                relation = cls._period_relation(item.get("created_at"), config["period"])
                if relation == "before":
                    saw_before_period = True
                    continue
                if relation == "after":
                    continue
                tweet_id = str(item.get("tweet_id") or "")
                if tweet_id and tweet_id not in tweets_by_id:
                    tweets_by_id[tweet_id] = dict(item)
                    added += 1
                    if len(tweets_by_id) >= max_tweets:
                        break
            await context.emit(
                "twitter.collect_batch",
                {"batch": index + 1, "seen": len(items), "added": added, "total": len(tweets_by_id)},
            )
            if len(tweets_by_id) >= max_tweets:
                stop_reason = "max_tweets"
                break
            if saw_before_period and tweets_by_id:
                stop_reason = "period_complete"
                break
            no_new_rounds = no_new_rounds + 1 if added == 0 else 0
            if no_new_rounds >= max_no_new_rounds:
                stop_reason = "no_new_tweets"
                break
            if index >= max_scrolls:
                break

            async def scroll() -> JsonObject:
                return await adapter.scroll(page)

            await context.step(f"scroll.{index + 1}", scroll, retry=RetryPolicy(max_attempts=2))

        candidates = sorted(tweets_by_id.values(), key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return candidates[:max_tweets], stop_reason

    @classmethod
    async def _read_detail_result(
        cls,
        context: WorkflowContextPort,
        adapter: TwitterPageAdapter,
        page: Any,
        candidate: JsonObject,
        target_handle: str,
        config: JsonObject,
    ) -> JsonObject:
        detail_config = config["detail"]
        attempts = int(detail_config["detail_retry_attempts"])
        last_error: RpaError | None = None
        url = str(candidate.get("url") or "")
        tweet_id = str(candidate.get("tweet_id") or "")
        for attempt in range(1, attempts + 1):
            await context.check_cancelled()
            try:
                detail = await adapter.read_tweet_detail(
                    page,
                    url,
                    target_handle=target_handle,
                    timeout=float(detail_config["detail_timeout_seconds"]),
                    pause_seconds=float(detail_config["detail_pause_seconds"]),
                )
                merged_detail = dict(candidate)
                for key, value in detail.items():
                    if value is not None and value != "":
                        merged_detail[key] = value
                return {"ok": True, "tweet": merged_detail, "attempt": attempt}
            except RpaError as error:
                if error.kind in {ErrorKind.BLOCKED_AUTH, ErrorKind.BLOCKED_RISK, ErrorKind.CANCELLED}:
                    raise
                last_error = error
                if attempt < attempts:
                    await context.emit(
                        "twitter.detail_retry",
                        {
                            "tweet_id": tweet_id,
                            "url": url,
                            "attempt": attempt,
                            "next_attempt": attempt + 1,
                            "code": error.code,
                        },
                    )
                    await asyncio.sleep(float(detail_config["detail_pause_seconds"]))

        assert last_error is not None
        return {
            "ok": False,
            "failure": {
                "tweet_id": tweet_id,
                "source_url": url,
                "url": url,
                "author_handle": str(candidate.get("author_handle") or target_handle),
                "created_at": str(candidate.get("created_at") or ""),
                "period_key": str(config["period"]["key"]),
                "code": last_error.code,
                "message": last_error.message,
                "kind": str(last_error.kind),
                "details": last_error.details or {},
            },
        }

    @classmethod
    async def _collect_raw(
        cls,
        context: WorkflowContextPort,
        adapter: TwitterPageAdapter,
        config: JsonObject,
    ) -> JsonObject:
        page = await cls._ensure_profile(context, adapter, config)
        target_handle = cls._target_handle(config["target"])
        period = config["period"]
        scope_key = target_handle.lower()
        candidates, stop_reason = await cls._collect_timeline_candidates(context, adapter, page, config, target_handle)

        raw_tweets: list[JsonObject] = []
        raw_failures: list[JsonObject] = []
        consecutive_detail_timeouts = 0
        max_consecutive_detail_timeouts = int(config["detail"]["max_consecutive_detail_timeouts"])
        for index, candidate in enumerate(candidates, start=1):
            if index > 1 and float(config["detail"]["between_detail_seconds"]) > 0:
                await asyncio.sleep(float(config["detail"]["between_detail_seconds"]))

            async def read_detail(candidate_item: JsonObject = candidate) -> JsonObject:
                return await cls._read_detail_result(context, adapter, page, candidate_item, target_handle, config)

            result = await context.step(
                f"detail.{candidate['tweet_id']}",
                read_detail,
                retry=RetryPolicy(max_attempts=1),
            )
            if result.get("ok"):
                consecutive_detail_timeouts = 0
                detail = dict(result.get("tweet") or {})
                if cls._period_relation(detail.get("created_at"), period) != "inside":
                    continue
                raw_tweets.append(cls._raw_tweet_record(detail, period))
                await context.emit(
                    "twitter.detail_read",
                    {"index": index, "tweet_id": detail.get("tweet_id"), "records": len(raw_tweets)},
                )
            else:
                failure = dict(result.get("failure") or {})
                raw_failures.append(failure)
                if failure.get("code") == "WAIT_TIMEOUT":
                    consecutive_detail_timeouts += 1
                else:
                    consecutive_detail_timeouts = 0
                await context.emit(
                    "twitter.detail_failed",
                    {
                        "index": index,
                        "tweet_id": failure.get("tweet_id"),
                        "code": failure.get("code"),
                        "consecutive_detail_timeouts": consecutive_detail_timeouts,
                    },
                )
                if consecutive_detail_timeouts >= max_consecutive_detail_timeouts:
                    stop_reason = "consecutive_detail_timeouts"
                    await context.emit(
                        "twitter.detail_abort",
                        {
                            "reason": stop_reason,
                            "threshold": max_consecutive_detail_timeouts,
                            "detail_failed": len(raw_failures),
                        },
                    )
                    break

        pending = await context.upsert_period_items(
            scope_key,
            period["key"],
            raw_tweets,
            workflow_id=TWITTER_LEDGER_WORKFLOW_ID,
        )
        artifacts = await cls._write_period_outputs(
            context,
            config,
            scope_key,
            newly_discovered=raw_tweets,
            pending_count=len(pending),
            raw_failures=raw_failures,
            stop_reason=stop_reason,
            phase="collect",
            consecutive_detail_timeouts=consecutive_detail_timeouts,
        )
        return {
            "phase": "collect",
            "target": config["target"],
            "period": period,
            "collected": artifacts["summary"]["collected"],
            "discovered_this_run": len(raw_tweets),
            "new_for_cleaning": len(pending),
            "cleaned": artifacts["summary"]["cleaned"],
            "prompts": artifacts["summary"]["prompts"],
            "llm_failed": artifacts["summary"]["llm_failed"],
            "detail_failed": len(raw_failures),
            "consecutive_detail_timeouts": consecutive_detail_timeouts,
            "max_consecutive_detail_timeouts": max_consecutive_detail_timeouts,
            "stop_reason": stop_reason,
            **artifacts["paths"],
        }

    @classmethod
    async def _clean_pending(cls, context: WorkflowContextPort, config: JsonObject) -> JsonObject:
        target_handle = cls._target_handle(config["target"])
        period = config["period"]
        scope_key = target_handle.lower()
        ledger = await context.list_period_items(
            scope_key,
            period["key"],
            workflow_id=TWITTER_LEDGER_WORKFLOW_ID,
        )
        pending = [
            dict(item["input"])
            for item in ledger
            if item.get("status") == "pending" and isinstance(item.get("input"), dict)
        ]
        newly_cleaned: list[JsonObject] = []
        newly_failed: list[JsonObject] = []
        batch_size = int(config["llm"]["batch_size"])
        for offset in range(0, len(pending), batch_size):
            batch = list(pending[offset: offset + batch_size])

            async def clean_batch(batch_items: list[JsonObject] = batch) -> JsonObject:
                return await cls._clean_batch(context, batch_items, config["llm"])

            result = await context.step(
                f"clean.batch-{offset // batch_size + 1}",
                clean_batch,
                retry=RetryPolicy(max_attempts=1),
            )
            completions = cls._completion_records(result, batch)
            await context.complete_period_items(
                scope_key,
                period["key"],
                completions,
                workflow_id=TWITTER_LEDGER_WORKFLOW_ID,
            )
            newly_cleaned.extend(item for item in completions if item.get("status") in {"cleaned", "dropped"})
            newly_failed.extend(item for item in completions if item.get("status") == "failed")

        artifacts = await cls._write_period_outputs(
            context,
            config,
            scope_key,
            newly_cleaned=newly_cleaned,
            newly_failed=newly_failed,
            pending_count=len(pending),
            raw_failures=[],
            stop_reason="clean_complete",
            phase="clean",
            consecutive_detail_timeouts=0,
        )
        return {
            "phase": "clean",
            "target": config["target"],
            "period": period,
            "pending_before": len(pending),
            "cleaned": artifacts["summary"]["cleaned"],
            "prompts": artifacts["summary"]["prompts"],
            "llm_failed": artifacts["summary"]["llm_failed"],
            "newly_cleaned": len(newly_cleaned),
            "newly_failed": len(newly_failed),
            **artifacts["paths"],
        }

    @staticmethod
    async def _clean_batch(
        context: WorkflowContextPort,
        tweets: list[JsonObject],
        llm_config: JsonObject,
    ) -> JsonObject:
        if not tweets:
            return {"cleaned": [], "failed": []}
        try:
            return await context.llm.run_workflow(
                "prompt.clean.v1",
                {
                    "items": [
                        {
                            "id": item["tweet_id"],
                            "source_url": item["source_url"],
                            "text": item["text"],
                            "context": {
                                "author_handle": item.get("author_handle"),
                                "created_at": item.get("created_at"),
                                "period_key": item.get("period_key"),
                            },
                        }
                        for item in tweets
                    ]
                },
                llm_config,
            )
        except RpaError as error:
            return {
                "cleaned": [],
                "failed": [
                    {
                        "id": item.get("tweet_id"),
                        "source_url": item.get("source_url"),
                        "code": error.code,
                        "message": error.message,
                        "details": error.details or {},
                    }
                    for item in tweets
                ],
            }

    @staticmethod
    def _completion_records(result: JsonObject, batch: list[JsonObject]) -> list[JsonObject]:
        by_id = {str(item["tweet_id"]): item for item in batch}
        completions: list[JsonObject] = []
        for item in result.get("cleaned", []):
            if not isinstance(item, dict):
                continue
            tweet_id = str(item.get("id") or item.get("tweet_id") or "")
            source = by_id.get(tweet_id, {})
            completions.append(
                {
                    "id": tweet_id,
                    "tweet_id": tweet_id,
                    "source_url": str(item.get("source_url") or source.get("source_url") or ""),
                    "prompt": str(item.get("prompt") or ""),
                    "topic": str(item.get("topic") or ""),
                    "quality": str(item.get("quality") or "medium"),
                    "reason": str(item.get("reason") or ""),
                    "dropped": bool(item.get("dropped")),
                    "status": "dropped" if item.get("dropped") else "cleaned",
                }
            )
        for item in result.get("failed", []):
            if not isinstance(item, dict):
                continue
            tweet_id = str(item.get("id") or item.get("tweet_id") or "")
            source = by_id.get(tweet_id, {})
            completions.append(
                {
                    "id": tweet_id,
                    "tweet_id": tweet_id,
                    "source_url": str(item.get("source_url") or source.get("source_url") or ""),
                    "code": str(item.get("code") or "LLM_FAILED"),
                    "message": str(item.get("message") or "PromptLoom workflow failed for this tweet"),
                    "details": item.get("details") if isinstance(item.get("details"), dict) else {},
                    "status": "failed",
                }
            )
        return completions

    @classmethod
    async def _write_period_outputs(
        cls,
        context: WorkflowContextPort,
        config: JsonObject,
        scope_key: str,
        *,
        newly_discovered: list[JsonObject] | None = None,
        newly_cleaned: list[JsonObject] | None = None,
        newly_failed: list[JsonObject] | None = None,
        pending_count: int,
        raw_failures: list[JsonObject],
        stop_reason: str,
        phase: str,
        consecutive_detail_timeouts: int = 0,
    ) -> JsonObject:
        period = config["period"]
        ledger = await context.list_period_items(
            scope_key,
            period["key"],
            workflow_id=TWITTER_LEDGER_WORKFLOW_ID,
        )
        raw_records = [dict(item["input"]) for item in ledger if isinstance(item.get("input"), dict)]
        cleaned = [
            dict(item["output"])
            for item in ledger
            if item.get("status") in {"cleaned", "dropped"} and isinstance(item.get("output"), dict)
        ]
        failed = [
            dict(item["output"])
            for item in ledger
            if item.get("status") == "failed" and isinstance(item.get("output"), dict)
        ]
        prompt_records = [item for item in cleaned if not item.get("dropped")]
        raw_json_artifact = await context.write_period_report(
            "twitter",
            scope_key,
            period["key"],
            "raw.jsonl",
            cls._jsonl(raw_records),
            "twitter_period_raw_jsonl",
            {"records": len(raw_records), "target": config["target"], "period": period},
        )
        cleaned_json_artifact = await context.write_period_report(
            "twitter",
            scope_key,
            period["key"],
            "prompts.jsonl",
            cls._jsonl(cleaned),
            "twitter_period_prompts_jsonl",
            {"records": len(cleaned), "prompts": len(prompt_records), "target": config["target"], "period": period},
        )
        failed_artifact = await context.write_period_report(
            "twitter",
            scope_key,
            period["key"],
            "failed.jsonl",
            cls._jsonl(failed),
            "twitter_period_failures_jsonl",
            {"records": len(failed), "target": config["target"], "period": period},
        )
        summary = {
            "phase": phase,
            "target": config["target"],
            "period": period,
            "collected": len(raw_records),
            "discovered_this_run": len(newly_discovered or []),
            "new_for_cleaning": pending_count,
            "cleaned": len(cleaned),
            "prompts": len(prompt_records),
            "llm_failed": len(failed),
            "newly_cleaned": len(newly_cleaned or []),
            "newly_failed": len(newly_failed or []),
            "detail_failed": len(raw_failures),
            "consecutive_detail_timeouts": consecutive_detail_timeouts,
            "max_consecutive_detail_timeouts": int(config["detail"]["max_consecutive_detail_timeouts"]),
            "stop_reason": stop_reason,
        }
        summary_artifact = await context.write_period_report(
            "twitter",
            scope_key,
            period["key"],
            "summary.json",
            json.dumps(summary, ensure_ascii=False, indent=2),
            "twitter_period_summary_json",
            {"target": config["target"], "period": period},
        )
        paths = {
            "raw_artifact_path": raw_json_artifact.path,
            "prompts_artifact_path": cleaned_json_artifact.path,
            "failed_artifact_path": failed_artifact.path,
            "summary_artifact_path": summary_artifact.path,
        }
        if phase == "collect" or raw_failures:
            raw_failed_artifact = await context.write_period_report(
                "twitter",
                scope_key,
                period["key"],
                "raw-failures.jsonl",
                cls._jsonl(raw_failures),
                "twitter_period_raw_failures_jsonl",
                {"records": len(raw_failures), "target": config["target"], "period": period},
            )
            paths["raw_failures_artifact_path"] = raw_failed_artifact.path
        return {
            "summary": summary,
            "paths": paths,
        }

    @classmethod
    def _raw_tweet_record(cls, detail: JsonObject, period: JsonObject) -> JsonObject:
        text = str(detail.get("text") or "").strip()
        source_url = str(detail.get("source_url") or detail.get("url") or "").strip()
        content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return {
            "tweet_id": str(detail.get("tweet_id") or ""),
            "source_url": source_url,
            "url": source_url,
            "author_handle": str(detail.get("author_handle") or "").lower(),
            "created_at": str(detail.get("created_at") or ""),
            "period_key": str(period["key"]),
            "text": text,
            "content_hash": content_hash,
        }

    @classmethod
    def _period_config(cls, value: Any, input_value: Any = None) -> JsonObject:
        data = dict(value or {})
        if isinstance(input_value, dict):
            data.update(input_value)
        timezone_name = str(data.get("timezone") or "Asia/Shanghai")
        timezone = ZoneInfo(timezone_name)
        granularity = str(data.get("granularity") or "week")
        if data.get("week"):
            match = re.fullmatch(r"(\d{4})-W(\d{2})", str(data["week"]))
            if not match:
                raise RpaError("TWITTER_PERIOD_INVALID", "Twitter week must use YYYY-Www")
            start_date = dt.date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
            end_date = start_date + dt.timedelta(days=7)
            key = f"{start_date.isocalendar().year}-W{start_date.isocalendar().week:02d}"
        elif data.get("start_date") or data.get("end_date"):
            if not data.get("start_date") or not data.get("end_date"):
                raise RpaError("TWITTER_PERIOD_INVALID", "Both start_date and end_date are required")
            start_date = dt.date.fromisoformat(str(data["start_date"]))
            inclusive_end = dt.date.fromisoformat(str(data["end_date"]))
            end_date = inclusive_end + dt.timedelta(days=1)
            key = f"{start_date.isoformat()}_{inclusive_end.isoformat()}"
            granularity = "range"
        else:
            today = dt.datetime.now(timezone).date()
            iso = today.isocalendar()
            start_date = dt.date.fromisocalendar(iso.year, iso.week, 1)
            end_date = start_date + dt.timedelta(days=7)
            key = f"{iso.year}-W{iso.week:02d}"
        start = dt.datetime.combine(start_date, dt.time.min, tzinfo=timezone)
        end = dt.datetime.combine(end_date, dt.time.min, tzinfo=timezone)
        return {
            "granularity": granularity,
            "timezone": timezone_name,
            "key": key,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "start_date": start_date.isoformat(),
            "end_date": (end_date - dt.timedelta(days=1)).isoformat(),
        }

    @staticmethod
    def _period_relation(created_at: Any, period: JsonObject) -> str:
        value = str(created_at or "").strip()
        if not value:
            return "unknown"
        try:
            created = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            if created.tzinfo is None:
                created = created.replace(tzinfo=dt.timezone.utc)
            start = dt.datetime.fromisoformat(str(period["start"]))
            end = dt.datetime.fromisoformat(str(period["end"]))
        except ValueError:
            return "unknown"
        local_created = created.astimezone(start.tzinfo)
        if local_created < start:
            return "before"
        if local_created >= end:
            return "after"
        return "inside"

    @staticmethod
    def _normalize_target(target: JsonObject) -> JsonObject:
        normalized = dict(target)
        handle = str(normalized.get("handle") or "").strip()
        profile_url = str(normalized.get("profile_url") or "").strip()
        if profile_url:
            normalized["profile_url"] = TwitterPageAdapter.profile_url(profile_url=profile_url)
            normalized.pop("handle", None)
        elif handle and TwitterWorkflowSupport._looks_like_profile_url(handle):
            normalized["profile_url"] = handle
            normalized.pop("handle", None)
        elif handle:
            normalized["handle"] = TwitterPageAdapter.normalize_handle(handle)
        if normalized.get("profile_url"):
            normalized["profile_url"] = TwitterPageAdapter.profile_url(profile_url=str(normalized["profile_url"]))
        return normalized

    @staticmethod
    def _looks_like_profile_url(value: str) -> bool:
        lowered = value.strip().lower()
        return "://" in lowered or lowered.startswith(("x.com/", "twitter.com/", "www.x.com/", "www.twitter.com/"))

    @staticmethod
    def _target_handle(target: JsonObject) -> str:
        if target.get("handle"):
            return TwitterPageAdapter.normalize_handle(str(target["handle"]))
        if target.get("profile_url"):
            return TwitterPageAdapter.normalize_handle(str(target["profile_url"]))
        return ""

    @staticmethod
    def _jsonl(records: list[JsonObject]) -> str:
        return "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in records)


class TwitterCollectRawWorkflow(TwitterWorkflowSupport):
    descriptor = WorkflowDescriptor(
        id="twitter.collect-raw.v1",
        version="1.0.0",
        title="Twitter original tweet raw collection",
        capabilities=("safari.dom", "safari.navigation"),
        input_schema={
            "type": "object",
            "properties": {"handle": {"type": "string"}, "profile_url": {"type": "string"}},
        },
        config_schema={
            "type": "object",
            "properties": {
                "target": {"type": "object"},
                "include": {"type": "object"},
                "limits": {"type": "object"},
                "period": {"type": "object"},
                "detail": {"type": "object"},
            },
        },
    )

    async def execute(self, context: WorkflowContextPort) -> JsonObject:
        config = self._config(context.config, context.input)
        adapter = TwitterPageAdapter(context.safari)
        return await self._collect_raw(context, adapter, config)


class TwitterCleanPromptsWorkflow(TwitterWorkflowSupport):
    descriptor = WorkflowDescriptor(
        id="twitter.clean-prompts.v1",
        version="1.0.0",
        title="Twitter raw tweet PromptLoom cleanup",
        capabilities=("llm.local.lmstudio",),
        input_schema={
            "type": "object",
            "properties": {"handle": {"type": "string"}, "profile_url": {"type": "string"}},
        },
        config_schema={
            "type": "object",
            "properties": {
                "target": {"type": "object"},
                "llm": {"type": "object"},
                "period": {"type": "object"},
            },
        },
    )

    async def execute(self, context: WorkflowContextPort) -> JsonObject:
        config = self._config(context.config, context.input)
        return await self._clean_pending(context, config)


class TwitterPromptWorkflow(TwitterWorkflowSupport):
    descriptor = WorkflowDescriptor(
        id="twitter.extract-prompts.v1",
        version="1.0.0",
        title="DEPRECATED: Twitter raw collection and local prompt cleanup",
        capabilities=("safari.dom", "safari.navigation", "llm.local.lmstudio"),
        input_schema={
            "type": "object",
            "properties": {"handle": {"type": "string"}, "profile_url": {"type": "string"}},
        },
        config_schema={
            "type": "object",
            "properties": {
                "target": {"type": "object"},
                "include": {"type": "object"},
                "limits": {"type": "object"},
                "llm": {"type": "object"},
                "period": {"type": "object"},
                "detail": {"type": "object"},
            },
        },
    )

    async def execute(self, context: WorkflowContextPort) -> JsonObject:
        config = self._config(context.config, context.input)
        adapter = TwitterPageAdapter(context.safari)
        collect = await self._collect_raw(context, adapter, config)
        clean = await self._clean_pending(context, config)
        return {
            **clean,
            "phase": "combined_deprecated",
            "deprecated": True,
            "collected": collect["collected"],
            "discovered_this_run": collect["discovered_this_run"],
            "new_for_cleaning": collect["new_for_cleaning"],
            "detail_failed": collect["detail_failed"],
            "consecutive_detail_timeouts": collect["consecutive_detail_timeouts"],
            "max_consecutive_detail_timeouts": collect["max_consecutive_detail_timeouts"],
            "stop_reason": collect["stop_reason"],
            "raw_artifact_path": collect["raw_artifact_path"],
            "raw_failures_artifact_path": collect["raw_failures_artifact_path"],
        }
