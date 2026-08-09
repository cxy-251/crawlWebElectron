from __future__ import annotations

import json
from typing import Any

from safari_rpa.application import jsonable
from safari_rpa.contracts.runtime import RunRecord, ScheduleRecord


_BOSS_SUMMARY_KEYS = (
    "profile",
    "communicated",
    "run_confirmed",
    "daily_confirmed_total",
    "daily_completed_before_run",
    "run_target",
    "new_target",
    "shortfall",
    "stop_reason",
    "scanned",
    "matched",
    "rejected",
    "detail_opened",
)


def _run_output(value: RunRecord) -> Any:
    if value.output is None:
        return None
    if value.workflow_id != "boss.search-and-communicate.v1" or not isinstance(value.output, dict):
        return value.output
    return {key: value.output[key] for key in _BOSS_SUMMARY_KEYS if key in value.output}


def concise(value: Any) -> Any:
    if isinstance(value, RunRecord):
        data: dict[str, Any] = {
            "id": value.id,
            "workflow_id": value.workflow_id,
            "status": value.status,
            "cancel_requested": value.cancel_requested,
            "created_at": value.created_at,
            "updated_at": value.updated_at,
            "status_command": f"safari-rpa status {value.id}",
            "artifacts_command": f"safari-rpa artifacts {value.id}",
        }
        output = _run_output(value)
        if output is not None:
            data["output"] = output
        if value.error is not None:
            data["error"] = value.error
        return data
    if isinstance(value, ScheduleRecord):
        return {
            "id": value.id,
            "workflow_id": value.workflow_id,
            "daily_at": value.daily_at,
            "timezone": value.timezone,
            "enabled": value.enabled,
            "agent_label": value.agent_label,
            "plist_path": value.plist_path,
            "keep_awake": value.keep_awake,
            "metadata": value.metadata,
        }
    if isinstance(value, dict):
        return {str(key): concise(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [concise(item) for item in value]
    return value


def raw(value: Any) -> None:
    print(json.dumps(jsonable(concise(value)), ensure_ascii=False, indent=2))


def success(data: Any) -> None:
    raw({"ok": True, "data": data})


def result(ok: bool, data: Any) -> None:
    raw({"ok": ok, "data": data})
