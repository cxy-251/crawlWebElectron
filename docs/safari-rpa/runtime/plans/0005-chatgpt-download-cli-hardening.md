# 0005 — ChatGPT download, Boss developer search, and CLI hardening

- Status: Paused for ChatGPT work; superseded by 0006 for workflow boundary decisions
- Accepted: 2026-06-26
- Supplements: 0004

## Decisions

- Boss keeps the updated city sample: 深圳、广州、杭州、上海、成都、武汉、南京、苏州、东莞、佛山、重庆.
- Boss weekday keywords are developer-role queries, not broad technology keywords, so non-development jobs are less likely to be contacted.
- Boss adds a configurable title allow/deny filter before communication. A job must look like a development role and must not match obvious non-development titles.
- ChatGPT success requires the latest assistant response to have the GPT-5.5 Thinking signature and an actionable download control.
- A plain filename in assistant text is diagnostic evidence only; it is not a download link and cannot mark a task succeeded.
- ChatGPT may retry one fresh project chat when the first latest response has no actionable download entry.
- CLI becomes a package with parser, registry, output, errors, and command modules. CLI behavior stays compatible.
- `scheduled-run` command delegates to the application layer; Safari readiness retry and deadline blocking are application responsibilities.

## Interfaces

- Boss config accepts `criteria.title_allow` and `criteria.title_deny` lists in addition to existing filters.
- ChatGPT config accepts `download.link_timeout_seconds`, defaulting to a short wait after generation completes.
- ChatGPT adapter exposes latest-response, download-candidate, download-click, and sanitized diagnostic operations.
- Application service exposes `run_scheduled_workflow(workflow_id, config_path, ready_until, retry_seconds)`.
- CLI public command names, arguments, JSON response shape, and exit codes remain unchanged.

## Verification

- Unit tests cover Boss new city/keyword samples, developer title filtering, and skipped non-development roles.
- Unit tests cover ChatGPT actionable download links, attachment controls, filename-only text diagnostics, candidate priority, delayed link rendering, and retry failure behavior.
- Unit tests verify CLI command registry dispatch, JSON output compatibility, and that `scheduled-run` handlers contain no Safari readiness loop.
- Application tests cover scheduled readiness retry, blocked deadline output, and normal scheduled execution.
- Conda `kwai` runs the default suite. Loopback and Safari checks remain explicit integration gates.
- ChatGPT live smoke uses only `configs/chatgpt-tasks.live.csv`; Boss production is not manually started.

## Implementation record

- [ ] Plan/index update
- [ ] Boss developer search contracts
- [ ] ChatGPT actionable download contract
- [ ] Scheduled-run application orchestration
- [ ] CLI package split
- [ ] Tests and integration checks
- [ ] Outcome documentation

## Actual result

- Pending implementation.
