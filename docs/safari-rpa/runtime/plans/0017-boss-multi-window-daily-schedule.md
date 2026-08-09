# Plan 0017: Boss Multi-Window Daily Schedule

## Status

- Accepted: 2026-08-08
- Implementation: complete
- Supplements: `0016-boss-background-job-card-filtering.md`

## Goal

Run the existing Boss production workflow every day at `08:00` and `13:00`
through one LaunchAgent. Both triggers consume the same confirmed daily ledger
and stop when the shared `110` total is reached. Do not introduce a smaller
per-window communication target.

## Decisions

1. **One agent, multiple calendar triggers**
   - `schedule install` accepts repeated `--at HH:MM` values.
   - One `StartCalendarInterval` array owns both triggers so repeated installs
     do not overwrite separate agents with the same fixed Boss label.
   - The persisted `daily_at` field remains backward compatible by storing a
     comma-separated display value; metadata stores the structured time list.

2. **Shared quota, not split quotas**
   - Production retains `limits.run: 110` and `limits.daily: 110`.
   - The first run may use any available portion of the daily quota. The second
     run reads confirmed effects from the same Asia/Shanghai day and only fills
     the remaining amount.
   - No schedule-specific `40`, `55`, or other per-window limit is added.

3. **Relative readiness deadline**
   - Each trigger receives a bounded relative Safari-readiness window instead
     of the old hard-coded `12:00` deadline.
   - A delayed or unavailable Safari session produces a blocked run after the
     readiness window; it does not wait indefinitely.

4. **Concurrency and write boundary**
   - One launchd label does not start concurrent instances of the same job.
   - The workflow-level file lock remains the final overlap guard.
   - The Boss workflow write boundary remains the confirmed visible
     `立即沟通` click; scheduling does not add chat, greeting, resume, or message
     writes.

5. **Operations documentation**
   - README records install, inspect, modify, active-run cancellation, schedule
     uninstall, plist paths, logs, SQLite state, per-run CSVs, and daily CSVs.
   - Uninstalling the LaunchAgent does not delete runtime history or artifacts.

6. **Concise CLI records**
   - CLI run, resume, scheduled-run, and status output presents a run summary
     instead of serializing the stored `config` and `input` objects.
   - Success output keeps the run id, workflow, status, result summary, and
     artifact/status follow-up commands. Failure output keeps the run id,
     status, and error details.
   - Full configuration remains stored in SQLite for resume and audit but is
     not echoed after every command.

7. **Renamed report archives**
   - SQLite remains authoritative for quota and deduplication, while daily CSVs
     remain rebuildable views.
   - When a registered Boss CSV path is missing, report reads search
     `reports/boss*` for the same date and repair the stored path only when the
     result is unique. The canonical current `reports/boss` path wins when it
     exists; associated artifact and run-result file references are
     synchronized and ambiguous archives are never guessed.
   - New runs continue writing to `reports/boss`; historical archive
     directories are not moved or deleted.

## Verification

- Unit tests cover repeated `--at`, multiple launchd calendar intervals,
  normalized persisted times, relative readiness arguments, and the absence of
  full run configuration in CLI output.
- The complete Safari RPA test suite passes through the repository uv
  workspace.
- Installation is verified with schedule status, plist parsing, and
  `launchctl print`; no production workflow is manually started.

### Verification record: 2026-08-08

- Full suite: 120 tests, 116 passed and 4 expected live-integration skips.
- Installed schedule: one loaded
  `com.browser-workflow.safari-rpa.boss-production` LaunchAgent with calendar
  triggers at `08:00` and `13:00`; generated plist passed `plutil -lint`.
- Keep-awake: `com.browser-workflow.safari-rpa.keep-awake` loaded and running.
- Installation created no immediate production run.
- Historical archive repair: all 35 records from `2026-06-29` through
  `2026-08-02` now resolve to the existing `boss-629-802` CSVs; zero stale old
  report, artifact, or run-result file paths remain. The `2026-08-08` current
  report remains under `reports/boss`.

## Non-goals

- Do not run an immediate production communication batch during installation.
- Do not delete existing reports, logs, database records, or user-created
  runtime files.
- Do not add a `19:00` trigger.
