# Browser Workflow Forge

Browser Workflow Forge is a local browser workflow workbench. It keeps ordinary browser automation in Electron and routes high-risk workflows through a real Safari runtime.

## Runtime Boundaries

- Electron workflows use `WebContents`, DOM execution, CDP, and local APIs.
- Electron Kuaishou workflow code lives in `src/main/domains/kuaishou/`, with shared contracts in `src/shared/kuaishou/` and UI in `src/renderer/tools/kuaishou/`.
- Safari RPA workflows live in `src/safari-rpa/safari_rpa/` and use a real Safari profile.
- Safari Web Extension work lives in `src/safari-extension-boss/` as a future bridge prototype.
- Local editable workflow configs live under `local-api-usage/`.

Safari RPA opens and reuses site-specific Safari RPA workspace windows instead of taking over arbitrary user Safari windows. Boss and Twitter runs should stay in their own marked Safari windows, leaving normal Safari windows for manual browsing.

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

TypeScript uses separate compiler targets because Electron main/preload run as CommonJS while the renderer is Vite/React/ESM. The TypeScript config files live in `config/tsconfig/`; Vite, Tailwind, and PostCSS config live in `config/tooling/`.

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

Local helper scripts and workflow configs live in `local-api-usage/`. Keep personal paths, generated task JSON, state files, runtime `var/`, and tokens there. Safari RPA configs are grouped by site under `local-api-usage/safari-rpa/configs/boss/` and `local-api-usage/safari-rpa/configs/twitter/`.

Edit `local-api-usage/kuaishou/constants.mjs`, then start Electron:

```bash
pnpm run dev
```

Generate and run a Kuaishou batch:

```bash
node local-api-usage/kuaishou/generate-kuaishou-tasks.mjs
node local-api-usage/kuaishou/batch-publish-kuaishou.mjs
```

The batch script calls `/api/kuaishou/upload-single`, runs tasks one by one, and only auto-publishes tasks whose JSON item has `confirmPublish: true`.

## Safari RPA

Install or refresh the local command:

```bash
uv run python -m pip install -e src/safari-rpa --no-deps
uv run safari-rpa --help
```

Start the loopback API only when Boss or Twitter workflows need Safari runtime state:

```bash
SAFARI_RPA_API_TOKEN=replace-me PYTHONPATH=src/safari-rpa uv run \
  safari-rpa --home local-api-usage/safari-rpa/var serve --host 127.0.0.1 --port 3211
```

Boss uses one maintained config file, `local-api-usage/safari-rpa/configs/boss/production.yaml`. Select behavior with `--profile`:

```txt
test        real Boss communication, capped at 10 new confirmed communications
production  full production profile, capped by daily and per-city limits
```

Boss first rejects structured search-card failures and obvious non-development
roles, then uses the authenticated search page's read-only `job/card.json`
response to evaluate the configured JD keywords, direction score, and recruiter
activity. Direction titles are hints rather than a pre-JD hard gate. It opens
the reusable visible detail tab only after that background check passes,
revalidates the visible job, and keeps the exact `立即沟通` control as its only
intentional Boss write. A failed background read falls back to one visible
detail read and is reported separately. Search/detail page pairs are also
recycled by search-read and confirmed-communication batch limits so long
infinite-scroll sessions remain bounded.

Validate the workflow before installing any schedule:

```bash
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var doctor
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var workflows

PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var status --limit 10
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var reports list --limit 10
```

Use `test` deliberately when the real Boss account should send up to ten communications:

```bash
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var run \
  boss.search-and-communicate.v1 --config local-api-usage/safari-rpa/configs/boss/production.yaml --profile test
```

Do not manually run `production` unless an immediate production write is intended.

### Boss Schedule

Install the daily production LaunchAgent only after validation:

```bash
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var schedule install \
  --id boss-production-daily \
  --config local-api-usage/safari-rpa/configs/boss/production.yaml \
  --profile production \
  --at 06:00 \
  --timezone Asia/Shanghai
```

Inspect schedule state:

```bash
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var schedule status
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var schedule status boss-production-daily
```

Modify the schedule by running `schedule install` again with the same `--id` and a new value:

```bash
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var schedule install \
  --id boss-production-daily \
  --config local-api-usage/safari-rpa/configs/boss/production.yaml \
  --profile production \
  --at 07:30 \
  --timezone Asia/Shanghai
```

Cancel the schedule:

```bash
PYTHONPATH=src/safari-rpa uv run safari-rpa --home local-api-usage/safari-rpa/var schedule uninstall boss-production-daily
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
KuaishouLocalApiRoutes         src/main/domains/kuaishou/api
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

Do not commit runtime state, credentials, cookies, logs, SQLite files, generated task JSON, screenshots, downloads, or personal absolute paths. `local-api-usage/` tracks script templates and editable workflow configs, but ignores runtime state.

## Plans

See `docs/project/PROJPLAN.md` and `docs/plans/0010-browser-workflow-platform.md` for the current fusion plan.
