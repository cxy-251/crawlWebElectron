# Browser Workflow Forge Local API Usage

This folder is ignored by git. Keep personal paths, API tokens, generated task JSON, and local run state here.

`Browser Workflow Forge` has two runtime paths:

- Kuaishou and ordinary browser workflows run in Electron.
- Boss Zhipin and Twitter/X high-risk workflows run through `runtimes/safari-rpa` with real Safari.

## 1. Edit local constants

Open `local-api-usage/constants.mjs` and set:

- `SONGS_OUT_DIR`: folder that contains the `.mp4` files.
- `SONGS_META_DIR`: folder that contains each video's `render-input.json`.
- `COLLECTION_NAME`: the Kuaishou collection to select.
- `SCHEDULE_START_AT`: first task publish time, using `YYYY-MM-DD HH:mm`.
- `DAILY_SLOTS`: allowed publish times each day, for example `["08:01", "18:01", "21:01"]`.
- `API_TOKEN`: keep empty unless the app was started with `CWE_API_TOKEN`.

`SCHEDULE_START_AT` must use one of the `DAILY_SLOTS` times. For example, if:

```js
export const DAILY_SLOTS = ["08:01", "18:01", "21:01"];
export const SCHEDULE_START_AT = "2026-06-15 18:01";
```

The first four task times will be:

```txt
2026-06-15 18:01
2026-06-15 21:01
2026-06-16 08:01
2026-06-16 18:01
```

## 2. Start the app

```bash
pnpm run dev
```

Keep Electron open and log in to Kuaishou in the left browser area if needed.

The Electron local API defaults to:

```txt
http://127.0.0.1:3218
```

Useful read-only checks:

```bash
curl -s http://127.0.0.1:3218/api/health
curl -s http://127.0.0.1:3218/api/workflows
curl -s http://127.0.0.1:3218/api/workflows/boss.search-and-communicate.v1/service-check
curl -s http://127.0.0.1:3218/api/workflows/boss.search-and-communicate.v1/runtime-snapshot
curl -s http://127.0.0.1:3218/api/kuaishou/diagnostics/dom
```

`/api/kuaishou/diagnostics/dom` is read-only. It detects the current page and tests every selector in the active Kuaishou element profile so DOM drift can be inspected before running upload actions.

When the Safari RPA service is running, `runtime-snapshot` returns the remote Safari RPA workflow list plus recent runs, reports, and schedules for the selected workflow. Run details are read-only:

```bash
curl -s http://127.0.0.1:3218/api/workflows/boss.search-and-communicate.v1/runs/RUN_ID
```

## 3. Install or refresh Safari RPA command

Run this after pulling or renaming the Safari RPA runtime so the `kwai` environment has the new `safari-rpa` command:

```bash
cd runtimes/safari-rpa
conda run -n kwai python -m pip install -e . --no-deps
```

This installs this local runtime in editable mode. `--no-deps` avoids installing the project's runtime dependencies.

Verify:

```bash
conda run -n kwai safari-rpa --help
```

Start the Safari RPA loopback service when Boss/Twitter workflows need to run:

```bash
cd runtimes/safari-rpa
SAFARI_RPA_API_TOKEN=replace-me PYTHONPATH=src conda run -n kwai \
  safari-rpa --home var serve --host 127.0.0.1 --port 3211
```

Keep the token outside renderer code and local task JSON. Do not run Boss/Twitter live workflows unless you intend to operate the real Safari account.

## 4. Generate the task array

```bash
node local-api-usage/generate-kuaishou-tasks.mjs
```

Then inspect:

```bash
local-api-usage/tasks.kuaishou.json
```

The file is one JSON array. Each item is one video task.

## 5. Run batch publishing

```bash
node local-api-usage/batch-publish-kuaishou.mjs
```

The batch script runs tasks one by one through `/api/kuaishou/upload-single`.

- It never opens a file picker; every task item must contain an absolute `videoPath`.
- It runs every item in `tasks.kuaishou.json`; `tasks.kuaishou.state.json` is only a run record.
- After a published item, it opens the Kuaishou upload page and waits until the next upload surface is detected before running the next item.
- It stops on login required, draft conflict, upload failure, or publish failure.
- It only auto-publishes tasks whose JSON item has `confirmPublish: true`.

If it pauses, fix the left browser page or the task JSON, then run the same batch command again.
