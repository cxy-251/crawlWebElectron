# 0003 — ChatGPT tools and Boss communication quotas

- Status: Implemented and live-site verified
- Accepted: 2026-06-20
- Supplements: 0001-foundation.md and 0002-live-site-hardening.md

## Reason

The current ChatGPT adapter only recognizes the legacy Tools launcher and can fail with `CHATGPT_TOOLS_MISSING`. Boss communication limits are counted only inside the current run and successful clicks are not sufficiently scoped to the current job, causing long scans and unreliable quota completion.

## ChatGPT

- Prefer an already active or directly visible Search control in the composer.
- Support the current composer plus/Add/More launcher and the legacy Tools launcher.
- Recognize menu item, checkbox, radio, pressed, checked, and on states.
- Disable Deep Research before enabling ordinary Search.
- Return sanitized composer-control diagnostics when no supported control can be found.

## Boss

- Persist a random rotated city order per run and reuse it on resume.
- Add a per-run target while retaining the shared daily limit and ten-per-city daily limit.
- Count only side effects that were confirmed for the same job; pre-existing communication does not consume a new quota.
- Stop the current job/page/city loops immediately when a city or run target is reached.
- Persist full confirmed job evidence in the side-effect output and generate run and daily confirmed-only CSV ledgers.
- Provide collection-only, ten-communication test, and 110-daily production configurations.

## Quota policy

- Test starts from one random city and follows the configured city order, with a run target of ten and a per-city limit of ten.
- Test communication counts toward the shared 110 daily limit.
- Production adds at most the remaining daily allowance; after a ten-record test it can add at most 100 records.
- If one city cannot meet its remaining quota within the scan bounds, processing advances to the next city.

## Verification

- Unit tests cover ChatGPT launcher/state variants and diagnostic errors.
- Runtime and workflow tests cover persisted order, per-run/daily/city quotas, pre-existing communication, uncertain side effects, immediate stopping, resume, and confirmed-only ledgers.
- ChatGPT live verification enables ordinary Search without submitting a prompt.
- Boss live verification uses the test profile and performs at most ten confirmed communications; production is not executed during verification.

## Implementation record

- [x] ChatGPT Search control compatibility
- [x] Runtime confirmed-side-effect ledger query
- [x] Boss quota, ordering, confirmation, and stopping behavior
- [x] Collection/test/production configurations
- [x] Unit and live-site verification
- [x] Documentation and final outcome

## Outcome

- The default Conda `kwai` suite passes 37 tests with four opt-in integration tests skipped.
- ChatGPT live verification entered the `gmail` project, confirmed `GPT-5.5` plus `High`, and enabled ordinary Search with Deep Research inactive. No prompt was filled or sent.
- The current Search pill exposes `Search, click to remove` rather than pressed/checked state; this observed signal and the `__composer-pill` fallback are now part of the adapter contract.
- Boss live read-only verification returned 15 unique jobs from the scoped Shenzhen `iOS` result list.
- The real Boss test profile started at a persisted random city and stopped after exactly ten scanned, matched, and same-job-confirmed communications. Both the run CSV and daily CSV parse to ten records, and all ten side-effect records contain complete confirmation evidence.
- The resulting daily ledger leaves a maximum of 100 additional production communications for the same day. The production profile was not executed during verification.
