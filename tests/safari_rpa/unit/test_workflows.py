from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import yaml

from macrpa.contracts.errors import ErrorKind, RpaError
from macrpa.contracts.runtime import RunStatus
from macrpa.contracts.safari import PageRef
from macrpa.runtime import ArtifactFiles, RunStore, WorkflowRegistry, WorkflowRunner
from macrpa.sites.twitter import TwitterPageAdapter as RealTwitterPageAdapter
from macrpa.workflows.boss import BossWorkflow
from macrpa.workflows.twitter import TwitterCleanPromptsWorkflow, TwitterCollectRawWorkflow, TwitterPromptWorkflow
from tests.safari_rpa.fakes import UnusedSafari


PAGE = PageRef("test-session", "test-marker", "example.com", 1, 1)
ROOT = Path(__file__).resolve().parents[3]
CONFIGS = ROOT / "local-api-usage" / "safari-rpa" / "configs"


class FakeBossAdapter:
    def __init__(self, job_ids: list[str] | None = None, *, preexisting: set[str] | None = None) -> None:
        self.communication_calls = 0
        self.communicated: set[str] = set(preexisting or ())
        self.job_ids = ["JOB-1"] if job_ids is None else job_ids
        self.read_calls = 0
        self.search_urls: list[str] = []

    async def ensure_page(self):
        return PAGE

    async def open_search(self, page, url):
        self.search_urls.append(url)
        if "page=1" in url:
            city = parse_qs(urlparse(url).query).get("city", [""])[0]
            return [
                {
                    "title": "Python",
                    "url": f"https://www.zhipin.com/job_detail/{city}-{job_id}.html",
                }
                for job_id in self.job_ids
            ]
        return []

    async def read_job(self, page, url):
        self.read_calls += 1
        job_id = Path(urlparse(url).path).stem
        return {
            "job_id": job_id,
            "url": url,
            "title": "Python Engineer",
            "company": "Example",
            "scale": "1000-9999人",
            "salary": "15-20K",
            "experience": "1-3年",
            "education": "本科",
            "location": "深圳",
            "jd": "Build reliable systems",
        }

    async def communicate(self, page, job_id):
        self.communication_calls += 1
        self.communicated.add(job_id)
        return {
            "confirmed": True,
            "performed": True,
            "preexisting": False,
            "job_id": job_id,
            "button_text": "继续沟通",
        }

    async def communication_state(self, page, job_id):
        return {
            "job_id": job_id,
            "same_job": True,
            "status": "communicated" if job_id in self.communicated else "available",
            "button_text": "继续沟通" if job_id in self.communicated else "立即沟通",
        }

    async def reconcile_communication(self, page, job_id):
        if job_id not in self.communicated:
            return None
        return {
            "confirmed": True,
            "performed": True,
            "preexisting": False,
            "reconciled": True,
            "job_id": job_id,
            "button_text": "继续沟通",
        }


class FakeTwitterAdapter:
    def __init__(self, batches: list[list[dict]]) -> None:
        self.batches = batches
        self.read_calls = 0
        self.scroll_calls = 0
        self.ensure_calls = []
        self.detail_calls: list[str] = []
        self.detail_options: list[dict] = []

    async def ensure_profile(self, *, handle=None, profile_url=None):
        self.ensure_calls.append({"handle": handle, "profile_url": profile_url})
        return PAGE

    async def read_tweets(self, page, *, target_handle="", include_replies=False, include_reposts=False, include_quotes=False):
        index = min(self.read_calls, len(self.batches) - 1)
        self.read_calls += 1
        return self.batches[index]

    async def read_tweet_detail(self, page, url, *, target_handle="", timeout=60.0, pause_seconds=2.0):
        self.detail_calls.append(url)
        self.detail_options.append({"timeout": timeout, "pause_seconds": pause_seconds})
        for batch in self.batches:
            for item in batch:
                if item.get("url") == url:
                    if item.get("detail_error"):
                        raise item["detail_error"]
                    if item.get("detail_value") is not None:
                        return dict(item["detail_value"])
                    detail = dict(item)
                    detail["text"] = detail.get("full_text") or detail.get("text")
                    return detail
        raise RpaError("TWITTER_TWEET_DETAIL_INVALID", "missing detail")

    async def scroll(self, page):
        self.scroll_calls += 1
        return {"scroll_y": self.scroll_calls * 100, "scroll_height": 1000}


