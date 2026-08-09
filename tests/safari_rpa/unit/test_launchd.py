from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from safari_rpa.adapters.launchd import LaunchdScheduler


class LaunchdSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_boss_schedule_is_0600_without_run_at_load_and_keep_awake_uses_ac_power(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "boss" / "production.yaml"
            config.parent.mkdir()
            config.write_text("search: {}\n", encoding="utf-8")
            scheduler = LaunchdScheduler(root / "var", root, root / "src" / "safari-rpa", root / "agents")
            captured: list[tuple[Path, dict]] = []

            async def capture(path, value):
                captured.append((path, value))

            scheduler._write_and_load = AsyncMock(side_effect=capture)
            record = await scheduler.install_boss("boss-production-daily", config)
            boss_args = captured[0][1]["ProgramArguments"]
            self.assertEqual({"Hour": 6, "Minute": 0}, captured[0][1]["StartCalendarInterval"])
            self.assertNotIn("RunAtLoad", captured[0][1])
            self.assertEqual(str((root / "src" / "safari-rpa").resolve()), captured[0][1]["EnvironmentVariables"]["PYTHONPATH"])
            self.assertEqual(["-m", "safari_rpa"], boss_args[1:3])
            self.assertIn("--profile", boss_args)
            self.assertEqual("production", boss_args[boss_args.index("--profile") + 1])
            self.assertEqual("90", boss_args[boss_args.index("--ready-for-minutes") + 1])
            self.assertEqual(["/usr/bin/caffeinate", "-s"], captured[1][1]["ProgramArguments"])
            self.assertTrue(captured[1][1]["RunAtLoad"])
            self.assertTrue(record.keep_awake)
            self.assertEqual("production", record.metadata["profile"])

    async def test_boss_schedule_supports_two_daily_windows_in_one_agent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "boss.yaml"
            config.write_text("search: {}\n", encoding="utf-8")
            scheduler = LaunchdScheduler(root / "var", root, root / "src", root / "agents")
            captured: list[tuple[Path, dict]] = []

            async def capture(path, value):
                captured.append((path, value))

            scheduler._write_and_load = AsyncMock(side_effect=capture)
            record = await scheduler.install_boss(
                "boss-production-daily",
                config,
                daily_at=["8:00", "13:00", "08:00"],
                keep_awake=False,
                ready_for_minutes=90,
            )

            self.assertEqual(1, len(captured))
            self.assertEqual(
                [{"Hour": 8, "Minute": 0}, {"Hour": 13, "Minute": 0}],
                captured[0][1]["StartCalendarInterval"],
            )
            self.assertEqual("08:00,13:00", record.daily_at)
            self.assertEqual(["08:00", "13:00"], record.metadata["daily_times"])
            self.assertEqual(90, record.metadata["ready_for_minutes"])

    def test_generated_plist_is_valid_xml(self) -> None:
        value = {"Label": "test", "ProgramArguments": ["/usr/bin/true"], "RunAtLoad": False}
        self.assertEqual(value, plistlib.loads(plistlib.dumps(value)))
