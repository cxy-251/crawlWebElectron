# Safari RPA Runtime architecture

Safari RPA Runtime uses Ports & Adapters to keep browser control, workflow logic, local model calls, runtime state, and transports separate.

## Layers

| Layer | Role | May depend on |
|---|---|---|
| `contracts` | Stable ports and data contracts | Standard library only, other contract modules |
| `adapters` | External system adapters such as Safari and LaunchAgent | `contracts`, shared utilities |
| `sites` | Website-specific semantic page adapters | `contracts` |
| `promptloom` | Independent local LLM workflow package | Standard library, HTTP client |
| `application` | Use-case orchestration and external adapter assembly | `contracts`, `runtime`, `adapters`, `promptloom` |
| `runtime` | Runs, steps, events, artifacts, retries, workflow execution | `contracts`, runtime utilities |
| `workflows` | Business use cases | `contracts`, `sites` |
| `transport` and `cli` | REST/SSE and CLI translation | `application`, `contracts` |

The dependency direction is inward toward contracts. Workflows should remain boring: compose ports and site operations, write artifacts, and describe business outcomes.

## LLM boundary

`promptloom` is intentionally detachable and named independently from Safari RPA. It must not import `macrpa.*`. Safari RPA calls it through an application service implementing `LocalLlmPort`, and workflows receive that port through `WorkflowContextPort`.

Prompt-oriented behavior belongs inside PromptLoom workflows. Safari RPA workflows pass raw inputs to `context.llm.run_workflow(...)`; they must not define model identities, system prompts, provider clients, or provider HTTP calls.

## Adding a new workflow

1. Add or extend the required low-level capability first.
2. Add a site or provider adapter that exposes semantic operations.
3. Add workflow orchestration against contracts, not concrete adapters.
4. Add architecture boundary tests for any new dependency direction.
5. Update the current plan and architecture docs when the boundary changes.
