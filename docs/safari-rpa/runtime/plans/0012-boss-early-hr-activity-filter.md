# Plan 0012: Boss Early HR Activity Filter

## Context
The Boss Zhipin workflow frequently attempts to engage with jobs posted by HRs who have not been active recently (e.g., inactive for a month, half a year, etc.). Loading the job detail page (JD) for these inactive postings wastes time and API quotas.

## Goal
Avoid processing jobs from HRs who have not been active within the last week. Filter them out as early as possible—specifically during the extraction of the job list on the search results page—to bypass loading their job detail pages entirely.

## Supplements
Supplements `0011-site-workspace-and-risk-signals.md` by refining the Boss search extraction logic.

## Architecture & Implementation
1. **Frontend JS Extraction (`adapter.py`)**:
   - In `BossPageAdapter.open_search`, update the JavaScript evaluation block that parses the search results list (`li.job-card-box`).
   - Extract the entire text of each job card and match against known active time phrases using regex: `/(刚刚活跃|今日活跃|当前在线|\d+日内活跃|本周活跃|本月活跃|\d+个月内活跃|近半年活跃|半年前活跃)/`.
   - Before returning the parsed object, explicitly test if the active time contains keywords indicating inactivity exceeding a week (`本月`, `月内`, `半年`, `年前`).
   - If the HR is deemed inactive, return `null`. The `.filter(Boolean)` step will instantly discard these entries before the array is serialized and returned to Python.

2. **Python Workflow (`boss.py`)**:
   - No new rejection handling logic is needed in Python because the inactive jobs are discarded at the browser layer and are never received by the Python `execute` loop.
   - The workflow naturally receives a cleaner, pre-filtered list of links, focusing purely on recently active HR posts.

## Verification
- Code changes have been applied.
- Next steps: Verify that the search extraction correctly drops inactive jobs and that Python logs show a higher quality (recent) subset of jobs.
