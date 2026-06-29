# 0004 — Reliability, daily reports, concurrency, and scheduling

- Status: Implemented and verified
- Accepted: 2026-06-20
- Supplements: 0001, 0002, and 0003

## Decisions

- ChatGPT rich-text drafting is retryable; sending is the external side effect.
- A task uses its `task_id` when `prompt` is empty and may open at most two project chats.
- Only a latest response with the GPT-5.5 Thinking signature and a download link succeeds.
- Boss experience-mismatch dialogs are cancelled and skipped without consuming quota.
- Body text containing the digits `403` is never a risk signal by itself.
- SQLite is the communication source of truth; `var/reports/boss/YYYY-MM-DD.csv` is its daily projection.
- Boss and ChatGPT may run concurrently, while individual Safari actions remain serialized across processes.
- Boss production runs daily at 06:00 Asia/Shanghai. A companion LaunchAgent keeps the AC-powered Mac awake.

## Interfaces

- Add report and schedule records to runtime contracts and SQLite migrations.
- Add generic report and schedule REST APIs plus CLI management commands.
- Document every layer's public responsibility and provide a read-only SQLite guide in `docs/api/`.

## Verification

- Tests cover rich text, retry boundaries, popup cancellation, risk signals, report recovery, concurrency, plist generation, REST, and migrations.
- Live ChatGPT verification sends only `SER-BIOSHOCK-001`, allowing one retry.
- Boss production is not manually started during rollout.
- Existing confirmed Boss records are backfilled into the stable daily report.

## Implementation record

- [x] ChatGPT draft/send reliability
- [x] Boss mismatch and risk handling
- [x] Daily report persistence and APIs
- [x] Concurrent execution and Safari coordination
- [x] LaunchAgent installation
- [x] API and SQLite documentation
- [x] Unit, integration, and live verification

## Actual result

- The default Conda `kwai` suite passed 50 tests; the explicit loopback and Safari permission checks also passed.
- Live run `48ddfd3ec3934a37b5c979d37d61a55b` sent only `SER-BIOSHOCK-001` and succeeded on attempt one. Draft, send reconciliation, Thinking signature, download control, and the archived `.md` file were all confirmed.
- Existing unknown ChatGPT runs were left unchanged for audit and were not resumed.
- The 2026-06-20 Boss rebuild found 92 distinct, performed, non-preexisting confirmed job IDs: the original 10-record test plus 9, 33, and 40 confirmations completed before later runs ended blocked, unknown, and succeeded. The stable daily report therefore contains 92 records and leaves 18 under the 110 daily limit.
- Both plists passed `plutil -lint`. The Boss LaunchAgent is loaded with a 06:00 calendar trigger, zero runs, and no `RunAtLoad`; the AC keep-awake agent is running and owns a `PreventSystemSleep` assertion.
