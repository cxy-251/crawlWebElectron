# SQLite inspection guide

The runtime database is `var/safari-rpa.sqlite`. SQLite is the fact source; `var/reports/boss/YYYY-MM-DD.csv` is a rebuildable view of confirmed Boss communications.

Ordinary read-only inspection is safe while Safari RPA runs because WAL and a 10-second busy timeout are enabled.

```bash
sqlite3 -readonly var/safari-rpa.sqlite
.headers on
.mode box
.tables
.schema reports
```

Common queries:

```sql
SELECT id, workflow_id, status, datetime(created_at, 'unixepoch', 'localtime') AS created
FROM runs ORDER BY created_at DESC LIMIT 20;

SELECT run_id, step_key, status, json_extract(evidence_json, '$.outcome') AS outcome
FROM side_effects ORDER BY updated_at DESC LIMIT 30;

SELECT runs.id, steps.step_key,
       json_extract(steps.output_json, '$.job_id') AS job_id,
       json_extract(steps.output_json, '$.city') AS city,
       datetime(steps.completed_at, 'unixepoch', 'localtime') AS confirmed
FROM steps JOIN runs ON runs.id = steps.run_id
WHERE runs.workflow_id = 'boss.search-and-communicate.v1'
  AND steps.step_key LIKE 'communicate.%'
  AND steps.status = 'succeeded'
  AND json_extract(steps.output_json, '$.confirmed') = 1
  AND coalesce(json_extract(steps.output_json, '$.preexisting'), 0) = 0
ORDER BY steps.completed_at;

SELECT id, report_date, record_count, path FROM reports ORDER BY report_date DESC;
SELECT id, enabled, daily_at, timezone, plist_path FROM schedules;
```

Rebuild a daily CSV from SQLite rather than editing it:

```bash
PYTHONPATH=src/safari-rpa conda run -n kwai safari-rpa --home local-api-usage/safari-rpa/var \
  reports rebuild --date 2026-06-20
```

For a consistent backup while the service is active, use SQLite's backup command; copying only the main file can omit committed WAL pages:

```bash
sqlite3 var/safari-rpa.sqlite ".backup 'safari-rpa-backup.sqlite'"
```

Do not update runtime tables by hand. Use the CLI or API so files, launchd state and audit records remain consistent.
