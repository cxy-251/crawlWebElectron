# 0009 — Twitter two-phase raw collection and prompt cleaning

## Status

- Accepted: 2026-06-27
- Implementation: implemented and verified
- Supplements: 0008

## Summary

0008 made Twitter extraction period-aware, but raw collection and PromptLoom cleanup still ran in one workflow. Live use showed X/Twitter status detail pages may briefly render as blank or skeleton screens, and a detail timeout should not discard already collected raw data. This plan splits Twitter into raw collection and prompt cleaning workflows, slows detail-page reads, and keeps the old combined workflow as a deprecated compatibility entry.

## Decisions

- `twitter.collect-raw.v1` uses Safari only and writes raw period artifacts plus `pending` ledger items.
- `twitter.clean-prompts.v1` uses PromptLoom only and reads pending raw items from the shared Twitter period ledger.
- `twitter.extract-prompts.v1` remains available for compatibility, but docs recommend the two-step flow.
- The shared ledger namespace remains `twitter.extract-prompts.v1` so 0008 data stays readable after the split.
- Single tweet detail failures are written to a raw failure artifact and do not trigger cleanup. Login, risk-control, and rate-limit states still block the whole collection run.

## Implementation checklist

- [x] Record 0009 and update plan/API docs.
- [x] Add collect and clean workflow descriptors.
- [x] Keep deprecated combined workflow.
- [x] Add configurable detail-page delay, timeout, retry, and between-detail throttle.
- [x] Split raw collection from PromptLoom cleanup.
- [x] Add CLI `twitter collect` and `twitter clean` wrappers.
- [x] Add tests for workflow boundaries, detail failures, and CLI mapping.
- [x] Run Conda `kwai` verification and record results.

## Verification record

- `PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest discover -s tests/safari_rpa -v` — passed, 78 tests, 4 opt-in tests skipped.
- `MACRPA_TEST_LOOPBACK=1 PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.integration.test_loopback_api -v` — passed.
- `MACRPA_TEST_SAFARI=1 PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.integration.test_safari_live -v` — passed.
- Real Twitter live smoke was not run automatically; it remains explicit opt-in and should run collection only.
- Follow-up verification after timeout hardening: default unit suite passed with 81 tests and 4 opt-in skips. A 3-item read-only Twitter live smoke for `https://x.com/Minahil42298354` collected 3 raw tweets, wrote 0 raw failures, and stopped at `max_tweets`.

## Implementation outcome

- Registered `twitter.collect-raw.v1`, `twitter.clean-prompts.v1`, and deprecated compatibility `twitter.extract-prompts.v1`.
- Collection now owns Safari profile navigation, timeline candidate discovery, slow status-detail reads, pending ledger upserts, `raw.jsonl`, `raw-failures.jsonl`, and `summary.json`.
- Cleanup now owns only pending ledger reads, `context.llm.run_workflow("prompt.clean.v1", ...)`, `prompts.jsonl`, `failed.jsonl`, and summary updates.
- Detail reads wait for the target status URL, non-empty primary column, non-skeleton state, and a matching tweet article with visible text; retryable per-tweet failures are recorded without failing the run.
- Follow-up hardening: the default detail timeout is 15 seconds, detail extraction can fall back to the status page title text, and three consecutive `WAIT_TIMEOUT` details stop collection early with `stop_reason=consecutive_detail_timeouts`.
- Added `local-api-usage/safari-rpa/configs/twitter/collect.yaml`, `local-api-usage/safari-rpa/configs/twitter/clean.yaml`, and `safari-rpa twitter collect|clean` convenience commands.
