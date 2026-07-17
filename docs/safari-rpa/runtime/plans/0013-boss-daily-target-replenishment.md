# Plan 0013: Boss Daily Target Replenishment

## Context
The Boss production workflow caps daily communication at 110, but it currently treats that value only as a ceiling. A fixed ten-per-city limit, one weekday keyword, permanent rejection records, and permanent experience-mismatch attempt records progressively shrink the usable candidate pool. The scheduled run can therefore stop far below 110 even when other cities or related keywords still contain suitable jobs.

## Goal
Keep 110 as the hard daily safety limit while continuing to search until the target is reached or the configured candidate pool is genuinely exhausted.

## Supplements
Supplements `0012-boss-early-hr-activity-filter.md`. The one-week HR activity rule remains in force for known activity values.

## Decisions

1. **Daily keyword rotation**
   - Each weekday owns an ordered list of related search keywords.
   - The list receives a date-based rotation so the same keyword does not always start first each week.
   - Each city receives an additional city-position rotation so different cities start from different keywords during the same run.
   - The balanced phase and overflow phase use different starting offsets.

2. **Two-phase city allocation**
   - Phase one keeps `limits.per_city` as an initial balancing cap.
   - If the daily target remains incomplete, phase two revisits the keyword/city matrix without the city cap.
   - The global `limits.daily` and `limits.run` limits remain authoritative and are never exceeded.

3. **Expiring non-success state**
   - Filter rejections are stored with the report date and are reevaluated on later days.
   - Confirmed communications remain permanently idempotent by job ID.
   - Experience-mismatch outcomes may be retried on a later day through a date-scoped attempt key instead of permanently poisoning the job ID.

4. **Unknown HR activity**
   - Known activity outside the configured one-week allowlist remains rejected.
   - Missing HR activity text may be allowed by configuration so a temporary DOM extraction gap does not collapse the whole daily candidate pool.

5. **Observability**
   - The result reports the selected keyword order, target shortfall, completed scan phases, and a concrete stop reason.

## Verification
- Validate Python syntax for `boss.py`.
- Confirm weekday keyword lists resolve to unique non-empty values.
- Confirm the balanced phase applies the city cap and the overflow phase removes it.
- Confirm all communication paths still stop at the shared daily limit.
- Live Boss verification remains required because selectors, risk controls, and available candidate volume depend on the logged-in account.
