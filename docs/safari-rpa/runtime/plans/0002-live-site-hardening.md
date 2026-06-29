# 0002 — Live-site contract hardening

- Status: Implemented
- Accepted: 2026-06-20
- Implemented: 2026-06-20
- Supplements: 0001-foundation.md

## Reason

Safari inspection of the authenticated ChatGPT and Boss Zhipin pages exposed live DOM contracts that the foundation implementation did not model. This plan keeps the architecture from 0001 and hardens the browser and site-adapter boundaries.

## Safari capability changes

- Add a script locator for elements that require site-specific scoped lookup.
- Add a state-aware hover/reveal action with an observable postcondition.
- Dispatch PointerEvent and MouseEvent sequences for modern menu controls; a plain JavaScript `click()` is not sufficient for ChatGPT Radix controls.
- Continue serializing actions and persist completion only after their postconditions are observed.

## ChatGPT changes

- Locate the configured project row by exact project name, reveal its trailing controls, and click the row-scoped `Open project home` control to prepare a blank project conversation.
- Never substitute the global New chat control for a requested project conversation.
- Model selection is a semantic pair: model family `GPT-5.5` and reasoning level `high`.
- Verify both independent radio groups while accepting collapsed labels such as `GPT-5.5 Thinking`, `5.5 Thinking`, and `High`.
- Keep `select_high: true` as a compatibility alias for the new model configuration.

## Boss changes

- Use `/web/geek/jobs` as the canonical search surface.
- Treat `ul.rec-job-list a.job-name` as the loaded-list signal and recognize combined list/detail pages.
- Extract only list-scoped jobs and deduplicate by canonical job ID, excluding the right-side detail panel and security-query variants.
- Restore the eleven-city sample and use weekday keywords `python`, `ai`, `c++`, `前端`, `安卓`, `iOS`, and `鸿蒙`.

## Verification

- Unit tests cover pointer actions, hover postconditions, scoped project controls, model aliases, Boss page classification, scoped extraction, and configuration.
- A ChatGPT live smoke test prepares a blank conversation in project `gmail` and verifies `GPT-5.5` plus `High` without submitting a prompt.
- A Boss live smoke test loads Shenzhen plus `iOS`, verifies the list count, and performs no communication action.
- All checks run in the Conda `kwai` environment.

## Implementation record

- [x] Safari pointer-aware interaction contract
- [x] ChatGPT project conversation and model selection
- [x] Boss search-page detection and sample configuration
- [x] Unit and live-site verification
- [x] Documentation and final outcome

## Outcome

- The default suite passes 22 tests with four permission/opt-in integrations skipped.
- The two authenticated live-site tests pass: ChatGPT resolves project `gmail` with `GPT-5.5` and `High`; Boss resolves Shenzhen plus `iOS` as `search_detail` and returns 15 unique list jobs.
- The Safari inventory and loopback REST integration tests pass when explicitly enabled.
- `safari-rpa doctor` confirms Conda `kwai`, Python 3.14.4, Safari, Apple Events, and the runtime directory.
- Neither live-site verification submitted a ChatGPT prompt nor triggered Boss communication.
