from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import patch

from safari_rpa.workflows.boss import BossWorkflow
from safari_rpa.workflows.boss_matching import match_job_detail, match_search_card


class FixedFriday(datetime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 7, 17, 6, 0, 0)
        return value.replace(tzinfo=tz) if tz is not None else value


class BossWorkflowTests(unittest.TestCase):
    def test_weekday_keywords_rotate_by_date_and_remove_duplicates(self) -> None:
        search = {
            "weekday_keywords": {
                "fri": [
                    "Android开发",
                    "安卓开发",
                    "客户端开发",
                    "Flutter开发",
                    "移动端开发",
                    "Android开发",
                ]
            }
        }

        with patch("safari_rpa.workflows.boss.datetime", FixedFriday):
            keywords = BossWorkflow._keywords(search)

        self.assertEqual(
            ["移动端开发", "Android开发", "安卓开发", "客户端开发", "Flutter开发"],
            keywords,
        )

    def test_city_rotation_changes_the_first_keyword(self) -> None:
        keywords = ["one", "two", "three"]

        self.assertEqual(["one", "two", "three"], BossWorkflow._rotate(keywords, 0))
        self.assertEqual(["two", "three", "one"], BossWorkflow._rotate(keywords, 1))
        self.assertEqual(["three", "one", "two"], BossWorkflow._rotate(keywords, 2))

    def test_overflow_keywords_exclude_primary_and_require_explicit_opt_in(self) -> None:
        search = {
            "weekday_keywords": {
                "fri": ["primary-one", "primary-two"],
                "sat": ["fallback-one", "fallback-two"],
            },
        }
        self.assertEqual([], BossWorkflow._overflow_keywords(search, ["primary-one", "primary-two"]))

        search["expand_all_keywords_on_shortfall"] = True
        with patch("safari_rpa.workflows.boss.datetime", FixedFriday):
            overflow = BossWorkflow._overflow_keywords(search, ["primary-one", "primary-two"])

        self.assertEqual({"fallback-one", "fallback-two"}, set(overflow))

    def test_unknown_hr_activity_can_be_allowed_without_weakening_known_rejection(self) -> None:
        criteria = {
            "allow_unknown": True,
            "allow_unknown_hr_activity": True,
            "title_allow": ["开发"],
            "title_deny": [],
            "experience_allow": [],
            "education_deny": [],
            "company_size_min": 0,
            "salary_min_k": 0,
            "salary_max_k": 0,
            "hr_active_allow": ["今日活跃", "本周活跃"],
            "hr_title_deny": [],
        }
        base_job = {
            "title": "Python开发",
            "experience": "",
            "education": "",
            "scale": "",
            "salary": "",
            "hr_title": "招聘经理",
        }

        unknown = BossWorkflow._match({**base_job, "hr_active_time": ""}, criteria)
        stale = BossWorkflow._match({**base_job, "hr_active_time": "本月活跃"}, criteria)

        self.assertTrue(unknown["matched"], unknown)
        self.assertFalse(stale["matched"], stale)
        self.assertIn("hr_not_active_recently:本月活跃", stale["reasons"])

    def test_search_card_rejects_non_software_title_before_detail(self) -> None:
        decision = match_search_card(
            {
                "title": "人才招聘顾问（智能座舱方向）",
                "experience": "1-3年",
                "salary": "15-20K",
            },
            {
                "allow_unknown": True,
                "title_allow": ["软件开发", "研发工程师"],
                "title_deny": ["招聘顾问", "人才招聘"],
                "experience_allow": ["1-3年"],
            },
            {"keyword": "智能座舱开发", "title_any": ["智能座舱", "车载软件"]},
        )
        self.assertFalse(decision["matched"])
        self.assertIn("title_denied:招聘顾问", decision["reasons"])

    def test_search_card_rejects_hunter_and_proxy_flags_before_detail(self) -> None:
        criteria = {
            "allow_unknown": True,
            "title_allow": ["开发"],
            "title_deny": [],
        }
        hunter = match_search_card(
            {"title": "C++开发", "gold_hunter": 1},
            criteria,
            {},
        )
        proxy = match_search_card(
            {"title": "Python开发", "proxy_job": "1"},
            criteria,
            {},
        )
        self.assertIn("hr_title_denied:猎头", hunter["reasons"])
        self.assertIn("hr_title_denied:代招", proxy["reasons"])

    def test_detail_requires_active_keyword_jd_relevance(self) -> None:
        criteria = {
            "allow_unknown": True,
            "allow_unknown_hr_activity": True,
            "title_allow": ["软件开发", "软件工程师", "后端开发"],
            "title_deny": [],
            "experience_allow": ["1-3年"],
            "education_deny": [],
            "company_size_min": 0,
            "salary_min_k": 0,
            "salary_max_k": 0,
            "hr_active_allow": [],
            "hr_title_deny": [],
        }
        rule = {
            "keyword": "图像处理",
            "direction": "media_cv",
            "title_any": ["图像处理", "计算机视觉"],
            "jd_core_any": ["图像处理", "OpenCV"],
            "jd_support_any": ["C++", "Python"],
            "deny_any": [],
            "min_score": 4,
        }
        irrelevant = match_job_detail(
            {
                "title": "Java后端开发",
                "experience": "1-3年",
                "jd": "负责金融系统 Java Spring Cloud 微服务开发。",
            },
            criteria,
            rule,
        )
        relevant = match_job_detail(
            {
                "title": "软件工程师",
                "experience": "1-3年",
                "jd": "使用 C++ 和 OpenCV 开发实时图像处理算法。",
            },
            criteria,
            rule,
        )
        self.assertFalse(irrelevant["matched"])
        self.assertIn("jd_core_not_matched:图像处理", irrelevant["reasons"])
        self.assertTrue(relevant["matched"], relevant)

    def test_direction_title_requirement_blocks_generic_search_noise(self) -> None:
        decision = match_search_card(
            {"title": "软件工程师", "experience": "1-3年"},
            {
                "allow_unknown": True,
                "title_allow": ["软件工程师"],
                "title_deny": [],
                "experience_allow": ["1-3年"],
            },
            {
                "keyword": "HarmonyOS开发",
                "title_any": ["HarmonyOS", "鸿蒙", "ArkTS"],
                "require_direction_title": True,
            },
        )
        self.assertFalse(decision["matched"])
        self.assertIn("direction_title_not_matched:HarmonyOS开发", decision["reasons"])

    def test_generic_software_title_can_reach_jd_filter_when_title_requirement_is_disabled(self) -> None:
        decision = match_search_card(
            {"title": "软件工程师", "experience": "1-3年"},
            {
                "allow_unknown": True,
                "title_allow": ["软件工程师"],
                "title_deny": [],
                "experience_allow": ["1-3年"],
            },
            {
                "keyword": "图像处理",
                "title_any": ["图像处理", "图像算法"],
                "require_direction_title": False,
            },
        )
        self.assertTrue(decision["matched"], decision)

    def test_keyword_position_filter_overrides_global_search_params(self) -> None:
        merged = BossWorkflow._search_query_params(
            {"experience": "102,103,104,108", "scale": "304,305,306"},
            {"query_params": {"position": "100202,100213"}},
        )
        self.assertEqual("100202,100213", merged["position"])
        self.assertEqual("102,103,104,108", merged["experience"])

    def test_config_rejects_keyword_without_yaml_rule(self) -> None:
        with self.assertRaisesRegex(Exception, "requires a keyword rule"):
            BossWorkflow._config(
                {
                    "search": {
                        "cities": [{"name": "深圳", "code": "101280600"}],
                        "keywords": ["未配置方向"],
                        "require_keyword_rules": True,
                        "directions": {},
                        "keyword_rules": {},
                    },
                    "communication": {"enabled": True},
                }
            )

    def test_config_rejects_keyword_without_position_filter(self) -> None:
        with self.assertRaisesRegex(Exception, "requires a position filter"):
            BossWorkflow._config(
                {
                    "search": {
                        "cities": [{"name": "深圳", "code": "101280600"}],
                        "keywords": ["HarmonyOS开发"],
                        "require_keyword_rules": True,
                        "require_position_filters": True,
                        "directions": {"client": {}},
                        "keyword_rules": {
                            "HarmonyOS开发": {
                                "direction": "client",
                                "title_any": ["HarmonyOS", "鸿蒙"],
                                "jd_core_any": ["HarmonyOS", "鸿蒙"],
                            }
                        },
                    },
                    "communication": {"enabled": True},
                }
            )


if __name__ == "__main__":
    unittest.main()
