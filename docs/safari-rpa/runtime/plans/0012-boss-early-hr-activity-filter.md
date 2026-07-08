# Plan 0012: Boss Early HR Activity Filter

## Context
The Boss Zhipin workflow frequently attempts to engage with jobs posted by HRs who have not been active recently (e.g., inactive for a month, half a year, etc.). Loading the job detail page (JD) for these inactive postings wastes time and API quotas.

## Goal
Avoid processing jobs from HRs who have not been active within the last week. The check is performed at the job detail page (JD) level to ensure accuracy, since external search cards frequently hide or omit the HR active tag.

## Supplements
Supplements `0011-site-workspace-and-risk-signals.md` by refining the Boss search extraction and matching logic.

## Architecture & Implementation
1. **Frontend JS Extraction (`adapter.py`)**:
   - In `BossPageAdapter.read_job`, read the text from the HR info section (`.boss-info` or body).
   - Extract the active time using regex: `/(刚刚活跃|今日活跃|当前在线|\d+日内活跃|本周活跃|本月活跃|\d+个?月内活跃|近半年活跃|半年(?:前|以前)?活跃|半年前)/`.
   - Add the extracted `hr_active_time` to the return dictionary.
   - The list page extraction (`open_search`) remains untouched and solely collects links.

2. **Python Workflow (`boss.py`)**:
   - In `BossWorkflow._match`, extract `hr_active_time`.
   - Reject the job (add `hr_not_active_recently`) if the time contains any keywords indicating inactivity exceeding a week (`本月`, `月内`, `半年`, `年前`).
   - If rejected, the workflow skips clicking the communicate button and drops the job.

## Verification
- Code changes have been applied to `adapter.py` and `boss.py`.
- Next steps: Verify that the workflow successfully opens JDs, catches inactive HRs, and records the rejection reason accurately.


conda管理包 改成 uv管理 所有 conda run -n kwai 都换成 uv run