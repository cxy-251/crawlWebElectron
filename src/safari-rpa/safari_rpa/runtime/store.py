from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

import aiosqlite

from safari_rpa.contracts.runtime import (
    ArtifactRecord,
    CompletedSideEffectRecord,
    EventRecord,
    JsonObject,
    ReportRecord,
    RunRecord,
    RunStatus,
    ScheduleRecord,
    StepRecord,
    StepStatus,
)

MIGRATION_001 = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    error_json TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    error_json TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(run_id, item_key)
);

CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    side_effect INTEGER NOT NULL DEFAULT 0,
    output_json TEXT,
    error_json TEXT,
    started_at REAL,
    completed_at REAL,
    UNIQUE(run_id, step_key)
);

CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    number INTEGER NOT NULL,
    status TEXT NOT NULL,
    error_json TEXT,
    started_at REAL NOT NULL,
    completed_at REAL
);

CREATE TABLE IF NOT EXISTS events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_run_sequence ON events(run_id, sequence);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_key TEXT,
    type TEXT NOT NULL,
    path TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS side_effects (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence_json TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(run_id, step_key)
);
"""

MIGRATION_002 = """
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    report_date TEXT NOT NULL,
    type TEXT NOT NULL,
    path TEXT NOT NULL,
    record_count INTEGER NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date, workflow_id);

CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    config_path TEXT NOT NULL,
    daily_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    agent_label TEXT NOT NULL,
    plist_path TEXT NOT NULL,
    keep_awake INTEGER NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
