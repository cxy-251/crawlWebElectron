# 0006 — Twitter prompt extraction, local LLM boundary, and workflow split

## Status

- Accepted: 2026-06-27
- Implementation: implemented and verified
- Supersedes the unfinished ChatGPT portions of 0005.
- Reason: ChatGPT browser automation is moving to the Electron runtime; Safari RPA Runtime should stay focused on Safari workflows where real browser state is required.

## Summary

ChatGPT and Kuaishou are fully removed from Safari RPA Runtime's public workflow registry, CLI/API workflow list, examples, and tests. Boss remains the production workflow. A new read-only Twitter/X workflow extracts tweet text from a configured profile and sends it through a dedicated local LLM module backed by LM Studio.

## Architecture decisions

- `bootstrap` registers only Boss and `twitter.extract-prompts.v1`.
- Running old workflow IDs such as `chatgpt.batch-generate.v1` and `kuaishou.upload.v1` returns `WORKFLOW_NOT_FOUND`.
- Twitter/X access is read-only: navigate, inspect, extract, and scroll; no likes, reposts, follows, replies, or publishing.
- The Twitter workflow defaults to original-post extraction. Replies and reposts are excluded; quote tweets keep only the target author's own text.
- Twitter collection stops by quantity first through `limits.max_tweets`, with `max_scrolls` and `max_no_new_rounds` as safety bounds.
- Local model access was initially centralized in `macrpa.llm`. 0007 extracts the reusable provider package to `macrpa_llm` and injects it through `context.llm`.

## LLM contract

- Initial provider: LM Studio at `http://127.0.0.1:1234/v1/chat/completions`.
- Configurable fields: model, base URL, temperature, timeout, max tokens, retries, and batch size.
- The LLM module owns request shape, timeout handling, retry, JSON parsing, and sanitized diagnostics.
- Twitter prompt cleanup returns JSON records with `tweet_id`, `source_url`, `prompt`, `topic`, `quality`, `reason`, and `dropped`.
- Non-prompt content is marked `dropped=true`; malformed or missing LLM results are written to a failure artifact without failing the whole run.

## Implementation checklist

- [x] Record 0006 and update the plan index.
- [x] Remove ChatGPT and Kuaishou from the public workflow boundary.
- [x] Add LM Studio integration module.
- [x] Add Twitter/X site adapter and prompt extraction workflow.
- [x] Add Twitter example config and input.
- [x] Update API docs, OpenAPI, README, and tests.
- [x] Run Conda `kwai` verification and record the outcome.

## Verification record

- `PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest discover -s tests/safari_rpa -v` — passed, 61 tests, 4 explicit opt-in skips.
- `MACRPA_TEST_LOOPBACK=1 PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.integration.test_loopback_api -v` — passed.
- `MACRPA_TEST_SAFARI=1 PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.integration.test_safari_live -v` — passed.
- `PYTHONPATH=src/safari-rpa conda run -n kwai safari-rpa --home local-api-usage/safari-rpa/var workflows` — passed; only Boss and Twitter workflows are advertised.