class FakeLlmClient:
    def __init__(self, response=None, error: RpaError | None = None) -> None:
        self.response = response or {"cleaned": [], "failed": []}
        self.error = error
        self.calls: list[dict] = []

    async def run_workflow(self, workflow_id, input_data, runtime_options=None):
        self.calls.append({"workflow_id": workflow_id, "input": input_data, "runtime_options": runtime_options})
        self.config = runtime_options
        if self.error:
            raise self.error
        return self.response


class TwitterAdapterFactory:
    normalize_handle = staticmethod(RealTwitterPageAdapter.normalize_handle)
    profile_url = staticmethod(RealTwitterPageAdapter.profile_url)

    def __init__(self, adapter: FakeTwitterAdapter) -> None:
        self.adapter = adapter

    def __call__(self, safari):
        return self.adapter


class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = await RunStore(self.root / "state.sqlite").open()

    async def asyncTearDown(self) -> None:
        await self.store.close()
        self.temporary.cleanup()

    async def test_boss_matches_communicates_and_deduplicates_across_runs(self) -> None:
        fake = FakeBossAdapter()
        registry = WorkflowRegistry()
        workflow = BossWorkflow()
        registry.register(workflow)
        runner = WorkflowRunner(self.store, registry, UnusedSafari(), ArtifactFiles(self.root / "var"))
        config = {
            "search": {"cities": [{"name": "深圳", "code": "101280600"}], "keywords": ["python"]},
            "criteria": {
                "experience_allow": ["1-3年"],
                "education_deny": ["硕士", "博士"],
                "company_size_min": 500,
                "salary_min_k": 10,
                "salary_max_k": 20,
            },
            "limits": {"daily": 10, "per_city": 10, "max_pages": 2},
            "communication": {"enabled": True},
        }
        with patch("macrpa.workflows.boss.BossPageAdapter", return_value=fake):
            first = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(first.id)
            second = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(second.id)
        first_record = await self.store.get_run(first.id)
        second_record = await self.store.get_run(second.id)
        self.assertEqual(RunStatus.SUCCEEDED, first_record.status)
        self.assertEqual(RunStatus.SUCCEEDED, second_record.status)
        self.assertEqual(1, fake.communication_calls)
        self.assertEqual(1, second_record.output["skipped"])
        self.assertTrue(await self.store.list_artifacts(first.id))

    async def test_boss_stops_immediately_at_run_quota(self) -> None:
        fake = FakeBossAdapter(["JOB-1", "JOB-2", "JOB-3"])
        workflow, runner = self._boss_runner()
        config = self._boss_config(run=1, daily=110, per_city=10)
        with patch("macrpa.workflows.boss.BossPageAdapter", return_value=fake):
            run = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(1, completed.output["run_confirmed"])
        self.assertEqual(1, fake.communication_calls)
        self.assertEqual(1, fake.read_calls)

    async def test_boss_preexisting_communication_is_not_counted_or_written(self) -> None:
        fake = FakeBossAdapter(["JOB-1"], preexisting={"101280600-JOB-1"})
        workflow, runner = self._boss_runner()
        config = self._boss_config(run=10, daily=110, per_city=10)
        with patch("macrpa.workflows.boss.BossPageAdapter", return_value=fake):
            run = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(0, completed.output["run_confirmed"])
        self.assertEqual(1, completed.output["already_communicated"])
        self.assertEqual(0, fake.communication_calls)
        csv_text = Path(completed.output["artifact_path"]).read_text(encoding="utf-8-sig")
        self.assertEqual(1, len(csv_text.splitlines()))

    async def test_boss_experience_mismatch_is_skipped_from_quota_and_daily_report(self) -> None:
        class MismatchAdapter(FakeBossAdapter):
            async def communicate(self, page, job_id):
                self.communication_calls += 1
                return {"confirmed": False, "performed": False, "preexisting": False,
                        "job_id": job_id, "outcome": "skipped_experience_mismatch"}

        fake = MismatchAdapter(["JOB-1"])
        workflow, runner = self._boss_runner()
        with patch("macrpa.workflows.boss.BossPageAdapter", return_value=fake):
            run = await runner.create_run(workflow.descriptor.id, self._boss_config(run=1, daily=110, per_city=10), {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(0, completed.output["run_confirmed"])
        self.assertEqual(1, completed.output["experience_mismatch_skipped"])
        report = await self.store.get_report(completed.output["daily_report_id"])
        self.assertEqual(0, report.record_count)
        self.assertEqual(1, len(Path(report.path).read_text(encoding="utf-8-sig").splitlines()))

    async def test_boss_rejects_non_developer_titles_before_communication(self) -> None:
        class SalesAdapter(FakeBossAdapter):
            async def read_job(self, page, url):
                job = await super().read_job(page, url)
                job["title"] = "AI产品经理"
                return job

        fake = SalesAdapter(["JOB-1"])
        workflow, runner = self._boss_runner()
        config = self._boss_config(run=1, daily=110, per_city=10)
        with patch("macrpa.workflows.boss.BossPageAdapter", return_value=fake):
            run = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual(0, completed.output["run_confirmed"])
        self.assertEqual(1, completed.output["rejected"])
        self.assertEqual(0, fake.communication_calls)

    async def test_boss_test_records_reduce_same_day_production_target(self) -> None:
        workflow, runner = self._boss_runner()
        test_fake = FakeBossAdapter([f"JOB-{index}" for index in range(10)])
        test_config = self._boss_config(run=10, daily=110, per_city=10)
        with patch("macrpa.workflows.boss.BossPageAdapter", return_value=test_fake):
            test_run = await runner.create_run(workflow.descriptor.id, test_config, {})
            await runner.execute(test_run.id)
        production_fake = FakeBossAdapter([])
        production_config = self._boss_config(run=110, daily=110, per_city=10)
        with patch("macrpa.workflows.boss.BossPageAdapter", return_value=production_fake):
            production_run = await runner.create_run(workflow.descriptor.id, production_config, {})
            await runner.execute(production_run.id)
        completed = await self.store.get_run(production_run.id)
        self.assertEqual(10, completed.output["daily_completed_before_run"])
        self.assertEqual(100, completed.output["new_target"])
        self.assertEqual(10, completed.output["daily_confirmed_total"])
        self.assertEqual([], production_fake.search_urls)

    async def test_random_city_rotation_is_checkpointed(self) -> None:
        fake = FakeBossAdapter([])
        workflow, runner = self._boss_runner()
        config = self._boss_config(run=1, daily=110, per_city=10)
        config["search"]["cities"].append({"name": "广州", "code": "101280100"})
        with (
            patch("macrpa.workflows.boss.BossPageAdapter", return_value=fake),
            patch("macrpa.workflows.boss.random.randrange", return_value=1) as choose,
        ):
            run = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(run.id)
        planned = await self.store.get_step(run.id, "plan.city_order")
        self.assertEqual(1, choose.call_count)
        self.assertEqual(["广州", "深圳"], [city["name"] for city in planned.output["cities"]])

    async def test_twitter_deprecated_combined_collects_raw_tweets_and_cleaned_prompts(self) -> None:
        tweets = [
            {
                "tweet_id": "1",
                "url": "https://x.com/example/status/1",
                "author_handle": "example",
                "created_at": "2026-06-27T00:00:00.000Z",
                "text": "timeline 截断",
                "full_text": "给我一个拆解复杂任务的提示词",
            },
            {
                "tweet_id": "2",
                "url": "https://x.com/example/status/2",
                "author_handle": "example",
                "created_at": "2026-06-26T00:00:00.000Z",
                "text": "早餐很好吃",
            },
        ]
        adapter = FakeTwitterAdapter([tweets])
        llm = FakeLlmClient(
            {
                "cleaned": [
                    {
                        "id": "1",
                        "source_url": "https://x.com/example/status/1",
                        "prompt": "把复杂任务拆成可验证步骤，并列出验收标准。",
                        "topic": "planning",
                        "quality": "high",
                        "reason": "明确可复用",
                        "dropped": False,
                    },
                    {
                        "id": "2",
                        "source_url": "https://x.com/example/status/2",
                        "prompt": "",
                        "topic": "daily",
                        "quality": "low",
                        "reason": "闲聊",
                        "dropped": True,
                    },
                ]
            }
        )
        workflow, runner = self._twitter_runner(TwitterPromptWorkflow(), llm)
        with (
            patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(adapter)),
        ):
            run = await runner.create_run(workflow.descriptor.id, self._twitter_config(max_tweets=2), {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertTrue(completed.output["deprecated"])
        self.assertEqual("combined_deprecated", completed.output["phase"])
        self.assertEqual(2, completed.output["collected"])
        self.assertEqual(2, completed.output["new_for_cleaning"])
        self.assertEqual(2, completed.output["cleaned"])
        self.assertEqual(1, completed.output["prompts"])
        self.assertEqual("max_tweets", completed.output["stop_reason"])
        prompt_jsonl = Path(completed.output["prompts_artifact_path"]).read_text(encoding="utf-8")
        self.assertIn("把复杂任务拆成可验证步骤", prompt_jsonl)
        raw_jsonl = Path(completed.output["raw_artifact_path"]).read_text(encoding="utf-8")
        self.assertIn("给我一个拆解复杂任务的提示词", raw_jsonl)
        self.assertIn("2026-W26", completed.output["period"]["key"])
        self.assertEqual(1, len(llm.calls))
        self.assertEqual("prompt.clean.v1", llm.calls[0]["workflow_id"])
        self.assertEqual("local-model", llm.config["model"])
        self.assertEqual({"timeout": 1.0, "pause_seconds": 0.0}, adapter.detail_options[0])

    async def test_twitter_collect_raw_does_not_call_llm(self) -> None:
        tweet = {
            "tweet_id": "1",
            "url": "https://x.com/example/status/1",
            "author_handle": "example",
            "created_at": "2026-06-27T00:00:00.000Z",
            "text": "timeline 截断",
            "full_text": "给我一个采集阶段不要清洗的提示词",
        }
        adapter = FakeTwitterAdapter([[tweet]])
        llm = FakeLlmClient()
        workflow, runner = self._twitter_runner(TwitterCollectRawWorkflow(), llm)
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(adapter)):
            run = await runner.create_run(workflow.descriptor.id, self._twitter_config(max_tweets=1), {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual("collect", completed.output["phase"])
        self.assertEqual(1, completed.output["collected"])
        self.assertEqual(1, completed.output["new_for_cleaning"])
        self.assertEqual(0, completed.output["cleaned"])
        self.assertEqual([], llm.calls)
        raw_jsonl = Path(completed.output["raw_artifact_path"]).read_text(encoding="utf-8")
        self.assertIn("采集阶段不要清洗", raw_jsonl)

    async def test_twitter_collect_merges_timeline_metadata_for_title_fallback_detail(self) -> None:
        tweet = {
            "tweet_id": "1",
            "url": "https://x.com/example/status/1",
            "author_handle": "example",
            "created_at": "2026-06-27T00:00:00.000Z",
            "text": "timeline 截断",
            "detail_value": {
                "tweet_id": "1",
                "url": "https://x.com/example/status/1",
                "author_handle": "",
                "created_at": "",
                "text": "从标题兜底得到的完整 prompt",
                "is_reply": False,
                "is_repost": False,
                "is_quote": False,
            },
        }
        adapter = FakeTwitterAdapter([[tweet]])
        workflow, runner = self._twitter_runner(TwitterCollectRawWorkflow(), FakeLlmClient())
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(adapter)):
            run = await runner.create_run(workflow.descriptor.id, self._twitter_config(max_tweets=1), {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual(1, completed.output["collected"])
        raw = json.loads(Path(completed.output["raw_artifact_path"]).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual("从标题兜底得到的完整 prompt", raw["text"])
        self.assertEqual("2026-06-27T00:00:00.000Z", raw["created_at"])
        self.assertEqual("example", raw["author_handle"])

    async def test_twitter_clean_prompts_reads_pending_without_safari(self) -> None:
        tweet = {
            "tweet_id": "1",
            "url": "https://x.com/example/status/1",
            "author_handle": "example",
            "created_at": "2026-06-27T00:00:00.000Z",
            "text": "Prompt idea",
        }
        collect_workflow, collect_runner = self._twitter_runner(TwitterCollectRawWorkflow(), FakeLlmClient())
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(FakeTwitterAdapter([[tweet]]))):
            collect_run = await collect_runner.create_run(collect_workflow.descriptor.id, self._twitter_config(max_tweets=1), {})
            await collect_runner.execute(collect_run.id)

        llm = FakeLlmClient(
            {
                "cleaned": [
                    {
                        "id": "1",
                        "source_url": tweet["url"],
                        "prompt": "Prompt idea",
                        "topic": "ideas",
                        "quality": "medium",
                        "reason": "usable",
                        "dropped": False,
                    }
                ]
            }
        )
        clean_workflow, clean_runner = self._twitter_runner(TwitterCleanPromptsWorkflow(), llm)
        clean_run = await clean_runner.create_run(clean_workflow.descriptor.id, self._twitter_config(max_tweets=1), {})
        await clean_runner.execute(clean_run.id)
        completed = await self.store.get_run(clean_run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual("clean", completed.output["phase"])
        self.assertEqual(1, completed.output["pending_before"])
        self.assertEqual(1, completed.output["prompts"])
        self.assertEqual(1, len(llm.calls))
        self.assertEqual("prompt.clean.v1", llm.calls[0]["workflow_id"])

    async def test_twitter_stops_after_no_new_rounds(self) -> None:
        tweet = {
            "tweet_id": "1",
            "url": "https://x.com/example/status/1",
            "author_handle": "example",
            "created_at": "2026-06-27T00:00:00.000Z",
            "text": "Prompt idea",
        }
        adapter = FakeTwitterAdapter([[tweet], [tweet]])
        llm = FakeLlmClient()
        workflow, runner = self._twitter_runner(TwitterCollectRawWorkflow(), llm)
        config = self._twitter_config(max_tweets=3)
        config["limits"]["max_no_new_rounds"] = 1
        with (
            patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(adapter)),
        ):
            run = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual("no_new_tweets", completed.output["stop_reason"])
        self.assertEqual(1, completed.output["collected"])
        self.assertEqual(1, adapter.scroll_calls)
        self.assertEqual([], llm.calls)

    async def test_twitter_detail_failure_writes_raw_failure_without_calling_llm(self) -> None:
        tweet = {
            "tweet_id": "1",
            "url": "https://x.com/example/status/1",
            "author_handle": "example",
            "created_at": "2026-06-27T00:00:00.000Z",
            "text": "Prompt idea",
            "detail_error": RpaError("WAIT_TIMEOUT", "black screen", ErrorKind.RETRYABLE),
        }
        adapter = FakeTwitterAdapter([[tweet]])
        llm = FakeLlmClient()
        workflow, runner = self._twitter_runner(TwitterCollectRawWorkflow(), llm)
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(adapter)):
            run = await runner.create_run(workflow.descriptor.id, self._twitter_config(max_tweets=1), {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual(0, completed.output["collected"])
        self.assertEqual(0, completed.output["new_for_cleaning"])
        self.assertEqual(1, completed.output["detail_failed"])
        self.assertEqual([], llm.calls)
        raw_failure = json.loads(Path(completed.output["raw_failures_artifact_path"]).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual("WAIT_TIMEOUT", raw_failure["code"])

    async def test_twitter_collect_stops_after_three_consecutive_detail_timeouts(self) -> None:
        tweets = [
            {
                "tweet_id": str(index),
                "url": f"https://x.com/example/status/{index}",
                "author_handle": "example",
                "created_at": "2026-06-27T00:00:00.000Z",
                "text": "Prompt idea",
                "detail_error": RpaError("WAIT_TIMEOUT", "black screen", ErrorKind.RETRYABLE),
            }
            for index in range(1, 6)
        ]
        adapter = FakeTwitterAdapter([tweets])
        llm = FakeLlmClient()
        workflow, runner = self._twitter_runner(TwitterCollectRawWorkflow(), llm)
        config = self._twitter_config(max_tweets=5)
        config["detail"]["max_consecutive_detail_timeouts"] = 3
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(adapter)):
            run = await runner.create_run(workflow.descriptor.id, config, {})
            await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual("consecutive_detail_timeouts", completed.output["stop_reason"])
        self.assertEqual(3, completed.output["detail_failed"])
        self.assertEqual(3, completed.output["consecutive_detail_timeouts"])
        self.assertEqual(3, completed.output["max_consecutive_detail_timeouts"])
        self.assertEqual(3, len(adapter.detail_calls))
        self.assertEqual([], llm.calls)
        raw_failures = Path(completed.output["raw_failures_artifact_path"]).read_text(encoding="utf-8").splitlines()
        self.assertEqual(3, len(raw_failures))

    async def test_twitter_llm_failure_writes_failed_artifact_without_failing_run(self) -> None:
        tweet = {
            "tweet_id": "1",
            "url": "https://x.com/example/status/1",
            "author_handle": "example",
            "created_at": "2026-06-27T00:00:00.000Z",
            "text": "Prompt idea",
        }
        collect_workflow, collect_runner = self._twitter_runner(TwitterCollectRawWorkflow(), FakeLlmClient())
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(FakeTwitterAdapter([[tweet]]))):
            collect_run = await collect_runner.create_run(collect_workflow.descriptor.id, self._twitter_config(max_tweets=1), {})
            await collect_runner.execute(collect_run.id)

        llm = FakeLlmClient(error=RpaError("LLM_JSON_INVALID", "bad json", ErrorKind.RETRYABLE, {"response_preview": "nope"}))
        clean_workflow, clean_runner = self._twitter_runner(TwitterCleanPromptsWorkflow(), llm)
        run = await clean_runner.create_run(clean_workflow.descriptor.id, self._twitter_config(max_tweets=1), {})
        await clean_runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual(0, completed.output["cleaned"])
        self.assertEqual(1, completed.output["llm_failed"])
        failure = json.loads(Path(completed.output["failed_artifact_path"]).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual("LLM_JSON_INVALID", failure["code"])

    async def test_twitter_period_ledger_skips_previously_cleaned_tweets(self) -> None:
        tweet = {
            "tweet_id": "1",
            "url": "https://x.com/example/status/1",
            "author_handle": "example",
            "created_at": "2026-06-27T00:00:00.000Z",
            "text": "Prompt idea",
        }
        llm = FakeLlmClient(
            {"cleaned": [{"id": "1", "source_url": tweet["url"], "prompt": "Prompt idea", "topic": "", "quality": "medium", "reason": "", "dropped": False}]}
        )
        collect_workflow, collect_runner = self._twitter_runner(TwitterCollectRawWorkflow(), FakeLlmClient())
        clean_workflow, clean_runner = self._twitter_runner(TwitterCleanPromptsWorkflow(), llm)
        config = self._twitter_config(max_tweets=1)
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(FakeTwitterAdapter([[tweet]]))):
            first = await collect_runner.create_run(collect_workflow.descriptor.id, config, {})
            await collect_runner.execute(first.id)
        first_clean = await clean_runner.create_run(clean_workflow.descriptor.id, config, {})
        await clean_runner.execute(first_clean.id)
        with patch("macrpa.workflows.twitter.TwitterPageAdapter", TwitterAdapterFactory(FakeTwitterAdapter([[tweet]]))):
            second = await collect_runner.create_run(collect_workflow.descriptor.id, config, {})
            await collect_runner.execute(second.id)
        second_clean = await clean_runner.create_run(clean_workflow.descriptor.id, config, {})
        await clean_runner.execute(second_clean.id)
        completed = await self.store.get_run(second.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual(0, completed.output["new_for_cleaning"])
        self.assertEqual(1, completed.output["collected"])
        clean_completed = await self.store.get_run(second_clean.id)
        self.assertEqual(0, clean_completed.output["pending_before"])
        self.assertEqual(1, len(llm.calls))

    def test_twitter_config_preserves_local_model_and_profile_url_input(self) -> None:
        config = yaml.safe_load((CONFIGS / "twitter.yaml").read_text(encoding="utf-8"))
        input_data = json.loads((CONFIGS / "twitter-target.json").read_text(encoding="utf-8"))
        resolved = TwitterPromptWorkflow._config(config, input_data)
        self.assertEqual("gemma-4-12b-qat", resolved["llm"]["model"])
        self.assertEqual("https://x.com/Minahil42298354", resolved["target"]["profile_url"])
        self.assertEqual("Minahil42298354", TwitterPromptWorkflow._target_handle(resolved["target"]))
        self.assertEqual("week", resolved["period"]["granularity"])
        self.assertEqual("Asia/Shanghai", resolved["period"]["timezone"])
        self.assertFalse(resolved["include"]["quotes"])

    def test_twitter_two_phase_configs_preserve_target_model_and_detail_defaults(self) -> None:
        input_data = json.loads((CONFIGS / "twitter-target.json").read_text(encoding="utf-8"))
        collect_config = yaml.safe_load((CONFIGS / "twitter.collect.yaml").read_text(encoding="utf-8"))
        clean_config = yaml.safe_load((CONFIGS / "twitter.clean.yaml").read_text(encoding="utf-8"))
        collect = TwitterCollectRawWorkflow._config(collect_config, input_data)
        clean = TwitterCleanPromptsWorkflow._config(clean_config, input_data)
        self.assertEqual("https://x.com/Minahil42298354", collect["target"]["profile_url"])
        self.assertEqual("https://x.com/Minahil42298354", clean["target"]["profile_url"])
        self.assertEqual("gemma-4-12b-qat", clean["llm"]["model"])
        self.assertEqual(15.0, collect["detail"]["detail_timeout_seconds"])
        self.assertEqual(2.0, collect["detail"]["detail_pause_seconds"])
        self.assertEqual(2, collect["detail"]["detail_retry_attempts"])
        self.assertEqual(2.0, collect["detail"]["between_detail_seconds"])
        self.assertEqual(3, collect["detail"]["max_consecutive_detail_timeouts"])

    def test_twitter_config_accepts_explicit_week_period(self) -> None:
        resolved = TwitterPromptWorkflow._config(
            {
                "target": {"handle": "example"},
                "period": {"week": "2026-W26", "timezone": "Asia/Shanghai"},
                "llm": {"model": "local"},
            },
            {},
        )
        self.assertEqual("2026-W26", resolved["period"]["key"])
        self.assertEqual("2026-06-22", resolved["period"]["start_date"])
        self.assertEqual("2026-06-28", resolved["period"]["end_date"])

    def test_twitter_config_converts_url_in_handle_to_profile_url(self) -> None:
        resolved = TwitterPromptWorkflow._config(
            {"target": {"handle": "https://x.com/Minahil42298354"}, "llm": {"model": "local"}},
            {},
        )
        self.assertNotIn("handle", resolved["target"])
        self.assertEqual("https://x.com/Minahil42298354", resolved["target"]["profile_url"])
        self.assertEqual("Minahil42298354", TwitterPromptWorkflow._target_handle(resolved["target"]))

    def _boss_runner(self):
        registry = WorkflowRegistry()
        workflow = BossWorkflow()
        registry.register(workflow)
        return workflow, WorkflowRunner(self.store, registry, UnusedSafari(), ArtifactFiles(self.root / "var"))

    def _twitter_runner(self, workflow=None, llm: FakeLlmClient | None = None):
        registry = WorkflowRegistry()
        workflow = workflow or TwitterPromptWorkflow()
        registry.register(workflow)
        return workflow, WorkflowRunner(self.store, registry, UnusedSafari(), ArtifactFiles(self.root / "var"), llm)

    @staticmethod
    def _boss_config(*, run: int, daily: int, per_city: int):
        return {
            "search": {"cities": [{"name": "深圳", "code": "101280600"}], "keywords": ["python"]},
            "criteria": {
                "title_allow": ["开发", "Python", "iOS"],
                "title_deny": ["销售", "运营", "产品经理"],
                "experience_allow": ["1-3年"],
                "education_deny": ["硕士", "博士"],
                "company_size_min": 500,
                "salary_min_k": 10,
                "salary_max_k": 20,
            },
            "limits": {"run": run, "daily": daily, "per_city": per_city, "max_pages": 2},
            "ordering": {"strategy": "random_rotated"},
            "communication": {"enabled": True},
        }

    @staticmethod
    def _twitter_config(*, max_tweets: int):
        return {
            "target": {"handle": "example"},
            "include": {"replies": False, "reposts": False, "quotes": False},
            "period": {"week": "2026-W26", "timezone": "Asia/Shanghai"},
            "limits": {"max_tweets": max_tweets, "max_scrolls": 4, "max_no_new_rounds": 2},
            "detail": {
                "detail_timeout_seconds": 1,
                "detail_pause_seconds": 0,
                "detail_retry_attempts": 1,
                "between_detail_seconds": 0,
            },
            "llm": {"model": "local-model", "batch_size": 5, "retries": 0},
        }
