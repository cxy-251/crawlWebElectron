from __future__ import annotations

import os
import unittest

from safari_rpa.adapters.safari import SafariDriver
from safari_rpa.sites.boss import BossPageAdapter
from safari_rpa.sites.twitter import TwitterPageAdapter
from safari_rpa.workflows.boss import BossWorkflow


class LiveSiteTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipUnless(os.environ.get("MACRPA_TEST_BOSS_LIVE") == "1", "requires explicit Boss live opt-in")
    async def test_boss_shenzhen_ios_list(self) -> None:
        adapter = BossPageAdapter(SafariDriver(poll_interval=0.35))
        page = await adapter.ensure_page()
        url = BossWorkflow._search_url(
            "iOS",
            {"name": "深圳", "code": "101280600"},
            1,
            {
                "scale": "304,305,306",
                "experience": "102,103,104,108",
                "degree": "203,202,201,208",
                "salary": "405",
            },
        )
        jobs = await adapter.open_search(page, url)
        state = await adapter.assert_access(page)
        self.assertEqual("search_detail", state["page_type"])
        self.assertEqual(15, len(jobs))
        self.assertEqual(15, len({job["job_id"] for job in jobs}))

    @unittest.skipUnless(
        os.environ.get("MACRPA_TEST_TWITTER_LIVE") == "1" and os.environ.get("MACRPA_TWITTER_HANDLE"),
        "requires explicit Twitter live opt-in and MACRPA_TWITTER_HANDLE",
    )
    async def test_twitter_profile_read_only_tweets(self) -> None:
        handle = os.environ["MACRPA_TWITTER_HANDLE"]
        adapter = TwitterPageAdapter(SafariDriver(poll_interval=0.35))
        page = await adapter.ensure_profile(handle=handle)
        tweets = await adapter.read_tweets(page, target_handle=handle)
        self.assertLessEqual(len(tweets), 50)
        if tweets:
            self.assertTrue(tweets[0]["tweet_id"])
            self.assertTrue(tweets[0]["text"])
