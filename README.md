# Browser Workflow Forge

Browser Workflow Forge is a local browser workflow workbench. It keeps ordinary browser automation in Electron and routes high-risk workflows through a real Safari runtime.

## Runtime Boundaries

- Electron workflows use `WebContents`, DOM execution, CDP, and local APIs.
- Safari RPA workflows live in `runtimes/safari-rpa/` and use a real Safari profile.
- Safari Web Extension work lives in `runtimes/safari-extension-boss/` as a future bridge prototype.

Current workflow IDs:

```txt
kuaishou.upload-single.v1          electron
boss.search-and-communicate.v1     safari-rpa
twitter.collect-raw.v1             safari-rpa
twitter.clean-prompts.v1           safari-rpa
boss.safari-extension.prototype.v1 safari-extension
```

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm run dev
```

The Electron local API defaults to:

```txt
http://127.0.0.1:3218
```

Useful read-only checks:

```bash
curl -s http://127.0.0.1:3218/api/health
curl -s http://127.0.0.1:3218/api/workflows
curl -s http://127.0.0.1:3218/api/kuaishou/diagnostics/dom
curl -s -X POST http://127.0.0.1:3218/api/kuaishou/diagnostics/evidence
```

## Local API Usage

Local helper scripts live in `local-api-usage/`. The directory is ignored except for script templates, so keep personal paths, generated task JSON, state files, and tokens there.

Edit `local-api-usage/constants.mjs`, then start Electron:

```bash
pnpm run dev
```

Generate and run a Kuaishou batch:

```bash
node local-api-usage/generate-kuaishou-tasks.mjs
node local-api-usage/batch-publish-kuaishou.mjs
```

The batch script calls `/api/kuaishou/upload-single`, runs tasks one by one, and only auto-publishes tasks whose JSON item has `confirmPublish: true`.

## Safari RPA

Install or refresh the local command:

```bash
cd runtimes/safari-rpa
conda run -n kwai python -m pip install -e . --no-deps
conda run -n kwai safari-rpa --help
```

Start the loopback API only when Boss or Twitter workflows need Safari runtime state:

```bash
cd runtimes/safari-rpa
SAFARI_RPA_API_TOKEN=replace-me PYTHONPATH=src conda run -n kwai \
  safari-rpa --home var serve --host 127.0.0.1 --port 3211
```

Boss uses one maintained config file, `configs/boss.production.yaml`. Select behavior with `--profile`:

```txt
collection  read-only scan/export; never communicates
test        real Boss communication, capped at 10 new confirmed communications
production  full production profile, capped by daily and per-city limits
```

Validate the workflow before installing any schedule:

```bash
cd runtimes/safari-rpa
PYTHONPATH=src conda run -n kwai safari-rpa --home var doctor
PYTHONPATH=src conda run -n kwai safari-rpa --home var workflows

# Safe manual validation first.
PYTHONPATH=src conda run -n kwai safari-rpa --home var run \
  boss.search-and-communicate.v1 --config configs/boss.production.yaml --profile collection

PYTHONPATH=src conda run -n kwai safari-rpa --home var status --limit 10
PYTHONPATH=src conda run -n kwai safari-rpa --home var reports list --limit 10
```

Only after the collection run looks correct, use `test` deliberately if the real Boss account should send up to ten communications:

```bash
PYTHONPATH=src conda run -n kwai safari-rpa --home var run \
  boss.search-and-communicate.v1 --config configs/boss.production.yaml --profile test
```

Do not manually run `production` unless an immediate production write is intended.

### Boss Schedule

Install the daily production LaunchAgent only after validation:

```bash
cd runtimes/safari-rpa
PYTHONPATH=src conda run -n kwai safari-rpa --home var schedule install \
  --id boss-production-daily \
  --config configs/boss.production.yaml \
  --profile production \
  --at 06:00 \
  --timezone Asia/Shanghai
```

Inspect schedule state:

```bash
PYTHONPATH=src conda run -n kwai safari-rpa --home var schedule status
PYTHONPATH=src conda run -n kwai safari-rpa --home var schedule status boss-production-daily
```

Modify the schedule by running `schedule install` again with the same `--id` and a new value:

```bash
PYTHONPATH=src conda run -n kwai safari-rpa --home var schedule install \
  --id boss-production-daily \
  --config configs/boss.production.yaml \
  --profile production \
  --at 07:30 \
  --timezone Asia/Shanghai
```

Cancel the schedule:

```bash
PYTHONPATH=src conda run -n kwai safari-rpa --home var schedule uninstall boss-production-daily
```

If old `macRpaForge` LaunchAgents still exist, unload and remove them separately:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.macrpa-forge.boss-production.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.macrpa-forge.keep-awake.plist
rm ~/Library/LaunchAgents/com.macrpa-forge.boss-production.plist
rm ~/Library/LaunchAgents/com.macrpa-forge.keep-awake.plist
```

High-risk write actions remain outside the Electron UI until explicitly added behind a reviewed workflow contract.

## Architecture

Main process boundaries:

```txt
BrowserWorkflowLocalApiServer  local HTTP shell
WorkflowLocalApiRoutes         /api/health and /api/workflows*
KuaishouLocalApiRoutes         /api/kuaishou/*
workflowIpcHandlers            renderer IPC workflow entry
WorkflowRegistry               static workflow descriptors
WorkflowRuntimeService         workflow runtime use-case layer
SafariRpaBridge                Safari RPA loopback adapter
```

Add new HTTP domains as route modules. Add runtime state behavior through `WorkflowRuntimeService`; HTTP and IPC entry points should not call runtime adapters directly.

## DOM Diagnostics

For DOM-driven workflows, prefer real-page diagnosis over isolated selector assumptions. The Kuaishou tool exposes a DOM diagnostics panel that:

- detects current page type and capabilities
- tests every configured selector in the active element profile
- shows matched and missing controls with per-locator attempts
- keeps the workflow read-only while diagnosing page drift
- can save local screenshot and DOM snapshot evidence for later inspection

When a page write fails, the Kuaishou tool also surfaces the structured failure context from the main process: failed field, locator key, page type, current URL, candidates, matched capabilities, and locator attempts.

## Local Data

Do not commit runtime state, credentials, cookies, logs, SQLite files, generated task JSON, screenshots, downloads, or personal absolute paths. `local-api-usage/` is intentionally ignored except for script templates.

## Plans

See `PROJPLAN.md` and `docs/plans/0010-browser-workflow-platform.md` for the current fusion plan.
