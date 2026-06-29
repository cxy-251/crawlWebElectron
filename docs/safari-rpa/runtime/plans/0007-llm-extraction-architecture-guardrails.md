# 0007 — Detachable LLM package and architecture guardrails

## Status

- Accepted: 2026-06-27
- Implementation: implemented and verified
- Supplements: 0006

## Summary

LLM integration must be reusable outside Safari RPA Runtime. This plan extracts the local LLM code into a top-level `macrpa_llm` package with no dependency on `macrpa.*`, injects local model access through a workflow context port, fixes Twitter profile target normalization, and adds architecture guardrails to reduce long-term coupling.

## Decisions

- `macrpa_llm` is the reusable package boundary. It owns provider-neutral types, LLM errors, JSON parsing, retry behavior, and the LM Studio provider.
- `macrpa.llm` remains only as a compatibility shim. New Safari RPA code should depend on `macrpa.contracts.llm.LocalLlmPort`.
- Workflows call `context.llm.generate_json(...)`; they must not instantiate provider clients or import provider HTTP libraries.
- Twitter target config uses `profile_url` for full URLs and still accepts short handles. A full URL accidentally supplied as `handle` is normalized to `profile_url`.
- Architecture uses Ports & Adapters: contracts are ports, adapters/providers talk to external systems, runtime/application orchestrate, workflows hold business use cases, and CLI/REST translate I/O only.

## Implementation checklist

- [x] Record 0007 and update the plan index.
- [x] Add architecture docs and AGENTS guardrails.
- [x] Move reusable LLM code to `macrpa_llm`.
- [x] Add MacRPA `LocalLlmPort` and application service adapter.
- [x] Update Twitter workflow to use `context.llm`.
- [x] Normalize Twitter target config and preserve user model/profile values.
- [x] Add tests for LLM extraction, target normalization, and architecture boundaries.
- [x] Run Conda `kwai` verification and record the outcome.

## Verification record

- `PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest discover -s tests/safari_rpa -v` — passed, 68 tests, 4 explicit opt-in skips.
- `MACRPA_TEST_LOOPBACK=1 PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.integration.test_loopback_api -v` — passed.
- `MACRPA_TEST_SAFARI=1 PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.integration.test_safari_live -v` — passed.
