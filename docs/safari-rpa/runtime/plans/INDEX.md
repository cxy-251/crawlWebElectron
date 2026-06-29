# Safari RPA Runtime plans

This directory is the durable record of accepted implementation plans.

## Current plan

- [0011-site-workspace-and-risk-signals.md](0011-site-workspace-and-risk-signals.md) — implemented and verified; site workspace isolation and Boss risk signal hardening

## Prior plans

- [0010-browser-extension-architecture.md](0010-browser-extension-architecture.md) — accepted; browser workflow platform consolidation pending; supplemented by 0011
- [0001-foundation.md](0001-foundation.md) — implemented foundation; supplemented by 0002 for live-site contracts
- [0002-live-site-hardening.md](0002-live-site-hardening.md) — implemented live-site contracts; supplemented by 0003
- [0003-tools-and-boss-quotas.md](0003-tools-and-boss-quotas.md) — implemented and live-site verified; supplemented by 0004
- [0004-reliability-reports-and-scheduling.md](0004-reliability-reports-and-scheduling.md) — implemented and verified; supplemented by 0005
- [0005-chatgpt-download-cli-hardening.md](0005-chatgpt-download-cli-hardening.md) — paused; ChatGPT browser work moved out by 0006
- [0006-twitter-llm-workflow-boundary.md](0006-twitter-llm-workflow-boundary.md) — implemented and verified; supplemented by 0007
- [0007-llm-extraction-architecture-guardrails.md](0007-llm-extraction-architecture-guardrails.md) — implemented and verified; package naming and LLM workflow boundary superseded by 0008
- [0008-promptloom-twitter-periods.md](0008-promptloom-twitter-periods.md) — implemented and verified; split into two-phase Twitter workflows by 0009
- [0009-twitter-two-phase-collection-cleaning.md](0009-twitter-two-phase-collection-cleaning.md) — implemented and verified; supplemented by 0010

## Process

1. Read this index and the current plan before changing architecture or workflow behavior.
2. Keep accepted plans. Material scope or architecture changes require a new numbered plan.
3. A new plan must name the plan it supplements or supersedes and explain why.
4. Update this index when a plan is accepted, superseded, paused, or implemented.
5. Record implementation differences and verification results in the active plan.
