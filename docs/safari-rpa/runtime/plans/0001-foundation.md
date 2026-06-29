# 0001 — Safari RPA Runtime foundation

- Status: Implemented
- Accepted: 2026-06-19
- Implemented: 2026-06-20
- Supersedes: none

## Purpose

Build a state-aware Safari RPA service for repetitive browser work. The first release implements Boss Zhipin job discovery/communication and ChatGPT batch generation/download. It reserves a future Kuaishou upload contract and is designed to become a lower-layer runtime for Browser Workflow Forge.

The implementation is new. `AntiGravity/AutoBOSS_Workflows` and `AntiGravity/AutoGPT_Workflows` are behavior references only. Older Safari and Chromium automation attempts are behavior references, not source boundaries.

## Architecture

The dependency direction is strictly downward through public contracts:

1. **Safari capability layer** owns AppleScript, Safari windows/tabs, DOM operations, page identity, and later system file selection.
2. **Reliable runtime layer** owns step state, observable waits, retry classification, queueing, persistence, logs, and artifacts.
3. **Site adapter layer** owns website detection, selectors, page readiness, and action postconditions.
4. **Workflow layer** owns business sequencing and validation rules.
5. **Application layer** exposes one use-case API to the CLI, localhost REST API, SSE stream, and a future Electron client.

Business code must not construct AppleScript. The runtime must not import site adapters or workflows. Electron must not access the RPA database directly.

## State-driven execution

Every browser step has a precondition, action, observable postcondition, timeout, and retry class:

```text
wait for precondition -> perform action -> wait for postcondition -> persist completion -> next step
```

Sleeping is allowed only as a polling or quiet interval. It never proves completion.

The Safari layer first inspects existing windows and tabs. It creates a window only when none exists, reuses a matching target-site tab when possible, and otherwise opens a new tab. It never assumes `window 1/current tab` without re-resolving and verifying the page reference.

Read-only operations may retry with backoff. A write whose outcome is uncertain becomes blocked and is never blindly repeated. Authentication, CAPTCHA, risk-control, and quota pages become recoverable blocked states.

## Runtime and interfaces

- Python runs in the Conda `kwai` environment (Python 3.14.4).
- SQLite stores runs, work items, steps, attempts, events, artifacts, side-effect records, and migrations.
- Runtime artifacts live below `var/runs/<run_id>/` and are ignored by Git.
- Only one active Safari run is permitted in the first release.
- CLI commands: `doctor`, `run`, `status`, `resume`, `cancel`, `artifacts`, and `serve`.
- Versioned REST endpoints live below `/api/v1`; SSE supports reconnection with `Last-Event-ID`.
- The service binds only to loopback and supports a Bearer token from the environment.

## First workflows

### Boss Zhipin

Ensure a `zhipin.com` tab, wait for the search surface, enumerate and deduplicate jobs, read job details, apply configured salary/experience/education/company-size rules, and communicate only when enabled and matched. Persist the full JD, decision evidence, and communication evidence. An uncertain communication result blocks the run.

### ChatGPT

Ensure a `chatgpt.com` tab, enter the configured project, create a new chat, select High, enable Web Search without Deep Research, submit the task prompt, observe generation start, and wait for observable completion. A 180-second quiet interval reduces polling but does not mark the step complete. Validate the last assistant response signature and a real download action. Retry a missing signature/download once in a fresh conversation.

### Kuaishou

Reserve `kuaishou.upload.v1` request/result schemas as unavailable. A future implementation must add missing Safari capabilities first, then its site adapter and state tests, and only then the workflow.

## Git and future merge

This repository uses small verified commits. Runtime output, credentials, local configuration, and personal paths are not committed. In Browser Workflow Forge this runtime lives under `src/safari-rpa/`; Electron talks only to the versioned service API.

## Acceptance criteria

- All operations run through `conda run -n kwai`.
- Unit tests cover observable waits, retries, recovery, deduplication, cancellation, and side-effect uncertainty.
- Safari integration tests cover window/tab discovery and postcondition waits without performing real Boss communication.
- Architecture tests enforce layer boundaries.
- REST, SSE, and CLI return the same public run model.
- Restarting a run does not repeat completed work or uncertain writes.

## Implementation record

- [x] Plan archive and contributor instructions
- [x] Python package scaffold
- [x] State-aware Safari contracts and AppleScript bridge
- [x] Resumable workflow runtime
- [x] REST/SSE and CLI transports
- [x] Boss and ChatGPT workflows
- [x] Test suite and architecture checks
- [x] Final verification record

Live-site selector and interaction corrections are recorded in `0002-live-site-hardening.md`.
