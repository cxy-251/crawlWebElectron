# Browser Workflow Runtimes

This directory holds runtime-specific browser automation code that belongs to the same versioned repository as the Electron workbench.

## Layout

- `safari-rpa/` — Python/Safari runtime for high-risk workflows.
- `safari-extension-boss/` — Boss Zhipin Safari Web Extension prototype used as a future bridge reference.

Runtime state, credentials, cookies, logs, downloads, SQLite files, generated outputs, and local task files must not be committed.
