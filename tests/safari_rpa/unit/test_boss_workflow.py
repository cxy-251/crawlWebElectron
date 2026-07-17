from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import patch

from safari_rpa.workflows.boss import BossWorkflow


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


if __name__ == "__main__":
    unittest.main()
