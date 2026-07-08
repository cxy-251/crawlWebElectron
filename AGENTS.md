# Contributor instructions

Before making changes:

1. Read `README.md`.
2. Read `docs/plans/INDEX.md` and the current browser-workflow plan.
3. If touching Safari RPA, read `docs/safari-rpa/runtime/plans/INDEX.md`, every current or accepted Safari RPA plan there, `docs/safari-rpa/runtime/architecture/INDEX.md`, and `docs/safari-rpa/runtime/architecture/design-principles.md`.
4. Preserve the dependency direction and public contracts in the active plan.
5. Add a new numbered plan before materially changing architecture or workflow behavior.
6. When adding a module, identify its layer and keep dependencies within that layer's allowed direction.

Use the uv workspace for every Python command:

```bash
uv run --package browser-workflow-safari-rpa python ...
uv run --package browser-workflow-safari-rpa safari-rpa ...
```

Do not commit credentials, local configuration, SQLite files, logs, screenshots, downloads, run artifacts, or personal absolute paths. Treat browser writes as non-idempotent: verify their postconditions and never retry an uncertain write blindly.
