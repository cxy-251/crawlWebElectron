# LM Studio guide

Safari RPA Runtime calls local models through `WorkflowContextPort.llm`. Workflows should not call LM Studio HTTP endpoints directly. Reusable LLM workflows and provider code live in the independent `promptloom` package, while Safari RPA maps PromptLoom errors through its application-layer LLM service.

## Start LM Studio

1. Open LM Studio and load a local chat model.
2. Start the local server.
3. Keep the default OpenAI-compatible base URL unless you intentionally changed it:

```text
http://127.0.0.1:1234/v1
```

The workflow sends requests to `/chat/completions`.

## Twitter prompt extraction

Collect raw tweets first:

```bash
PYTHONPATH=src/safari-rpa conda run -n kwai safari-rpa run \
  twitter.collect-raw.v1 \
  --config local-api-usage/safari-rpa/configs/twitter/collect.yaml \
  --input local-api-usage/safari-rpa/configs/twitter/target.json
```

Inspect `var/reports/twitter/<handle>/<period>/raw.jsonl`. If the raw tweets are useful, clean pending raw records:

```bash
PYTHONPATH=src/safari-rpa conda run -n kwai safari-rpa run \
  twitter.clean-prompts.v1 \
  --config local-api-usage/safari-rpa/configs/twitter/clean.yaml \
  --input local-api-usage/safari-rpa/configs/twitter/target.json
```

Important config fields:

- `llm.model`: the model name loaded in LM Studio.
- `llm.timeout_seconds`: total request timeout for one batch.
- `llm.retries`: retry count for retryable local model or JSON parse failures.
- `llm.batch_size`: number of tweets per cleanup request.
- `period.week`: optional ISO week such as `2026-W26`; omitted means the current Asia/Shanghai week.

The deprecated `twitter.extract-prompts.v1` workflow still runs collect and clean together for compatibility, but the recommended workflow is the two-step collect/inspect/clean loop.

PromptLoom's `prompt.clean.v1` workflow asks the LLM for a JSON object with `results`. Invalid JSON is retried by the LLM module and then written to the workflow failure artifact if it still cannot be parsed.

## Safety

Twitter/X collection is read-only. Safari may need an already logged-in X/Twitter session. Login, security verification, and rate-limit pages block collection instead of being bypassed. Single status-detail timeouts are written to `raw-failures.jsonl` and do not enter PromptLoom cleanup. Consecutive status-detail timeouts stop collection early according to `detail.max_consecutive_detail_timeouts`.
