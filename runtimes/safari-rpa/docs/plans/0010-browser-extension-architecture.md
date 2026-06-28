# 0010 — Browser workflow platform and Safari extension boundary

## Status

- Accepted: 2026-06-28
- Implementation: pending
- Supplements: 0009

## Source projects

This plan consolidates decisions across three local projects:

1. `runtimes/safari-rpa`
   - Python/Safari RPA runtime for high-risk sites.
   - Owns Safari profile usage, workflow runtime, scheduling, ledgers, artifacts, PromptLoom integration, and postcondition-based browser side effects.
   - Existing usable workflows:
     - `boss.search-and-communicate.v1`
     - `twitter.collect-raw.v1`
     - `twitter.clean-prompts.v1`

2. repository root
   - Final GitHub-backed browser workflow workbench.
   - Electron app with a left real-webpage surface and right workflow/API validation panel.
   - Existing working Kuaishou video upload workflow and local `127.0.0.1` HTTP API.

3. `runtimes/safari-extension-boss`
   - Safari Web Extension prototype.
   - Contains `Shared (Extension)/Resources/manifest.json`, `background.js`, `content.js`, and `SafariWebExtensionHandler.swift`.
   - Treated as a future Safari extension reference only; no extension code is merged in this plan.

## Context

`Safari RPA Runtime` was created for strict anti-bot/high-account-risk websites such as Boss Zhipin and X/Twitter. Its priority is not raw automation speed; its priority is using real Safari browser state with durable workflow records and observable postconditions to reduce uncertain writes and account risk.

`Browser Workflow Forge` is a better product shell for local workflow operation. Its left-browser/right-panel design is useful for manually validating page capabilities and API calls. It can expose local APIs even when the Electron panel is not the main operator surface.

Electron also reads DOM. Its advantage is execution plumbing: Electron owns Chromium `WebContents`, can call `executeJavaScript(...)` directly, can listen to page events, can capture screenshots/DOM snapshots, and can use CDP/debugger features such as `DOM.setFileInputFiles`.

Safari currently reads DOM through AppleScript. Each `SafariDriver.evaluate(...)` call crosses:

```txt
Python -> osascript -> Safari do JavaScript -> string result -> Python JSON parse
```

That makes high-frequency DOM polling slow and hard to diagnose. A Safari extension can reduce that bridge cost, but it does not make DOM semantics accurate by itself. Accuracy still comes from site adapters, multi-signal capability detection, blocking-state detection, and verified postconditions.

## Product direction

`Browser Workflow Forge` becomes the final browser workflow workbench and local API product.

`Safari RPA Runtime` remains the execution owner for high-risk Safari workflows.

The system should be shaped around this rule:

```txt
one website capability = one explicit workflow boundary
```

The right-side panel in `Browser Workflow Forge` should test and operate workflow APIs. It should not own website automation logic directly.

## Workflow engines

### `electron`

Runs inside `Browser Workflow Forge` against embedded Chromium `WebContents`.

Use this for workflows where Electron browser state and direct DOM/CDP automation are acceptable.

Initial built-in workflow:

- `kuaishou.upload-single.v1`

### `safari-rpa`

Delegates to `Safari RPA Runtime`.

Use this for workflows where Safari profile state, Python runtime records, scheduling, ledgers, or lower-risk real-user browser posture matter.

Initial external workflows exposed to the workbench:

- `boss.search-and-communicate.v1`
- `twitter.collect-raw.v1`
- `twitter.clean-prompts.v1`

### Future `safari-extension`

A future accepted plan may use `Boss Safari Workflow Bridge` as a Safari Web Extension prototype.

The intended shape is:

```txt
Safari RPA local service
  <-> Safari extension background script
  <-> content script on target site
```

When that channel exists, AppleScript should be reduced to:

- launching Safari
- activating Safari
- opening or switching target tabs
- basic readiness checks
- extension preference/enablement guidance
- emergency fallback controls

AppleScript should not remain the high-frequency DOM polling channel once a stable extension channel exists.

## Initial workflow registry

| Workflow ID | Engine | Site | Status | Notes |
|---|---|---|---|---|
| `kuaishou.upload-single.v1` | `electron` | Kuaishou | available | Existing Electron upload flow remains in `Browser Workflow Forge`. |
| `boss.search-and-communicate.v1` | `safari-rpa` | Boss Zhipin | external | Existing Safari/Python workflow remains in `Safari RPA Runtime`. |
| `twitter.collect-raw.v1` | `safari-rpa` | X/Twitter | external | Existing Safari raw collection workflow remains in `Safari RPA Runtime`. |
| `twitter.clean-prompts.v1` | `safari-rpa` | X/Twitter | external | Existing PromptLoom cleanup workflow remains in `Safari RPA Runtime`. |

