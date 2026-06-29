from __future__ import annotations

import os
import platform
import shutil
import sys
import asyncio
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yaml

from macrpa.adapters.safari import SafariDriver
from macrpa.adapters.launchd import LaunchdScheduler
from macrpa.contracts.errors import RpaError
from macrpa.contracts.runtime import JsonObject, ReportRecord, RunRecord, RunStatus, ScheduleRecord
from macrpa.application.llm_service import LocalLlmService
from macrpa.runtime import ArtifactFiles, RunStore, WorkflowRegistry, WorkflowRunner


class RpaApplication:
    def __init__(
        self,
        home: str | Path,
        registry: WorkflowRegistry,
        safari: SafariDriver | None = None,
    ) -> None:
        self.home = Path(home).expanduser().resolve()
        self.registry = registry
        self.safari = safari or SafariDriver(action_lock_path=str(self.home / "locks" / "safari-actions.lock"))
        self.store = RunStore(self.home / "safari-rpa.sqlite")
        self.artifacts = ArtifactFiles(self.home)
        self.llm = LocalLlmService()
        self.runner = WorkflowRunner(self.store, registry, self.safari, self.artifacts, self.llm)
        self.scheduler = LaunchdScheduler(self.home, Path(__file__).resolve().parents[3])
        self._open = False

    async def open(self) -> RpaApplication:
        if not self._open:
            self.home.mkdir(parents=True, exist_ok=True)
            await self.store.open()
            self._open = True
        return self

    async def close(self) -> None:
        if self._open:
            await self.runner.shutdown()
            await self.store.close()
            self._open = False

    async def create_run(
        self,
        workflow_id: str,
        config: JsonObject,
        input_data: JsonObject,
        *,
        background: bool = True,
    ) -> RunRecord:
        run = await self.runner.create_run(workflow_id, config, input_data)
        if background:
            self.runner.start_background(run.id)
        return run

    async def execute_run(self, run_id: str) -> RunRecord:
        await self.runner.execute(run_id)
        run = await self.get_run(run_id)
        assert run is not None
        return run

    async def get_run(self, run_id: str) -> RunRecord | None:
        return await self.store.get_run(run_id)

    async def list_runs(self, limit: int = 100) -> tuple[RunRecord, ...]:
        return await self.store.list_runs(limit)

    async def list_reports(self, limit: int = 100) -> tuple[ReportRecord, ...]:
        return await self.store.list_reports(limit)

    async def get_report(self, report_id: str) -> ReportRecord | None:
        return await self.store.get_report(report_id)

    async def report_content(self, report_id: str) -> str:
        report = await self.get_report(report_id)
        if report is None:
            raise RpaError("REPORT_NOT_FOUND", f"Report does not exist: {report_id}")
        path = Path(report.path).resolve()
        try:
            path.relative_to(self.home)
        except ValueError as error:
            raise RpaError("REPORT_PATH_INVALID", "Report path is outside runtime home") from error
        if not path.is_file():
            raise RpaError("REPORT_FILE_MISSING", f"Report file is missing: {path}")
        return path.read_text(encoding="utf-8-sig")

    async def rebuild_boss_report(self, report_date: str | None = None) -> ReportRecord:
        from macrpa.workflows.boss import BossWorkflow

        zone = ZoneInfo("Asia/Shanghai")
        selected = date.fromisoformat(report_date) if report_date else datetime.now(zone).date()
        start = datetime.combine(selected, time.min, zone).timestamp()
        end = datetime.combine(selected + timedelta(days=1), time.min, zone).timestamp()
        effects = await self.store.list_completed_side_effects(
            "boss.search-and-communicate.v1", "communicate.", start, end
        )
        confirmed = BossWorkflow._confirmed_effects(effects)
        records = [BossWorkflow._ledger_record(effect, output) for effect, output in confirmed]
        content = BossWorkflow._csv(records)
        path = self.artifacts.write_daily_report("boss", selected.isoformat(), content)
        return await self.store.upsert_report(
            f"boss-confirmed-daily-{selected.isoformat()}",
            "boss.search-and-communicate.v1", selected.isoformat(), "boss_confirmed_daily_csv",
            str(path.resolve()), len(records), {"source": "confirmed_side_effects", "rebuilt": True},
        )

    async def list_schedules(self) -> tuple[ScheduleRecord, ...]:
        return await self.store.list_schedules()

    async def get_schedule(self, schedule_id: str) -> ScheduleRecord | None:
        return await self.store.get_schedule(schedule_id)

    async def put_schedule(self, schedule_id: str, value: JsonObject) -> ScheduleRecord:
        workflow_id = str(value.get("workflow_id") or "boss.search-and-communicate.v1")
        if workflow_id != "boss.search-and-communicate.v1":
            raise RpaError("SCHEDULE_WORKFLOW_UNSUPPORTED", workflow_id)
        config_path = value.get("config_path") or Path(__file__).resolve().parents[3] / "configs" / "boss.production.yaml"
        record = await self.scheduler.install_boss(
            schedule_id, config_path, daily_at=str(value.get("daily_at") or "06:00"),
            timezone=str(value.get("timezone") or "Asia/Shanghai"),
            keep_awake=bool(value.get("keep_awake", True)),
            profile=str(value.get("profile") or "production"),
        )
        return await self.store.upsert_schedule(record)

    async def delete_schedule(self, schedule_id: str) -> bool:
        record = await self.store.get_schedule(schedule_id)
        if record is None:
            return False
        await self.scheduler.uninstall(record)
        return await self.store.delete_schedule(schedule_id)

    async def run_scheduled_workflow(
        self,
        workflow_id: str,
        config_path: str | Path,
        *,
        profile: str | None = None,
        ready_until: str = "12:00",
        retry_seconds: int = 300,
    ) -> RunRecord:
        deadline = self._scheduled_deadline(ready_until)
        last_error = ""
        while True:
            try:
                await self.safari.inspect_windows()
                break
            except Exception as error:
                last_error = str(error)
                if datetime.now().astimezone() >= deadline:
                    config = self._load_mapping(Path(config_path), profile=profile)
                    run = await self.runner.create_run(workflow_id, config, {})
                    await self.store.set_run_status(
                        run.id,
                        RunStatus.BLOCKED,
                        error={"code": "SAFARI_NOT_READY_BY_DEADLINE", "message": last_error},
                    )
                    blocked = await self.get_run(run.id)
                    assert blocked is not None
                    return blocked
                await asyncio.sleep(max(1, retry_seconds))
        config = self._load_mapping(Path(config_path), profile=profile)
        created = await self.create_run(workflow_id, config, {}, background=False)
        return await self.execute_run(created.id)

    async def resume(self, run_id: str, *, background: bool = True) -> RunRecord:
        run = await self.store.get_run(run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {run_id}")
        if run.status not in (RunStatus.BLOCKED, RunStatus.FAILED, RunStatus.UNKNOWN_SIDE_EFFECT):
            raise RpaError("RUN_NOT_RESUMABLE", f"Run is not resumable from {run.status}")
        if background:
            self.runner.start_background(run_id)
            return run
        return await self.execute_run(run_id)

    async def cancel(self, run_id: str) -> bool:
        return await self.runner.cancel(run_id)

    async def doctor(self) -> JsonObject:
        environment_name = os.environ.get("CONDA_DEFAULT_ENV", "")
        environment_ok = environment_name == "kwai" or "/envs/kwai/" in sys.executable
        checks: list[JsonObject] = [
            {
                "name": "platform",
                "ok": platform.system() == "Darwin",
                "value": platform.platform(),
                "required": True,
            },
            {
                "name": "conda_environment",
                "ok": environment_ok,
                "value": environment_name or sys.executable,
                "required": True,
            },
            {
                "name": "python",
                "ok": sys.version_info >= (3, 14),
                "value": platform.python_version(),
                "required": True,
            },
            {
                "name": "osascript",
                "ok": shutil.which("osascript") is not None,
                "value": shutil.which("osascript") or "missing",
                "required": True,
            },
            {
                "name": "safari_application",
                "ok": Path("/Applications/Safari.app").exists(),
                "value": "/Applications/Safari.app",
                "required": True,
            },
            {
                "name": "runtime_home",
                "ok": os.access(self.home, os.W_OK),
                "value": str(self.home),
                "required": True,
            },
        ]
        try:
            windows = await self.safari.inspect_windows()
            checks.append(
                {
                    "name": "safari_apple_events",
                    "ok": True,
                    "value": f"{len(windows)} window(s)",
                    "required": True,
                }
            )
            checks.append(
                {
                    "name": "safari_javascript_events",
                    "ok": None,
                    "value": "verified when a workflow resolves its first page",
                    "required": True,
                }
            )
        except Exception as error:
            checks.append(
                {
                    "name": "safari_apple_events",
                    "ok": False,
                    "value": str(error),
                    "required": True,
                }
            )
        return {
            "ok": all(check["ok"] is not False for check in checks if check["required"]),
            "checks": checks,
        }

    def capabilities(self) -> JsonObject:
        return {
            "service": "safari-rpa",
            "api_version": "v1",
            "browser": "safari",
            "operations": [
                "inspect_windows",
                "ensure_site",
                "navigate",
                "query",
                "read",
                "click_with_postcondition",
                "fill_with_postcondition",
                "evaluate",
                "snapshot",
            ],
            "workflows": [
                {
                    "id": descriptor.id,
                    "version": descriptor.version,
                    "available": descriptor.available,
                    "capabilities": list(descriptor.capabilities),
                }
                for descriptor in self.registry.descriptors()
            ],
        }

    @staticmethod
    def _scheduled_deadline(ready_until: str) -> datetime:
        ready_hour, ready_minute = (int(part) for part in ready_until.split(":", 1))
        now = datetime.now().astimezone()
        deadline = now.replace(hour=ready_hour, minute=ready_minute, second=0, microsecond=0)
        return max(deadline, now)

    @staticmethod
    def _load_mapping(path: Path, *, profile: str | None = None) -> JsonObject:
        value = yaml.safe_load(path.expanduser().read_text(encoding="utf-8"))
        if value is None:
            value = {}
        if not isinstance(value, dict):
            raise RpaError("INVALID_CONFIG", "Configuration root must be an object")
        if profile:
            value["profile"] = profile
        return value


def default_home() -> Path:
    return Path(os.environ.get("SAFARI_RPA_HOME") or os.environ.get("MACRPA_HOME", Path.cwd() / "var"))
