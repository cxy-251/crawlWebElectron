# Safari RPA Runtime

Safari RPA Runtime is a state-aware Safari automation service for repeatable browser workflows. It separates Safari control, reliable task execution, website adapters, business workflows, and application transports.

The current release targets Boss Zhipin automation and read-only Twitter/X prompt extraction. ChatGPT and Kuaishou workflows have moved out of this service boundary and are handled by the Electron runtime in Browser Workflow Forge.

## Environment

Use the existing Conda environment `kwai`:

```bash
conda run -n kwai python --version
conda run -n kwai python -m pip install -e . --no-deps
conda run -n kwai safari-rpa --help
```

Runtime state is written below `var/` and is not tracked by Git.

## Commands

```bash
# Inspect the environment and available workflows
PYTHONPATH=src conda run -n kwai safari-rpa doctor
PYTHONPATH=src conda run -n kwai safari-rpa workflows

# Boss uses one maintained config file. Select behavior with --profile.
# Safe collection-only profile: scans and exports matches, never communicates.
PYTHONPATH=src conda run -n kwai safari-rpa run \
  boss.search-and-communicate.v1 --config configs/boss.production.yaml --profile collection

# External-write test: at most 10 newly confirmed communications. These count
# toward the same 110-per-day ledger used by production.
PYTHONPATH=src conda run -n kwai safari-rpa run \
  boss.search-and-communicate.v1 --config configs/boss.production.yaml --profile test

# Production: at most 110 for the day and 10 per city, automatically deducting
# any test-profile communications already confirmed today.
PYTHONPATH=src conda run -n kwai safari-rpa run \
  boss.search-and-communicate.v1 --config configs/boss.production.yaml --profile production

# Twitter/X two-phase read-only extraction. First collect raw tweets with Safari.
PYTHONPATH=src conda run -n kwai safari-rpa run \
  twitter.collect-raw.v1 \
  --config configs/twitter.collect.example.yaml \
  --input configs/twitter-target.example.json

# Then inspect var/reports/twitter/<handle>/<period>/raw.jsonl. If the raw
# quality is acceptable, clean pending raw records through local LM Studio.
PYTHONPATH=src conda run -n kwai safari-rpa run \
  twitter.clean-prompts.v1 \
  --config configs/twitter.clean.example.yaml \
  --input configs/twitter-target.example.json

# Convenience wrappers call the same workflow layer:
PYTHONPATH=src conda run -n kwai safari-rpa twitter collect
PYTHONPATH=src conda run -n kwai safari-rpa twitter clean

# Electron or another local client can use the versioned API
SAFARI_RPA_API_TOKEN=replace-me PYTHONPATH=src conda run -n kwai safari-rpa serve

# Stable Boss daily report and SQLite-backed rebuild
PYTHONPATH=src conda run -n kwai safari-rpa --home var reports list
PYTHONPATH=src conda run -n kwai safari-rpa --home var \
  reports rebuild --date 2026-06-20

# Install the 06:00 production LaunchAgent and AC-power keep-awake agent.
# Installation does not run Boss immediately.
PYTHONPATH=src conda run -n kwai safari-rpa --home var schedule install
PYTHONPATH=src conda run -n kwai safari-rpa --home var schedule status
```

Every browser transition waits for an observable postcondition. Login, CAPTCHA, risk-control, quota, and uncertain external writes block the run for inspection instead of being bypassed or blindly retried.

Most Safari operations target the owned tab through AppleScript and do not require Safari to remain the topmost application. Browser transitions wait for observable page state instead of relying on sleeps.

Boss is maintained through `configs/boss.production.yaml`. The file contains the shared city, keyword, criteria, ordering, and limit settings plus named `profiles`: `collection` disables communication, `test` allows at most ten newly confirmed communications, and `production` allows the full daily production target. The production LaunchAgent passes `--profile production` explicitly. All Boss profiles cover the same eleven reference cities: 深圳、广州、杭州、上海、成都、武汉、南京、苏州、东莞、佛山、重庆. Their weekday keywords are developer-role queries such as `Python开发工程师`, `AI应用开发工程师`, `C++开发工程师`, `Web前端开发工程师`, `Android开发工程师`, `iOS开发工程师`, and `HarmonyOS开发工程师`. A configurable title allow/deny filter rejects obvious non-development roles before communication. A run starts from a randomly selected city, persists that rotated order for resume, and advances sequentially. Only a same-job transition from an available communication control to a confirmed chat state enters the run CSV and daily ledger. Pre-existing chats, unavailable controls, and ambiguous results do not consume quota; ambiguous external writes block without automatic retry.

Twitter/X extraction is read-only and intentionally two-phase. `twitter.collect-raw.v1` opens the configured profile, discovers target-author original status URLs, enters each detail page slowly, waits for the target tweet article to render instead of a black/skeleton page, and writes stable raw artifacts under `var/reports/twitter/<handle>/<period>/`. Single tweet detail failures are recorded in `raw-failures.jsonl` and do not trigger cleanup; three consecutive `WAIT_TIMEOUT` details stop collection early with `stop_reason=consecutive_detail_timeouts`. `twitter.clean-prompts.v1` never touches Safari; it reads pending raw records for the same target/period, calls PromptLoom, and writes `prompts.jsonl`, `failed.jsonl`, and `summary.json`. The deprecated `twitter.extract-prompts.v1` combined workflow remains for compatibility but is no longer the recommended entry. Start LM Studio locally with a loaded model before running Twitter cleanup. Reusable LLM behavior lives in `promptloom`; Safari RPA workflows only call the injected `context.llm.run_workflow(...)` port.

## Verification

```bash
PYTHONPATH=src conda run -n kwai python -m unittest discover -s tests -v

# Explicit, read-only integration checks
MACRPA_TEST_LOOPBACK=1 PYTHONPATH=src conda run -n kwai python \
  -m unittest tests.integration.test_loopback_api -v
MACRPA_TEST_SAFARI=1 PYTHONPATH=src conda run -n kwai python \
  -m unittest tests.integration.test_safari_live -v

# Authenticated live-site contracts. This reads one Boss result page and,
# when MACRPA_TWITTER_HANDLE is set, collects visible Twitter/X tweet text.
MACRPA_TEST_TWITTER_LIVE=1 MACRPA_TWITTER_HANDLE=example PYTHONPATH=src \
  conda run -n kwai python -m unittest tests.integration.test_sites_live -v
```

Safari must be logged in and allowed to receive Apple Events and webpage JavaScript. CAPTCHA, login, and risk-control pages are reported as blocked states for manual handling; Safari RPA Runtime does not bypass them. The real Boss `test` profile is intentionally separate from the read-only integration suite because it creates up to ten external communications.

The default suite skips tests requiring a loopback socket, Apple Events permission, or explicit authenticated live-site opt-in.

## Plans

Read [docs/plans/README.md](docs/plans/README.md) and the current plan before changing architecture or workflow behavior.
Also read [docs/architecture/README.md](docs/architecture/README.md) and [docs/architecture/design-principles.md](docs/architecture/design-principles.md) before adding modules or changing dependency direction.