## Decisions

- Keep `Browser Workflow Forge` as the final GitHub-backed workbench project.
- Preserve the current Kuaishou video upload workflow in `Browser Workflow Forge`.
- Remove Electron-local Boss Zhipin automation code and UI from the `Browser Workflow Forge` product surface.
- Do not port Safari RPA Boss/Twitter workflows into Electron DOM scripts.
- Add a workflow registry/service in `Browser Workflow Forge` that exposes built-in Electron workflows and external Safari RPA workflow descriptors.
- Keep the workbench panel as a workflow/API validation surface.
- Keep Safari RPA as the execution owner for Boss/Twitter until a later plan proves a lower-risk Safari extension bridge.
- Treat `Boss Safari Workflow Bridge` only as the Safari extension prototype/reference for a future phase.

## Target shape for `Browser Workflow Forge`

Suggested structure:

```txt
src/main/workflows
  WorkflowDescriptor.ts
  WorkflowRegistry.ts
  electron/KuaishouUploadWorkflow.ts
  external/SafariRpaWorkflowBridge.ts   # future execution bridge

src/main/video-upload/kuaishou
  existing Kuaishou page adapter, detector, binding, upload service

src/main/api
  local HTTP API routes that call workflow services/adapters

src/renderer
  workflow list / workflow testing panels
```

The first implementation should be smaller than the full target:

- create workflow descriptors
- expose workflow list through IPC/local HTTP API
- keep Kuaishou calls working through the existing adapter
- remove old Boss Electron UI/API/IPC surfaces
- leave Safari RPA execution bridge explicit and disabled/not implemented until follow-up work

## Current known state

`Browser Workflow Forge` currently has user changes that must not be reverted without explicit request:

- `package-lock.json` deleted
- `pnpm-lock.yaml` added
- `pnpm-workspace.yaml` added

Existing Kuaishou flow is considered working:

- open Kuaishou upload page
- detect real page capabilities
- upload a new video before editing settings
- handle draft conflict with `DRAFT_CONFLICT`
- write caption, collection, nearby visibility, scheduled publish time
- optionally confirm publish
- expose local API on `127.0.0.1:3218` by default

Existing Safari RPA flows considered usable:

- Boss scheduled/search-and-communicate workflow
- Twitter raw collection workflow
- Twitter prompt cleanup workflow

## Data safety rules

Do not commit:

- `local-api-usage/`
- task JSON/state files/JSONL outputs
- `dist/`
- `node_modules/`
- `.DS_Store`
- screenshots, downloads, run artifacts, cookies, session/profile data
- API tokens or credentials
- personal absolute paths in runtime defaults, examples, API responses, or committed operational config

The source project paths above are intentionally recorded as local reference paths for this plan only.

## Implementation checklist

- [x] Replace the old Plan 0010 browser-extension sketch with this consolidated plan.
- [ ] In `Browser Workflow Forge`, add Plan 0010 or equivalent project-local architecture notes if desired.
- [ ] In `Browser Workflow Forge`, remove Electron-local Boss automation service, IPC handlers, API routes, preload API, renderer page, and home entry.
- [ ] Keep Kuaishou upload UI and local API working.
- [ ] Add workflow registry/service with built-in Kuaishou and external Safari RPA descriptors.
- [ ] Expose workflow descriptors through preload and local HTTP API.
- [ ] Update renderer home/workflow panel to present workflows instead of the old browser automation entry.
- [ ] Keep future `safari-rpa` execution bridge explicit and disabled/not implemented until a follow-up plan.
- [ ] Run `npm run typecheck` in `Browser Workflow Forge`.
- [ ] Run `npm run build` in `Browser Workflow Forge`.

## Non-goals

- Do not add Safari extension code in this step.
- Do not rewrite the working Kuaishou upload flow unless necessary to fit the workflow boundary.
- Do not move Safari RPA execution into Electron DOM automation.
- Do not migrate Boss/Twitter into Electron browser automation.
- Do not perform live Boss communication, Twitter collection, or Kuaishou publishing during routine verification without explicit opt-in.

## Verification record

- Pending.
