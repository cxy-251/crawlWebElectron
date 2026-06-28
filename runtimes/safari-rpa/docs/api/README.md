# Safari RPA Runtime API contracts

Safari RPA Runtime exposes one application service to the CLI, REST/SSE transport and future Electron host. A client must not call Safari or SQLite directly.

## Layer ownership

| Layer | Public responsibility | Internal details it owns |
|---|---|---|
| Contracts | Typed Safari, runtime and workflow interfaces | Compatibility and data shapes |
| Safari adapter | Window/tab discovery and state-aware atomic browser actions | AppleScript, DOM scripts, PointerEvent and the shared action lock |
| Site adapters | Stable semantic operations for Boss and Twitter/X | Current selectors and page-state recognition |
| LLM | Local model port for workflows | Safari RPA error mapping and reusable `promptloom` workflow integration |
| Runtime | Steps, retries, side-effect reconciliation, events and artifacts | SQLite schema, checkpoints and workflow process locks |
| Workflows | Business order, validation and quotas | Boss matching/communication and Twitter raw collection or prompt cleanup |
| Application | The use cases shared by every transport | Registry, reports and schedules |
| REST/SSE, CLI | Input/output translation only | HTTP, auth, JSON, command parsing |

Layer callers depend on the public contract directly below them. A website adapter may change selectors without changing a workflow; Electron may move from CLI invocation to REST without changing business behavior.

## Local service

Start the service with a loopback-only bearer token:

```bash
SAFARI_RPA_API_TOKEN=replace-me PYTHONPATH=src conda run -n kwai \
  safari-rpa --home var serve --host 127.0.0.1 --port 3211
```

The machine-readable contract is [openapi-v1.yaml](openapi-v1.yaml). Runs are created through `POST /api/v1/runs`; progress is resumable through the run SSE endpoint. Reports return stable metadata and CSV content. Schedule `PUT`/`DELETE` installs or unloads user LaunchAgents and therefore changes local system state.

Electron should treat run status and SSE events as authoritative, keep the bearer token outside renderer code, and display `blocked` or `unknown_side_effect` for human inspection rather than retrying external writes.

Python workflow code receives only `WorkflowContextPort`. Site adapters receive only `SafariAutomationPort`. Workflows that need local model output call `context.llm.run_workflow(...)`; they do not call LM Studio HTTP directly, instantiate provider clients, or define reusable LLM prompt templates. The independent LLM workflow package is `promptloom`, which has no dependency on `macrpa.*`. This boundary is tested by `tests/unit/test_contracts_and_architecture.py`.

## Twitter/X and LM Studio

Run Twitter prompt extraction as two explicit phases through the generic run API or CLI:

```bash
PYTHONPATH=src conda run -n kwai safari-rpa run \
  twitter.collect-raw.v1 \
  --config configs/twitter.collect.example.yaml \
  --input configs/twitter-target.example.json

PYTHONPATH=src conda run -n kwai safari-rpa run \
  twitter.clean-prompts.v1 \
  --config configs/twitter.clean.example.yaml \
  --input configs/twitter-target.example.json

# Thin CLI wrappers; these still go through application/runtime/workflow.
PYTHONPATH=src conda run -n kwai safari-rpa twitter collect
PYTHONPATH=src conda run -n kwai safari-rpa twitter clean
```

Safari must already be logged in to X/Twitter if the profile is not publicly readable. `twitter.collect-raw.v1` is read-only and stops at `limits.max_tweets`, with scroll safety limits. By default it keeps only target-author original tweets and groups them into the current Asia/Shanghai ISO week. Detail pages are throttled through `detail.detail_pause_seconds`, `detail.detail_timeout_seconds`, `detail.detail_retry_attempts`, and `detail.between_detail_seconds`; single status-detail failures write `raw-failures.jsonl` and do not enter the LLM cleanup queue. If `WAIT_TIMEOUT` repeats for `detail.max_consecutive_detail_timeouts` consecutive status details, collection stops early with `stop_reason=consecutive_detail_timeouts`.

`twitter.clean-prompts.v1` does not call Safari. It reads pending raw records from the period ledger and stable raw artifact, then calls `context.llm.run_workflow("prompt.clean.v1", ...)`. LM Studio must be running locally with a loaded model; the default endpoint is owned by `promptloom.providers.lmstudio`. The old `twitter.extract-prompts.v1` combined workflow remains available but is deprecated. See [lm-studio-guide.md](lm-studio-guide.md) for local model setup and failure behavior.
