from __future__ import annotations

import os
import unittest

from macrpa.adapters.safari import SafariDriver


@unittest.skipUnless(os.environ.get("MACRPA_TEST_SAFARI") == "1", "requires Safari Apple Events permission")
class SafariLiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_window_and_tab_inventory_is_readable(self) -> None:
        windows = await SafariDriver().inspect_windows()
        self.assertIsInstance(windows, tuple)
        for window in windows:
            self.assertGreater(window.window_id, 0)
            for tab in window.tabs:
                self.assertEqual(window.window_id, tab.window_id)
