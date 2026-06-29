from __future__ import annotations

import unittest
from pathlib import Path

import yaml

from macrpa.contracts.errors import RpaError, UnknownSideEffectError
from macrpa.contracts.safari import ActionEvidence, ElementState, PageRef, PageState
from macrpa.sites.boss import BossPageAdapter
from macrpa.sites.twitter import TwitterPageAdapter
from macrpa.workflows.boss import BossWorkflow


PAGE = PageRef("session", "marker", "x.com", 1, 1)
STATE = PageState("https://x.com/example", "X", "complete")


class CommunicationBossSafari:
    def __init__(
        self,
        status: str,
        *,
        same_job: bool = True,
        confirm_after_click: bool = True,
        mismatch: bool = False,
    ) -> None:
        self.status = status
        self.same_job = same_job
        self.confirm_after_click = confirm_after_click
        self.mismatch = mismatch
        self.clicks = 0

    async def evaluate(self, page, expression):
        if "boss_experience_mismatch_state" in expression:
            return {"visible": self.mismatch, "same_job": True, "job_id": "JOB-1"}
        return {
            "job_id": "JOB-1" if self.same_job else "OTHER",
            "expected_job_id": "JOB-1",
            "same_job": self.same_job,
            "status": self.status,
            "button_text": "立即沟通" if self.status == "available" else "继续沟通",
            "url": "https://www.zhipin.com/job_detail/JOB-1.html",
        }

    async def query(self, page, locator):
        if "工作经历不匹配" in locator.value:
            found = self.mismatch
        else:
            found = locator.value != "留在此页"
        return ElementState(found=found, visible=found, enabled=found)

    async def click(self, page, locator, postcondition, timeout=15):
        self.clicks += 1
        if "工作经历不匹配" in locator.value:
            self.mismatch = False
            self.status = "available"
        elif self.mismatch:
            self.status = "available"
        elif self.confirm_after_click:
            self.status = "communicated"
        return ActionEvidence("click", 0, 1, STATE, STATE)


class TwitterSafari:
    def __init__(self, tweets=None, *, access=None) -> None:
        self.tweets = tweets or []
        self.access = access or {
            "login_required": False,
            "risk": False,
            "rate_limited": False,
            "has_timeline": True,
            "has_profile": True,
            "url": "https://x.com/example",
        }
        self.navigated: list[str] = []
        self.scrolled = 0

    async def ensure_site(self, origin, start_url, timeout=30):
        self.origin = origin
        self.start_url = start_url
        return PAGE

    async def navigate(self, page, url, timeout=30):
        self.navigated.append(url)
        return ActionEvidence("navigate", 0, 1, STATE, STATE, {"url": url})

    async def wait_for(self, page, condition, timeout=30):
        return STATE

    async def evaluate(self, page, expression):
        if "twitter_access_state" in expression:
            return self.access
        if "twitter_extract_tweets" in expression:
            return self.tweets
        if "twitter_extract_tweet_detail" in expression:
            return self.tweets[0] if self.tweets else {}
        if "window.scrollBy" in expression:
            self.scrolled += 1
            return {"scroll_y": 100 * self.scrolled, "scroll_height": 1000}
        return None


class SiteAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_boss_preexisting_chat_is_not_a_new_side_effect(self) -> None:
        safari = CommunicationBossSafari("communicated")
        result = await BossPageAdapter(safari).communicate(PAGE, "JOB-1")
        self.assertTrue(result["confirmed"])
        self.assertFalse(result["performed"])
        self.assertTrue(result["preexisting"])
        self.assertEqual(0, safari.clicks)

    async def test_boss_unconfirmed_click_becomes_unknown_side_effect(self) -> None:
        safari = CommunicationBossSafari("available", confirm_after_click=False)
        with self.assertRaises(UnknownSideEffectError):
            await BossPageAdapter(safari).communicate(PAGE, "JOB-1")
        self.assertEqual(1, safari.clicks)

    async def test_boss_requires_the_expected_job_context(self) -> None:
        safari = CommunicationBossSafari("available", same_job=False)
        with self.assertRaises(RpaError) as raised:
            await BossPageAdapter(safari).communication_state(PAGE, "JOB-1")
        self.assertEqual("BOSS_JOB_CONTEXT_MISMATCH", raised.exception.code)

    async def test_boss_cancels_experience_mismatch_without_counting(self) -> None:
        safari = CommunicationBossSafari("available", mismatch=True)
        result = await BossPageAdapter(safari).communicate(PAGE, "JOB-1")
        self.assertEqual("skipped_experience_mismatch", result["outcome"])
        self.assertFalse(result["confirmed"])
        self.assertFalse(result["performed"])
        self.assertEqual(2, safari.clicks)

    def test_boss_risk_contract_ignores_naked_403_digits(self) -> None:
        script = BossPageAdapter._access_state_script()
        self.assertNotIn("|403/", script)
        self.assertIn("403\\s*(Forbidden", script)
        self.assertIn("new URL(url).pathname", script)

    async def test_twitter_profile_navigation_normalizes_to_x_handle(self) -> None:
        safari = TwitterSafari()
        page = await TwitterPageAdapter(safari).ensure_profile(profile_url="https://twitter.com/example/status/123")
        self.assertEqual(PAGE, page)
        self.assertEqual("x.com", safari.origin)
        self.assertEqual(["https://x.com/example"], safari.navigated)

    def test_twitter_normalize_handle_accepts_profile_urls(self) -> None:
        self.assertEqual("Minahil42298354", TwitterPageAdapter.normalize_handle("https://x.com/Minahil42298354"))
        self.assertEqual("example", TwitterPageAdapter.normalize_handle("twitter.com/example/status/123"))
        self.assertEqual("example", TwitterPageAdapter.normalize_handle("@example"))

    async def test_twitter_read_tweets_filters_to_original_target_author_by_default(self) -> None:
        raw = [
            {
                "tweet_id": "1",
                "url": "https://x.com/example/status/1",
                "author_handle": "example",
                "created_at": "2026-06-27T00:00:00.000Z",
                "text": "把一个复杂任务拆成可验证步骤。",
                "is_reply": False,
                "is_repost": False,
                "is_quote": False,
            },
            {
                "tweet_id": "2",
                "url": "https://x.com/example/status/2",
                "author_handle": "example",
                "text": "回复内容",
                "is_reply": True,
                "is_repost": False,
                "is_quote": False,
            },
            {
                "tweet_id": "3",
                "url": "https://x.com/other/status/3",
                "author_handle": "other",
                "text": "别人原文",
                "is_reply": False,
                "is_repost": True,
                "is_quote": False,
            },
            {
                "tweet_id": "4",
                "url": "https://x.com/example/status/4",
                "author_handle": "example",
                "text": "我对这条引用的总结",
                "is_reply": False,
                "is_repost": False,
                "is_quote": True,
            },
        ]
        tweets = await TwitterPageAdapter(TwitterSafari(raw)).read_tweets(PAGE, target_handle="example")
        self.assertEqual(["1"], [item["tweet_id"] for item in tweets])

    async def test_twitter_read_tweet_detail_returns_full_original_text(self) -> None:
        raw = [
            {
                "tweet_id": "1",
                "url": "https://x.com/example/status/1",
                "author_handle": "example",
                "created_at": "2026-06-27T00:00:00.000Z",
                "text": "完整 prompt 文本，而不是 timeline 截断文本。",
                "is_reply": False,
                "is_repost": False,
                "is_quote": False,
            }
        ]
        tweet = await TwitterPageAdapter(TwitterSafari(raw)).read_tweet_detail(
            PAGE,
            "https://x.com/example/status/1",
            target_handle="example",
            pause_seconds=0,
        )
        self.assertEqual("完整 prompt 文本，而不是 timeline 截断文本。", tweet["text"])

    def test_twitter_status_wait_condition_rejects_black_or_skeleton_page(self) -> None:
        condition = TwitterPageAdapter._status_ready_condition("https://x.com/example/status/1")
        self.assertIn("primaryColumn", condition)
        self.assertIn("primaryText.length > 0", condition)
        self.assertIn("progressbar", condition)
        self.assertIn("matchingArticle.innerText.length > 0", condition)
        self.assertIn("titleTweet.length > 0", condition)
        self.assertIn("articleReady", condition)
        self.assertIn("/status/'+expected", condition)

    def test_twitter_detail_script_falls_back_to_status_title_text(self) -> None:
        script = TwitterPageAdapter._tweet_detail_script("https://x.com/example/status/1")
        self.assertIn("document.title.match", script)
        self.assertIn("titleTweet", script)
        self.assertIn("if (!article) return", script)

    async def test_twitter_login_blocks_before_extraction(self) -> None:
        safari = TwitterSafari(access={"login_required": True, "risk": False, "rate_limited": False})
        with self.assertRaises(RpaError) as raised:
            await TwitterPageAdapter(safari).read_tweets(PAGE, target_handle="example")
        self.assertEqual("TWITTER_LOGIN_REQUIRED", raised.exception.code)

    async def test_twitter_scroll_is_read_only_page_motion(self) -> None:
        safari = TwitterSafari()
        result = await TwitterPageAdapter(safari).scroll(PAGE)
        self.assertEqual(1, safari.scrolled)
        self.assertEqual(100, result["scroll_y"])

    def test_boss_sample_and_canonical_search_contract(self) -> None:
        root = Path(__file__).resolve().parents[2]
        config = yaml.safe_load((root / "configs" / "boss.example.yaml").read_text(encoding="utf-8"))
        self.assertEqual(11, len(config["search"]["cities"]))
        self.assertEqual(
            ["深圳", "广州", "杭州", "上海", "成都", "武汉", "南京", "苏州", "东莞", "佛山", "重庆"],
            [city["name"] for city in config["search"]["cities"]],
        )
        self.assertEqual("Python开发工程师", config["search"]["weekday_keywords"]["mon"])
        self.assertEqual("iOS开发工程师", config["search"]["weekday_keywords"]["sat"])
        self.assertIn("开发", config["criteria"]["title_allow"])
        self.assertIn("产品经理", config["criteria"]["title_deny"])
        url = BossWorkflow._search_url(
            "iOS开发工程师",
            {"name": "深圳", "code": "101280600"},
            1,
            config["search"]["query_params"],
        )
        self.assertIn("/web/geek/jobs?", url)
        self.assertEqual(
            BossWorkflow._job_id("https://www.zhipin.com/job_detail/abc.html?securityId=one"),
            BossWorkflow._job_id("https://www.zhipin.com/job_detail/abc.html?securityId=two"),
        )

    def test_boss_profiles_share_cities_keywords_and_daily_ledger(self) -> None:
        root = Path(__file__).resolve().parents[2]
        expected = {
            "collection": (110, False),
            "test": (10, True),
            "production": (110, True),
        }
        source = yaml.safe_load((root / "configs" / "boss.production.yaml").read_text(encoding="utf-8"))
        self.assertEqual("production", source["profile"])
        self.assertEqual(set(expected), set(source["profiles"]))
        for name, (run_limit, communication) in expected.items():
            with self.subTest(profile=name):
                config = BossWorkflow._config({**source, "profile": name})
                self.assertEqual(11, len(config["search"]["cities"]))
                self.assertEqual("Python开发工程师", config["search"]["weekday_keywords"]["mon"])
                self.assertEqual("iOS开发工程师", config["search"]["weekday_keywords"]["sat"])
                self.assertIn("开发", config["criteria"]["title_allow"])
                self.assertIn("销售", config["criteria"]["title_deny"])
                self.assertEqual(name, config["profile"])
                self.assertEqual(run_limit, config["limits"]["run"])
                self.assertEqual(110, config["limits"]["daily"])
                self.assertEqual(10, config["limits"]["per_city"])
                self.assertEqual(communication, config["communication"]["enabled"])

    def test_boss_unknown_profile_is_rejected(self) -> None:
        with self.assertRaisesRegex(RpaError, "Boss profile does not exist"):
            BossWorkflow._config(
                {
                    "profile": "missing",
                    "profiles": {"production": {"communication": {"enabled": True}}},
                    "search": {"cities": [{"name": "深圳", "code": "101280600"}], "keywords": ["iOS开发工程师"]},
                }
            )

    def test_boss_title_filter_requires_developer_role(self) -> None:
        config = BossWorkflow._config(
            {
                "search": {"cities": [{"name": "深圳", "code": "101280600"}], "keywords": ["iOS开发工程师"]},
                "criteria": {
                    "title_allow": ["开发", "前端", "iOS", "Python"],
                    "title_deny": ["销售", "运营", "产品经理"],
                    "allow_unknown": True,
                },
            }
        )
        accepted = BossWorkflow._match({"title": "iOS开发工程师", "scale": "", "salary": ""}, config["criteria"])
        denied = BossWorkflow._match({"title": "AI产品经理", "scale": "", "salary": ""}, config["criteria"])
        unrelated = BossWorkflow._match({"title": "销售工程师", "scale": "", "salary": ""}, config["criteria"])
        self.assertTrue(accepted["matched"])
        self.assertFalse(denied["matched"])
        self.assertIn("title_denied:产品经理", denied["reasons"])
        self.assertFalse(unrelated["matched"])
        self.assertIn("title_denied:销售", unrelated["reasons"])
