from __future__ import annotations

import os
import unittest

from safari_rpa.adapters.safari import SafariDriver
from safari_rpa.contracts.errors import RpaError
from safari_rpa.sites.boss import BossPageAdapter
from safari_rpa.sites.twitter import TwitterPageAdapter
from safari_rpa.workflows.boss import BossWorkflow


class LiveSiteTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipUnless(os.environ.get("MACRPA_TEST_BOSS_LIVE") == "1", "requires explicit Boss live opt-in")
    async def test_boss_shenzhen_ios_list(self) -> None:
        adapter = BossPageAdapter(SafariDriver(poll_interval=0.35))
        page = await adapter.ensure_search_page()
        try:
            url = BossWorkflow._search_url(
                "iOS",
                {"name": "深圳", "code": "101280600"},
                1,
                {
                    "position": "100203",
                    "scale": "304,305,306",
                    "experience": "102,103,104,108",
                    "degree": "203,202,201,208",
                    "salary": "405",
                },
            )
            try:
                jobs = await adapter.open_search(page, url)
            except RpaError as exc:
                self.fail(f"{exc.code}: {exc.details}")
            state = await adapter.assert_access(page)
            self.assertIn(state["page_type"], {"search", "search_detail"})
            self.assertGreater(len(jobs), 0)
            self.assertEqual(len(jobs), len({job["job_id"] for job in jobs}))
            self.assertTrue(all("experience" in job and "salary" in job for job in jobs))
            background_candidates = [
                job for job in jobs if job.get("security_id") and job.get("lid")
            ]
            self.assertGreater(
                len(background_candidates),
                0,
                "Boss search results did not expose securityId/lid for background filtering",
            )
            try:
                card = await adapter.read_job_card(page, background_candidates[0])
            except RpaError as exc:
                self.fail(f"{exc.code}: {exc.details}")
            self.assertEqual(background_candidates[0]["job_id"], card["job_id"])
            self.assertEqual("job_card_api", card["source"])
            self.assertTrue(card.get("title"))
            self.assertTrue(card.get("jd"))
        finally:
            await adapter.close_page(page)

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
