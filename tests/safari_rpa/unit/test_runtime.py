from __future__ import annotations

import tempfile
import time
import sys
import unittest
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from unittest.mock import AsyncMock, patch

from safari_rpa.contracts.errors import ErrorKind, RpaError
from safari_rpa.application import build_application
from safari_rpa.application.service import RpaApplication
from safari_rpa.contracts.runtime import RetryPolicy, RunStatus, WorkflowDescriptor
from safari_rpa.runtime import ArtifactFiles, RunStore, WorkflowRegistry, WorkflowRunner
from tests.safari_rpa.fakes import UnusedSafari


class RetryWorkflow:
    descriptor = WorkflowDescriptor("test.retry", "1", "Retry test")

    def __init__(self) -> None:
        self.calls = 0

    async def execute(self, context):
        async def flaky():
            self.calls += 1
            if self.calls < 3:
                raise RpaError("TRANSIENT", "try again", ErrorKind.RETRYABLE)
            return {"value": 42}

        value = await context.step(
            "read.flaky",
            flaky,
            retry=RetryPolicy(max_attempts=3, initial_delay=0, multiplier=1),
        )
        return {"step": value}


class SideEffectWorkflow:
    descriptor = WorkflowDescriptor("test.side-effect", "1", "Side effect test")

    async def execute(self, context):
        async def uncertain():
            raise RpaError("REMOTE_TIMEOUT", "outcome unknown", ErrorKind.RETRYABLE)

        await context.step("write.remote", uncertain, side_effect=True)
        return {}


class ScheduledWorkflow:
    descriptor = WorkflowDescriptor("test.scheduled", "1", "Scheduled test")

    async def execute(self, context):
        return {"scheduled": True, "config": context.config}