"""

MIGRATION_003 = """
CREATE TABLE IF NOT EXISTS period_items (
    workflow_id TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    period_key TEXT NOT NULL,
    item_key TEXT NOT NULL,
    status TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    first_run_id TEXT NOT NULL,
    last_run_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY(workflow_id, scope_key, period_key, item_key)
);
CREATE INDEX IF NOT EXISTS idx_period_items_scope ON period_items(workflow_id, scope_key, period_key, status);
"""


class RunStore:
    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)
        self.connection: aiosqlite.Connection | None = None

    async def open(self) -> RunStore:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = await aiosqlite.connect(self.database_path)
        self.connection.row_factory = aiosqlite.Row
        await self.connection.execute("PRAGMA journal_mode=WAL")
        await self.connection.execute("PRAGMA foreign_keys=ON")
        await self.connection.execute("PRAGMA busy_timeout=10000")
        await self.connection.executescript(MIGRATION_001)
        await self.connection.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)", (time.time(),)
        )
        await self.connection.executescript(MIGRATION_002)
        await self.connection.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)", (time.time(),)
        )
        await self.connection.executescript(MIGRATION_003)
        await self.connection.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(3, ?)", (time.time(),)
        )
        await self.connection.commit()
        return self

    async def close(self) -> None:
        if self.connection is not None:
            await self.connection.close()
            self.connection = None

    async def create_run(
        self, workflow_id: str, config: JsonObject, input_data: JsonObject, run_id: str | None = None
    ) -> RunRecord:
        connection = self._connection()
        now = time.time()
        run_id = run_id or uuid.uuid4().hex
        await connection.execute(
            """INSERT INTO runs(
                   id, workflow_id, status, config_json, input_json, created_at, updated_at
               ) VALUES(?, ?, ?, ?, ?, ?, ?)""",
            (run_id, workflow_id, RunStatus.PENDING, self._dumps(config), self._dumps(input_data), now, now),
        )
        await connection.commit()
        await self.append_event(run_id, "run.created", {"workflow_id": workflow_id})
        record = await self.get_run(run_id)
        assert record is not None
        return record

    async def get_run(self, run_id: str) -> RunRecord | None:
        cursor = await self._connection().execute("SELECT * FROM runs WHERE id = ?", (run_id,))
        row = await cursor.fetchone()
        return self._run_from_row(row) if row else None

    async def list_runs(self, limit: int = 100) -> tuple[RunRecord, ...]:
        cursor = await self._connection().execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        return tuple(self._run_from_row(row) for row in await cursor.fetchall())

    async def set_run_status(
        self,
        run_id: str,
        status: RunStatus,
        *,
        output: JsonObject | None = None,
        error: JsonObject | None = None,
    ) -> None:
        connection = self._connection()
        await connection.execute(
            """UPDATE runs SET status = ?, output_json = ?, error_json = ?, updated_at = ? WHERE id = ?""",
            (status, self._dumps_optional(output), self._dumps_optional(error), time.time(), run_id),
        )
        await connection.commit()
        await self.append_event(
            run_id,
            "run.status",
            {"status": status, "output": output, "error": error},
        )

    async def request_cancel(self, run_id: str) -> bool:
        connection = self._connection()
        cursor = await connection.execute(
            "UPDATE runs SET cancel_requested = 1, updated_at = ? WHERE id = ?", (time.time(), run_id)
        )
        await connection.commit()
        if cursor.rowcount:
            await self.append_event(run_id, "run.cancel_requested", {})
        return bool(cursor.rowcount)

    async def get_step(self, run_id: str, key: str) -> StepRecord | None:
        cursor = await self._connection().execute(
            "SELECT * FROM steps WHERE run_id = ? AND step_key = ?", (run_id, key)
        )
        row = await cursor.fetchone()
        return self._step_from_row(row) if row else None

    async def start_step(self, run_id: str, key: str, side_effect: bool) -> StepRecord:
        connection = self._connection()
        existing = await self.get_step(run_id, key)
        now = time.time()
        if existing is None:
            step_id = uuid.uuid4().hex
            attempts = 1
            await connection.execute(
                """INSERT INTO steps(
                       id, run_id, step_key, status, attempts, side_effect, started_at
                   ) VALUES(?, ?, ?, ?, ?, ?, ?)""",
                (step_id, run_id, key, StepStatus.RUNNING, attempts, int(side_effect), now),
            )
        else:
            step_id = existing.id
            attempts = existing.attempts + 1
            await connection.execute(
                """UPDATE steps SET status = ?, attempts = ?, error_json = NULL,
                   started_at = ?, completed_at = NULL WHERE id = ?""",
                (StepStatus.RUNNING, attempts, now, step_id),
            )
        attempt_id = uuid.uuid4().hex
        await connection.execute(
            """INSERT INTO attempts(id, run_id, step_key, number, status, started_at)
               VALUES(?, ?, ?, ?, ?, ?)""",
            (attempt_id, run_id, key, attempts, StepStatus.RUNNING, now),
        )
        if side_effect:
            await connection.execute(
                """INSERT INTO side_effects(id, run_id, step_key, status, created_at, updated_at)
                   VALUES(?, ?, ?, ?, ?, ?)
                   ON CONFLICT(run_id, step_key) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at""",
                (uuid.uuid4().hex, run_id, key, StepStatus.RUNNING, now, now),
            )
        await connection.commit()
        await self.append_event(run_id, "step.started", {"key": key, "attempt": attempts, "side_effect": side_effect})
        record = await self.get_step(run_id, key)
        assert record is not None
        return record

    async def finish_step(self, run_id: str, key: str, output: Any) -> StepRecord:
        return await self._complete_step(run_id, key, StepStatus.SUCCEEDED, output=output)

    async def fail_step(self, run_id: str, key: str, status: StepStatus, error: JsonObject) -> StepRecord:
        return await self._complete_step(run_id, key, status, error=error)

    async def _complete_step(
        self,
        run_id: str,
        key: str,
        status: StepStatus,
        *,
        output: Any = None,
        error: JsonObject | None = None,
    ) -> StepRecord:
        connection = self._connection()
        now = time.time()
        await connection.execute(
            """UPDATE steps SET status = ?, output_json = ?, error_json = ?, completed_at = ?
               WHERE run_id = ? AND step_key = ?""",
            (status, self._dumps_optional(output), self._dumps_optional(error), now, run_id, key),
        )
        await connection.execute(
            """UPDATE attempts SET status = ?, error_json = ?, completed_at = ?
               WHERE id = (
                   SELECT id FROM attempts WHERE run_id = ? AND step_key = ? ORDER BY number DESC LIMIT 1
               )""",
            (status, self._dumps_optional(error), now, run_id, key),
        )
        await connection.execute(
            """UPDATE side_effects SET status = ?, evidence_json = ?, updated_at = ?
               WHERE run_id = ? AND step_key = ?""",
            (status, self._dumps_optional(output if status == StepStatus.SUCCEEDED else error), now, run_id, key),
        )
        await connection.commit()
        await self.append_event(
            run_id,
            "step.status",
            {"key": key, "status": status, "output": output, "error": error},
        )
        record = await self.get_step(run_id, key)
        assert record is not None
        return record

    async def append_event(self, run_id: str, event_type: str, payload: JsonObject) -> EventRecord:
        connection = self._connection()
        now = time.time()
        cursor = await connection.execute(
            "INSERT INTO events(run_id, type, payload_json, created_at) VALUES(?, ?, ?, ?)",
            (run_id, event_type, self._dumps(payload), now),
        )
        await connection.commit()
        return EventRecord(int(cursor.lastrowid), run_id, event_type, payload, now)

    async def list_events(self, run_id: str, after_sequence: int = 0, limit: int = 1000) -> tuple[EventRecord, ...]:
        cursor = await self._connection().execute(
            """SELECT * FROM events WHERE run_id = ? AND sequence > ?
               ORDER BY sequence ASC LIMIT ?""",
            (run_id, after_sequence, limit),
        )
        return tuple(
            EventRecord(
                int(row["sequence"]),
                str(row["run_id"]),
                str(row["type"]),
                self._loads(row["payload_json"], {}),
                float(row["created_at"]),
            )
            for row in await cursor.fetchall()
        )

    async def add_artifact(
        self,
        run_id: str,
        artifact_type: str,
        path: str,
        metadata: JsonObject | None = None,
        step_key: str | None = None,
    ) -> ArtifactRecord:
        connection = self._connection()
        artifact = ArtifactRecord(
            uuid.uuid4().hex,
            run_id,
            step_key,
            artifact_type,
            path,
            metadata or {},
            time.time(),
        )
        await connection.execute(
            """INSERT INTO artifacts(id, run_id, step_key, type, path, metadata_json, created_at)
               VALUES(?, ?, ?, ?, ?, ?, ?)""",
            (
                artifact.id,
                artifact.run_id,
                artifact.step_key,
                artifact.type,
                artifact.path,
                self._dumps(artifact.metadata),
                artifact.created_at,
            ),
        )
        await connection.commit()
        await self.append_event(run_id, "artifact.added", {"id": artifact.id, "type": artifact.type, "path": path})
        return artifact

    async def list_artifacts(self, run_id: str) -> tuple[ArtifactRecord, ...]:
        cursor = await self._connection().execute(
            "SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at", (run_id,)
        )
        return tuple(
            ArtifactRecord(
                str(row["id"]),
                str(row["run_id"]),
                str(row["step_key"]) if row["step_key"] is not None else None,
                str(row["type"]),
                str(row["path"]),
                self._loads(row["metadata_json"], {}),
                float(row["created_at"]),
            )
            for row in await cursor.fetchall()
        )

    async def find_artifact(self, run_id: str, step_key: str, artifact_type: str) -> ArtifactRecord | None:
        cursor = await self._connection().execute(
            """SELECT * FROM artifacts WHERE run_id = ? AND step_key = ? AND type = ?
               ORDER BY created_at DESC LIMIT 1""",
            (run_id, step_key, artifact_type),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return ArtifactRecord(
            str(row["id"]),
            str(row["run_id"]),
            str(row["step_key"]),
            str(row["type"]),
            str(row["path"]),
            self._loads(row["metadata_json"], {}),
            float(row["created_at"]),
        )

    async def side_effect_completed(self, workflow_id: str, step_key: str) -> bool:
        cursor = await self._connection().execute(
            """SELECT 1 FROM steps
               JOIN runs ON runs.id = steps.run_id
               WHERE runs.workflow_id = ? AND steps.step_key = ?
                 AND steps.side_effect = 1 AND steps.status = ?
               LIMIT 1""",
            (workflow_id, step_key, StepStatus.SUCCEEDED),
        )
        return await cursor.fetchone() is not None

    async def completed_side_effect(
        self, workflow_id: str, step_key: str
    ) -> CompletedSideEffectRecord | None:
        cursor = await self._connection().execute(
            """SELECT runs.workflow_id, steps.run_id, steps.step_key, steps.output_json, steps.completed_at
               FROM steps JOIN runs ON runs.id = steps.run_id
               WHERE runs.workflow_id = ? AND steps.step_key = ?
                 AND steps.side_effect = 1 AND steps.status = ?
               ORDER BY steps.completed_at DESC LIMIT 1""",
            (workflow_id, step_key, StepStatus.SUCCEEDED),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        output = self._loads(row["output_json"], {})
        if not isinstance(output, dict):
            output = {}
        return CompletedSideEffectRecord(
            str(row["workflow_id"]), str(row["run_id"]), str(row["step_key"]), output,
            float(row["completed_at"]),
        )

    async def count_completed_side_effects(self, workflow_id: str, step_prefix: str, since: float) -> int:
        cursor = await self._connection().execute(
            """SELECT COUNT(*) AS total FROM steps
               JOIN runs ON runs.id = steps.run_id
               WHERE runs.workflow_id = ? AND steps.step_key LIKE ?
                 AND steps.side_effect = 1 AND steps.status = ? AND steps.completed_at >= ?""",
            (workflow_id, f"{step_prefix}%", StepStatus.SUCCEEDED, since),
        )
        row = await cursor.fetchone()
        return int(row["total"]) if row else 0

    async def list_completed_side_effects(
        self, workflow_id: str, step_prefix: str, since: float, until: float | None = None
    ) -> tuple[CompletedSideEffectRecord, ...]:
        until_clause = " AND steps.completed_at < ?" if until is not None else ""
        params: tuple[Any, ...] = (
            workflow_id, f"{step_prefix}%", StepStatus.SUCCEEDED, since,
            *((until,) if until is not None else ()),
        )
        cursor = await self._connection().execute(
            """SELECT runs.workflow_id, steps.run_id, steps.step_key, steps.output_json, steps.completed_at
               FROM steps
               JOIN runs ON runs.id = steps.run_id
               WHERE runs.workflow_id = ? AND steps.step_key LIKE ?
                 AND steps.side_effect = 1 AND steps.status = ? AND steps.completed_at >= ?"""
            + until_clause + " ORDER BY steps.completed_at, steps.id",
            params,
        )
        records: list[CompletedSideEffectRecord] = []
        for row in await cursor.fetchall():
            output = self._loads(row["output_json"], {})
            if not isinstance(output, dict):
                continue
            records.append(
                CompletedSideEffectRecord(
                    workflow_id=str(row["workflow_id"]),
                    run_id=str(row["run_id"]),
                    step_key=str(row["step_key"]),
                    output=output,
                    completed_at=float(row["completed_at"]),
                )
            )
        return tuple(records)

    async def upsert_report(
        self, report_id: str, workflow_id: str, report_date: str, report_type: str,
        path: str, record_count: int, metadata: JsonObject | None = None,
    ) -> ReportRecord:
        now = time.time()
        await self._connection().execute(
            """INSERT INTO reports(id, workflow_id, report_date, type, path, record_count,
                   metadata_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET path=excluded.path, record_count=excluded.record_count,
                   metadata_json=excluded.metadata_json, updated_at=excluded.updated_at""",
            (report_id, workflow_id, report_date, report_type, path, record_count,
             self._dumps(metadata or {}), now, now),
        )
        await self._connection().commit()
        record = await self.get_report(report_id)
        assert record is not None
        return record

    async def get_report(self, report_id: str) -> ReportRecord | None:
        cursor = await self._connection().execute("SELECT * FROM reports WHERE id = ?", (report_id,))
        row = await cursor.fetchone()
        return self._report_from_row(row) if row else None

    async def list_reports(self, limit: int = 100) -> tuple[ReportRecord, ...]:
        cursor = await self._connection().execute(
            "SELECT * FROM reports ORDER BY report_date DESC, updated_at DESC LIMIT ?", (limit,)
        )
        return tuple(self._report_from_row(row) for row in await cursor.fetchall())

    async def upsert_schedule(self, value: ScheduleRecord) -> ScheduleRecord:
        now = time.time()
        await self._connection().execute(
            """INSERT INTO schedules(id, workflow_id, config_path, daily_at, timezone, enabled,
                   agent_label, plist_path, keep_awake, metadata_json, created_at, updated_at)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET workflow_id=excluded.workflow_id,
                   config_path=excluded.config_path, daily_at=excluded.daily_at,
                   timezone=excluded.timezone, enabled=excluded.enabled,
                   agent_label=excluded.agent_label, plist_path=excluded.plist_path,
                   keep_awake=excluded.keep_awake, metadata_json=excluded.metadata_json,
                   updated_at=excluded.updated_at""",
            (value.id, value.workflow_id, value.config_path, value.daily_at, value.timezone,
             int(value.enabled), value.agent_label, value.plist_path, int(value.keep_awake),
             self._dumps(value.metadata), value.created_at or now, now),
        )
        await self._connection().commit()
        record = await self.get_schedule(value.id)
        assert record is not None
        return record

    async def get_schedule(self, schedule_id: str) -> ScheduleRecord | None:
        cursor = await self._connection().execute("SELECT * FROM schedules WHERE id = ?", (schedule_id,))
        row = await cursor.fetchone()
        return self._schedule_from_row(row) if row else None

    async def list_schedules(self) -> tuple[ScheduleRecord, ...]:
        cursor = await self._connection().execute("SELECT * FROM schedules ORDER BY id")
        return tuple(self._schedule_from_row(row) for row in await cursor.fetchall())

    async def delete_schedule(self, schedule_id: str) -> bool:
        cursor = await self._connection().execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
        await self._connection().commit()
        return bool(cursor.rowcount)

    async def upsert_period_items(
        self,
        workflow_id: str,
        scope_key: str,
        period_key: str,
        records: list[JsonObject],
        run_id: str,
    ) -> tuple[JsonObject, ...]:
        connection = self._connection()
        now = time.time()
        pending: list[JsonObject] = []
        for record in records:
            item_key = str(record.get("tweet_id") or record.get("id") or "").strip()
            content_hash = str(record.get("content_hash") or "").strip()
            if not item_key or not content_hash:
                continue
            cursor = await connection.execute(
                """SELECT status FROM period_items
                   WHERE workflow_id = ? AND scope_key = ? AND period_key = ? AND item_key = ?""",
                (workflow_id, scope_key, period_key, item_key),
            )
            row = await cursor.fetchone()
            if row is None:
                await connection.execute(
                    """INSERT INTO period_items(
                           workflow_id, scope_key, period_key, item_key, status, content_hash,
                           input_json, first_run_id, last_run_id, created_at, updated_at
                       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        workflow_id,
                        scope_key,
                        period_key,
                        item_key,
                        "pending",
                        content_hash,
                        self._dumps(record),
                        run_id,
                        run_id,
                        now,
                        now,
                    ),
                )
                pending.append(dict(record))
            elif str(row["status"]) == "pending":
                await connection.execute(
                    """UPDATE period_items SET content_hash = ?, input_json = ?,
                           last_run_id = ?, updated_at = ?
                       WHERE workflow_id = ? AND scope_key = ? AND period_key = ? AND item_key = ?""",
                    (
                        content_hash,
                        self._dumps(record),
                        run_id,
                        now,
                        workflow_id,
                        scope_key,
                        period_key,
                        item_key,
                    ),
                )
                pending.append(dict(record))
        await connection.commit()
        return tuple(pending)

    async def complete_period_items(
        self,
        workflow_id: str,
        scope_key: str,
        period_key: str,
        records: list[JsonObject],
        run_id: str,
    ) -> None:
        connection = self._connection()
        now = time.time()
        for record in records:
            item_key = str(record.get("tweet_id") or record.get("id") or "").strip()
            status = str(record.get("status") or "").strip()
            if not item_key or status not in {"cleaned", "dropped", "failed"}:
                continue
            await connection.execute(
                """UPDATE period_items SET status = ?, output_json = ?,
                       last_run_id = ?, updated_at = ?
                   WHERE workflow_id = ? AND scope_key = ? AND period_key = ? AND item_key = ?""",
                (
                    status,
                    self._dumps(record),
                    run_id,
                    now,
                    workflow_id,
                    scope_key,
                    period_key,
                    item_key,
                ),
            )
        await connection.commit()

    async def list_period_items(
        self,
        workflow_id: str,
        scope_key: str,
        period_key: str,
    ) -> tuple[JsonObject, ...]:
        cursor = await self._connection().execute(
            """SELECT * FROM period_items
               WHERE workflow_id = ? AND scope_key = ? AND period_key = ?
               ORDER BY input_json""",
            (workflow_id, scope_key, period_key),
        )
        records: list[JsonObject] = []
        for row in await cursor.fetchall():
            records.append(
                {
                    "workflow_id": str(row["workflow_id"]),
                    "scope_key": str(row["scope_key"]),
                    "period_key": str(row["period_key"]),
                    "item_key": str(row["item_key"]),
                    "status": str(row["status"]),
                    "content_hash": str(row["content_hash"]),
                    "input": self._loads(row["input_json"], {}),
                    "output": self._loads(row["output_json"], None),
                    "first_run_id": str(row["first_run_id"]),
                    "last_run_id": str(row["last_run_id"]),
                    "created_at": float(row["created_at"]),
                    "updated_at": float(row["updated_at"]),
                }
            )
        records.sort(key=lambda item: str(item.get("input", {}).get("created_at") or ""), reverse=True)
        return tuple(records)

    def _connection(self) -> aiosqlite.Connection:
        if self.connection is None:
            raise RuntimeError("RunStore is not open")
        return self.connection

    @classmethod
    def _run_from_row(cls, row: aiosqlite.Row) -> RunRecord:
        return RunRecord(
            id=str(row["id"]),
            workflow_id=str(row["workflow_id"]),
            status=RunStatus(row["status"]),
            config=cls._loads(row["config_json"], {}),
            input=cls._loads(row["input_json"], {}),
            output=cls._loads(row["output_json"], None),
            error=cls._loads(row["error_json"], None),
            cancel_requested=bool(row["cancel_requested"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @classmethod
    def _step_from_row(cls, row: aiosqlite.Row) -> StepRecord:
        return StepRecord(
            id=str(row["id"]),
            run_id=str(row["run_id"]),
            key=str(row["step_key"]),
            status=StepStatus(row["status"]),
            attempts=int(row["attempts"]),
            side_effect=bool(row["side_effect"]),
            output=cls._loads(row["output_json"], None),
            error=cls._loads(row["error_json"], None),
            started_at=float(row["started_at"]) if row["started_at"] is not None else None,
            completed_at=float(row["completed_at"]) if row["completed_at"] is not None else None,
        )

    @classmethod
    def _report_from_row(cls, row: aiosqlite.Row) -> ReportRecord:
        return ReportRecord(
            str(row["id"]), str(row["workflow_id"]), str(row["report_date"]), str(row["type"]),
            str(row["path"]), int(row["record_count"]), cls._loads(row["metadata_json"], {}),
            float(row["created_at"]), float(row["updated_at"]),
        )

    @classmethod
    def _schedule_from_row(cls, row: aiosqlite.Row) -> ScheduleRecord:
        return ScheduleRecord(
            str(row["id"]), str(row["workflow_id"]), str(row["config_path"]),
            str(row["daily_at"]), str(row["timezone"]), bool(row["enabled"]),
            str(row["agent_label"]), str(row["plist_path"]), bool(row["keep_awake"]),
            cls._loads(row["metadata_json"], {}), float(row["created_at"]), float(row["updated_at"]),
        )

    @staticmethod
    def _dumps(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)

    @classmethod
    def _dumps_optional(cls, value: Any) -> str | None:
        return None if value is None else cls._dumps(value)

    @staticmethod
    def _loads(value: str | None, default: Any) -> Any:
        return default if value is None else json.loads(value)
