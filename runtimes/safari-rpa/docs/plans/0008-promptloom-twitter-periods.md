# 0008 — PromptLoom independent LLM workflow and Twitter periods

## Status

- Accepted: 2026-06-27
- Implementation: implemented and verified
- Supplements: 0007

## Summary

0007 proved the LLM code can be separated from MacRPA, but the package name and workflow boundary were still too close to MacRPA. This plan replaces `macrpa_llm` with the independent `promptloom` package, moves prompt-cleaning behavior into PromptLoom workflows, and makes Twitter extraction period-aware so repeated runs do not repeatedly clean the same tweets.

## Decisions

- `promptloom` is the independent LLM workflow package. It must not import `macrpa.*`.
- PromptLoom exposes `run_workflow(workflow_id, input_data, runtime_options=None)`.
- The first workflow is `prompt.clean.v1`; callers pass only raw content items. PromptLoom owns the model identity, system prompt, output schema, parsing, retry, and diagnostics.
- MacRPA workflows use `WorkflowContextPort.llm.run_workflow(...)`; they must not write provider HTTP calls or LLM prompt templates.
- Twitter extraction defaults to target-author original tweets only.
- Twitter periods default to the current ISO week in `Asia/Shanghai`; repeated runs de-duplicate by `target_handle + period_key + tweet_id`.
- Twitter stable outputs live under `var/reports/twitter/<handle>/<period_key>/`.

## Implementation checklist

- [x] Record 0008 and update plan/architecture docs.
- [x] Replace `macrpa_llm` with `promptloom`.
- [x] Add PromptLoom workflow registry and `prompt.clean.v1`.
- [x] Update MacRPA LLM port and application service.
- [x] Tighten Twitter adapter to original tweets and detail-page full text.
- [x] Add generic period item ledger and stable period report artifacts.
- [x] Update Twitter workflow to use weekly periods and PromptLoom workflows.
- [x] Add tests for PromptLoom, Twitter periods, de-duplication, and architecture boundaries.
- [x] Run Conda `kwai` verification and record results.

## Verification record

- `PYTHONPATH=src conda run -n kwai python -m unittest discover -s tests -v` — passed, 72 tests, 4 explicit opt-in skips.
- `MACRPA_TEST_LOOPBACK=1 PYTHONPATH=src conda run -n kwai python -m unittest tests.integration.test_loopback_api -v` — passed.
- `MACRPA_TEST_SAFARI=1 PYTHONPATH=src conda run -n kwai python -m unittest tests.integration.test_safari_live -v` — passed.
