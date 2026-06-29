# 0010 — Browser Workflow Platform

- Status: In progress
- Scope: merge Electron workflow automation, Safari RPA, and Safari Extension prototype into one extensible Browser Workflow Forge repository.

## Decision

Browser Workflow Forge keeps one repository and three runtime roles:

- Electron for ordinary browser workflows.
- Safari RPA for high-risk workflows that need a real Safari profile.
- Safari Web Extension prototype for future low-latency Safari DOM bridging.

## Integrated Runtime Layout

```txt
src/safari-rpa/
src/safari-extension-boss/
local-api-usage/safari-rpa/configs/
```

`src/safari-rpa/` owns Boss Zhipin and Twitter/X Safari workflow source. `src/safari-extension-boss/` is a prototype reference, not a production runtime path. Editable Safari RPA configs live under `local-api-usage/safari-rpa/configs/`.

## Workflow Registry

Electron exposes a unified registry:

```txt
GET /api/workflows
GET /api/workflows/:workflowId
GET /api/workflows/:workflowId/service-check
GET /api/workflows/:workflowId/runtime-snapshot
GET /api/workflows/:workflowId/runs/:runId
IPC workflows:list
```

Initial workflow IDs:

```txt
kuaishou.upload-single.v1          electron
boss.search-and-communicate.v1     safari-rpa
twitter.collect-raw.v1             safari-rpa
twitter.clean-prompts.v1           safari-rpa
boss.safari-extension.prototype.v1 safari-extension
```

## Main Process Boundary

```txt
BrowserWorkflowLocalApiServer  local HTTP shell
WorkflowLocalApiRoutes         /api/health and /api/workflows*
KuaishouLocalApiRoutes         /api/kuaishou/*
workflowIpcHandlers            renderer IPC workflow entry
WorkflowRegistry               static workflow descriptors
WorkflowRuntimeService         workflow runtime use-case layer
SafariRpaBridge                Safari RPA loopback adapter
```

HTTP and IPC entry points must not call Safari RPA adapters directly. Extend `WorkflowRuntimeService` first, then reuse it from both entry points.

## Current Safety Boundary

Safari RPA is read-only from Electron today:

- service health
- remote workflow descriptors
- recent runs filtered by workflow
- reports filtered by workflow
- schedules filtered by workflow
- run detail and artifacts

Electron does not expose Safari RPA create, resume, cancel, schedule install, or schedule delete operations yet.

## DOM Diagnostics

DOM-driven workflows are validated through real-page diagnostics rather than isolated selector assumptions. Kuaishou exposes a read-only diagnostic path:

```txt
GET /api/kuaishou/diagnostics/dom
POST /api/kuaishou/diagnostics/evidence
```

The Electron panel and local API report current page detection, active element profile metadata, selector matches, missing selectors, and per-locator attempts. Evidence capture saves a local screenshot and DOM snapshot without clicking or writing the webpage.

Page-action failures should surface structured context in the renderer instead of collapsing to a single message. The Kuaishou tool displays failed field, locator key, page type, current URL, candidate options, matched capabilities, and locator attempts.

## Acceptance

- `npm run typecheck` passes.
- `npm run build` passes.
- `/api/health` and `/api/workflows` work.
- Kuaishou Electron workflow remains available.
- Safari RPA workflows degrade cleanly when the loopback service is not running.
- No runtime state, credentials, cookies, local paths, logs, SQLite files, or generated task payloads are committed.
