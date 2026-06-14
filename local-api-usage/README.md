# Local Kuaishou API Usage

This folder is ignored by git. Keep personal paths, API tokens, generated task JSON, and local run state here.

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
npm run dev
```

Keep Electron open and log in to Kuaishou in the left browser area if needed.

## 3. Generate the task array

```bash
node local-api-usage/generate-kuaishou-tasks.mjs
```

Then inspect:

```bash
local-api-usage/tasks.kuaishou.json
```

The file is one JSON array. Each item is one video task.

## 4. Run batch publishing

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
