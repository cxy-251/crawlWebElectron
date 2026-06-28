# Contributor instructions

Before making changes:

1. Read `docs/plans/README.md`.
2. Read every plan marked current or accepted there.
3. Read `docs/architecture/README.md` and `docs/architecture/design-principles.md`.
4. Preserve the dependency direction and public contracts in the active plan.
5. Add a new numbered plan before materially changing architecture or workflow behavior.
6. When adding a module, identify its layer and keep dependencies within that layer's allowed direction.

Use the Conda environment `kwai` for every Python command:

```bash
conda run -n kwai python ...
```

Do not commit credentials, local configuration, SQLite files, logs, screenshots, downloads, run artifacts, or personal absolute paths. Treat browser writes as non-idempotent: verify their postconditions and never retry an uncertain write blindly.
