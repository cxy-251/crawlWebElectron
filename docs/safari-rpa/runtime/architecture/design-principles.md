# Design principles

These principles apply to new work and material refactors. Historical code should be improved opportunistically without broad churn.

## Ports & Adapters

- Business workflows depend on ports and semantic site operations, not provider classes.
- External details live at the edge: Safari AppleScript, LaunchAgent plists, LM Studio HTTP, and website selectors are adapter concerns.
- Application code assembles concrete adapters. Runtime code executes workflows and records state.

## Google-inspired engineering practice

- Prefer small, reviewable changes with a clear purpose.
- Keep names descriptive and avoid clever abbreviations.
- Make control flow simple; extract helpers when a function starts mixing multiple responsibilities.
- Write comments for why a decision exists, not for obvious mechanics.
- Tests should lock public behavior, dependency boundaries, and risky edge cases.
- Do not add configurability unless there is a real caller or near-term plan.

References:

- [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html)
- [Google Engineering Practices: code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
- [Google Engineering Practices: small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)

## Anti-corruption rules

- No provider HTTP client imports in workflows.
- No Safari RPA imports inside `promptloom`.
- No business workflow prompt templates inside Safari RPA workflows; reusable prompt behavior belongs in PromptLoom workflows.
- No runtime/application imports inside site adapters.
- No browser side effects without observable postconditions.
- No new workflow without updating the active plan and adding boundary tests.