class ReadinessSafari:
    def __init__(self, failures: int = 0) -> None:
        self.failures = failures
        self.calls = 0

    async def inspect_windows(self):
        self.calls += 1
        if self.calls <= self.failures:
            raise RuntimeError("Safari locked")
        return []


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = await RunStore(self.root / "state.sqlite").open()

    async def asyncTearDown(self) -> None:
        await self.store.close()
        self.temporary.cleanup()

    async def test_retryable_read_retries_and_checkpoint_is_reused(self) -> None:
        workflow = RetryWorkflow()
        registry = WorkflowRegistry()
        registry.register(workflow)
        runner = WorkflowRunner(self.store, registry, UnusedSafari(), ArtifactFiles(self.root))
        run = await runner.create_run(workflow.descriptor.id, {}, {})
        await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        self.assertEqual(RunStatus.SUCCEEDED, completed.status)
        self.assertEqual(3, workflow.calls)
        step = await self.store.get_step(run.id, "read.flaky")
        self.assertEqual(3, step.attempts)

        await self.store.set_run_status(run.id, RunStatus.FAILED, error={"code": "test"})
        await runner.execute(run.id)
        self.assertEqual(3, workflow.calls, "completed checkpoint must not execute twice")

    async def test_uncertain_write_is_never_automatically_retried(self) -> None:
        workflow = SideEffectWorkflow()
        registry = WorkflowRegistry()
        registry.register(workflow)
        runner = WorkflowRunner(self.store, registry, UnusedSafari(), ArtifactFiles(self.root))
        run = await runner.create_run(workflow.descriptor.id, {}, {})
        await runner.execute(run.id)
        completed = await self.store.get_run(run.id)
        step = await self.store.get_step(run.id, "write.remote")
        self.assertEqual(RunStatus.UNKNOWN_SIDE_EFFECT, completed.status)
        self.assertEqual("unknown_side_effect", step.status)
        self.assertEqual(1, step.attempts)

    async def test_events_are_monotonic_and_resumable(self) -> None:
        run = await self.store.create_run("test", {}, {})
        first = await self.store.append_event(run.id, "custom.one", {"n": 1})
        second = await self.store.append_event(run.id, "custom.two", {"n": 2})
        events = await self.store.list_events(run.id, first.sequence)
        self.assertEqual([second.sequence], [event.sequence for event in events])

    async def test_completed_side_effect_outputs_form_a_cross_run_ledger(self) -> None:
        first = await self.store.create_run("boss.search-and-communicate.v1", {}, {})
        await self.store.start_step(first.id, "communicate.job-a", True)
        await self.store.finish_step(
            first.id,
            "communicate.job-a",
            {"confirmed": True, "job_id": "job-a", "city_code": "101280600"},
        )
        second = await self.store.create_run("boss.search-and-communicate.v1", {}, {})
        await self.store.start_step(second.id, "communicate.job-b", True)
        await self.store.finish_step(
            second.id,
            "communicate.job-b",
            {"confirmed": True, "job_id": "job-b", "city_code": "101280100"},
        )
        records = await self.store.list_completed_side_effects(
            "boss.search-and-communicate.v1", "communicate.", time.time() - 60
        )
        self.assertEqual(["job-a", "job-b"], [record.output["job_id"] for record in records])
        self.assertEqual([first.id, second.id], [record.run_id for record in records])

    async def test_different_workflows_run_concurrently(self) -> None:
        active = 0
        maximum = 0

        class ParallelWorkflow:
            def __init__(self, workflow_id: str) -> None:
                self.descriptor = WorkflowDescriptor(workflow_id, "1", workflow_id)

            async def execute(self, context):
                nonlocal active, maximum
                active += 1
                maximum = max(maximum, active)
                await asyncio.sleep(0.05)
                active -= 1
                return {}

        registry = WorkflowRegistry()
        first_workflow = ParallelWorkflow("test.parallel.first")
        second_workflow = ParallelWorkflow("test.parallel.second")
        registry.register(first_workflow)
        registry.register(second_workflow)
        runner = WorkflowRunner(self.store, registry, UnusedSafari(), ArtifactFiles(self.root))
        first = await runner.create_run(first_workflow.descriptor.id, {}, {})
        second = await runner.create_run(second_workflow.descriptor.id, {}, {})
        await asyncio.gather(runner.execute(first.id), runner.execute(second.id))
        self.assertEqual(2, maximum)

    async def test_report_and_schedule_migration_uses_wal_and_busy_timeout(self) -> None:
        tables = await self.store._connection().execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('reports','schedules')"
        )
        self.assertEqual({"reports", "schedules"}, {row["name"] for row in await tables.fetchall()})
        busy = await (await self.store._connection().execute("PRAGMA busy_timeout")).fetchone()
        journal = await (await self.store._connection().execute("PRAGMA journal_mode")).fetchone()
        self.assertEqual(10000, int(busy[0]))
        self.assertEqual("wal", str(journal[0]).lower())

    async def test_daily_report_rebuild_is_stable_and_deduplicates_job_id(self) -> None:
        application = build_application(self.root / "application-var")
        await application.open()
        try:
            for suffix in ("one", "two"):
                run = await application.store.create_run("boss.search-and-communicate.v1", {}, {})
                await application.store.start_step(run.id, f"communicate.{suffix}", True)
                await application.store.finish_step(
                    run.id, f"communicate.{suffix}",
                    {"confirmed": True, "performed": True, "preexisting": False,
                     "job_id": "same-job", "city": "深圳"},
                )
            today = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
            report = await application.rebuild_boss_report(today)
            self.assertEqual(1, report.record_count)
            self.assertEqual(
                application.home / "reports" / "boss" / f"{today}.csv", Path(report.path)
            )
            self.assertEqual(2, len(Path(report.path).read_text(encoding="utf-8-sig").splitlines()))
        finally:
            await application.close()

    async def test_doctor_accepts_uv_virtual_environment_and_python_312(self) -> None:
        application_home = self.root / "doctor-var"
        application_home.mkdir()
        application = RpaApplication(application_home, WorkflowRegistry(), safari=ReadinessSafari())
        result = await application.doctor()

        checks = {check["name"]: check for check in result["checks"]}
        self.assertTrue(result["ok"], result)
        self.assertIn("python_environment", checks)
        self.assertNotIn("conda_environment", checks)
        self.assertTrue(checks["python_environment"]["ok"], checks["python_environment"])
        self.assertEqual(sys.executable, checks["python_environment"]["value"])
        self.assertTrue(checks["python"]["ok"], checks["python"])

    async def test_scheduled_workflow_retries_readiness_then_executes(self) -> None:
        config_path = self.root / "scheduled.yaml"
        config_path.write_text("value: 42\n", encoding="utf-8")
        registry = WorkflowRegistry()
        registry.register(ScheduledWorkflow())
        safari = ReadinessSafari(failures=1)
        application = RpaApplication(self.root / "scheduled-var", registry, safari=safari)
        await application.open()
        try:
            with patch("safari_rpa.application.service.asyncio.sleep", new_callable=AsyncMock) as sleep:
                run = await application.run_scheduled_workflow(
                    "test.scheduled",
                    config_path,
                    ready_until="23:59",
                    retry_seconds=1,
                )
            self.assertEqual(RunStatus.SUCCEEDED, run.status)
            self.assertEqual({"scheduled": True, "config": {"value": 42}}, run.output)
            self.assertEqual(2, safari.calls)
            self.assertEqual(1, sleep.await_count)
        finally:
            await application.close()

    async def test_scheduled_workflow_blocks_when_safari_is_not_ready_by_deadline(self) -> None:
        config_path = self.root / "scheduled-blocked.yaml"
        config_path.write_text("value: 42\n", encoding="utf-8")
        registry = WorkflowRegistry()
        registry.register(ScheduledWorkflow())
        application = RpaApplication(self.root / "scheduled-blocked-var", registry, safari=ReadinessSafari(failures=99))
        await application.open()
        try:
            run = await application.run_scheduled_workflow(
                "test.scheduled",
                config_path,
                ready_until="00:00",
                retry_seconds=1,
            )
            self.assertEqual(RunStatus.BLOCKED, run.status)
            self.assertEqual("SAFARI_NOT_READY_BY_DEADLINE", run.error["code"])
            self.assertIsNone(run.output)
        finally:
            await application.close()
