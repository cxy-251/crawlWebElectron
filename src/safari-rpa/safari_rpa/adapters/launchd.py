from __future__ import annotations

import asyncio
import os
import plistlib
import sys
import time
from collections.abc import Sequence
from pathlib import Path

from safari_rpa.contracts.errors import RpaError
from safari_rpa.contracts.runtime import JsonObject, ScheduleRecord


class LaunchdScheduler:
    BOSS_LABEL = "com.browser-workflow.safari-rpa.boss-production"
    AWAKE_LABEL = "com.browser-workflow.safari-rpa.keep-awake"

    def __init__(
        self, runtime_home: str | Path, project_root: str | Path,
        python_path: str | Path,
        agents_directory: str | Path | None = None,
    ) -> None:
        self.runtime_home = Path(runtime_home).resolve()
        self.project_root = Path(project_root).resolve()
        self.python_path = Path(python_path).resolve()
        self.agents_directory = Path(agents_directory or Path.home() / "Library" / "LaunchAgents")

    async def install_boss(
        self, schedule_id: str, config_path: str | Path, *,
        daily_at: str | Sequence[str] = "06:00",
        timezone: str = "Asia/Shanghai", keep_awake: bool = True, profile: str = "production",
        ready_for_minutes: int = 90,
    ) -> ScheduleRecord:
        daily_times = self._parse_times(daily_at)
        intervals = [
            {"Hour": hour, "Minute": minute}
            for hour, minute in (self._parse_time(value) for value in daily_times)
        ]
        ready_minutes = max(1, int(ready_for_minutes))
        config = Path(config_path).expanduser().resolve()
        if not config.is_file():
            raise RpaError("SCHEDULE_CONFIG_MISSING", f"Schedule config does not exist: {config}")
        logs = self.runtime_home / "logs" / "launchd"
        logs.mkdir(parents=True, exist_ok=True)
        plist_path = self.agents_directory / f"{self.BOSS_LABEL}.plist"
        value: JsonObject = {
            "Label": self.BOSS_LABEL,
            "ProgramArguments": [
                sys.executable, "-m", "safari_rpa", "--home", str(self.runtime_home),
                "scheduled-run", "boss.search-and-communicate.v1", "--config", str(config),
                "--profile", profile,
                "--ready-for-minutes", str(ready_minutes), "--retry-seconds", "300",
            ],
            "WorkingDirectory": str(self.project_root),
            "EnvironmentVariables": {
                "PYTHONPATH": str(self.python_path),
                "SAFARI_RPA_HOME": str(self.runtime_home),
                "TZ": timezone,
            },
            "StartCalendarInterval": intervals[0] if len(intervals) == 1 else intervals,
            "StandardOutPath": str(logs / "boss-production.stdout.log"),
            "StandardErrorPath": str(logs / "boss-production.stderr.log"),
            "ProcessType": "Background",
        }
        await self._write_and_load(plist_path, value)
        if keep_awake:
            await self.install_keep_awake()
        now = time.time()
        return ScheduleRecord(
            schedule_id, "boss.search-and-communicate.v1", str(config), ",".join(daily_times), timezone,
            True, self.BOSS_LABEL, str(plist_path), keep_awake,
            {
                "run_at_load": False,
                "daily_times": daily_times,
                "ready_for_minutes": ready_minutes,
                "retry_seconds": 300,
                "profile": profile,
            },
            now,
            now,
        )

    async def install_keep_awake(self) -> Path:
        logs = self.runtime_home / "logs" / "launchd"
        logs.mkdir(parents=True, exist_ok=True)
        path = self.agents_directory / f"{self.AWAKE_LABEL}.plist"
        value: JsonObject = {
            "Label": self.AWAKE_LABEL,
            "ProgramArguments": ["/usr/bin/caffeinate", "-s"],
            "RunAtLoad": True,
            "KeepAlive": True,
            "ProcessType": "Background",
            "StandardOutPath": str(logs / "keep-awake.stdout.log"),
            "StandardErrorPath": str(logs / "keep-awake.stderr.log"),
        }
        await self._write_and_load(path, value)
        return path

    async def uninstall(self, record: ScheduleRecord) -> None:
        await self._unload(Path(record.plist_path))
        if record.keep_awake:
            await self._unload(self.agents_directory / f"{self.AWAKE_LABEL}.plist")

    async def _write_and_load(self, path: Path, value: JsonObject) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".plist.tmp")
        temporary.write_bytes(plistlib.dumps(value, fmt=plistlib.FMT_XML, sort_keys=True))
        os.replace(temporary, path)
        await self._unload(path, delete=False)
        domain = f"gui/{os.getuid()}"
        process = await asyncio.create_subprocess_exec(
            "launchctl", "bootstrap", domain, str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise RpaError(
                "LAUNCHD_INSTALL_FAILED", stderr.decode("utf-8", errors="replace").strip(),
                details={"plist": str(path)},
            )
        enable = await asyncio.create_subprocess_exec(
            "launchctl", "enable", f"{domain}/{value['Label']}",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await enable.communicate()

    async def _unload(self, path: Path, *, delete: bool = True) -> None:
        if path.exists():
            process = await asyncio.create_subprocess_exec(
                "launchctl", "bootout", f"gui/{os.getuid()}", str(path),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            await process.communicate()
            if delete:
                path.unlink(missing_ok=True)

    @staticmethod
    def _parse_time(value: str) -> tuple[int, int]:
        try:
            hour, minute = (int(part) for part in value.split(":", 1))
        except (TypeError, ValueError) as error:
            raise RpaError("INVALID_SCHEDULE", "daily_at must use HH:MM") from error
        if not 0 <= hour <= 23 or not 0 <= minute <= 59:
            raise RpaError("INVALID_SCHEDULE", "daily_at must use HH:MM")
        return hour, minute

    @classmethod
    def _parse_times(cls, value: str | Sequence[str]) -> list[str]:
        source = [value] if isinstance(value, str) else list(value)
        expanded = [part.strip() for item in source for part in str(item).split(",") if part.strip()]
        if not expanded:
            raise RpaError("INVALID_SCHEDULE", "Configure at least one daily_at value")
        normalized: list[str] = []
        for item in expanded:
            hour, minute = cls._parse_time(item)
            canonical = f"{hour:02d}:{minute:02d}"
            if canonical not in normalized:
                normalized.append(canonical)
        return normalized
