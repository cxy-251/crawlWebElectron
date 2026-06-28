from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from macrpa.adapters.launchd import LaunchdScheduler


class LaunchdSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_boss_schedule_is_0600_without_run_at_load_and_keep_awake_uses_ac_power(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "boss.production.yaml"
            config.write_text("search: {}\n", encoding="utf-8")
            scheduler = LaunchdScheduler(root / "var", root, root / "agents")
            captured: list[tuple[Path, dict]] = []

            async def capture(path, value):
                captured.append((path, value))

            scheduler._write_and_load = AsyncMock(side_effect=capture)
            record = await scheduler.install_boss("boss-production-daily", config)
            self.assertEqual({"Hour": 6, "Minute": 0}, captured[0][1]["StartCalendarInterval"])
            self.assertNotIn("RunAtLoad", captured[0][1])
            self.assertEqual(["/usr/bin/caffeinate", "-s"], captured[1][1]["ProgramArguments"])
            self.assertTrue(captured[1][1]["RunAtLoad"])
            self.assertTrue(record.keep_awake)

    def test_generated_plist_is_valid_xml(self) -> None:
        value = {"Label": "test", "ProgramArguments": ["/usr/bin/true"], "RunAtLoad": False}
        self.assertEqual(value, plistlib.loads(plistlib.dumps(value)))
