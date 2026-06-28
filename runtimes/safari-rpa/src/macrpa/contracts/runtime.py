from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from macrpa.contracts.llm import LocalLlmPort
from macrpa.contracts.safari import SafariAutomationPort

JsonObject = dict[str, Any]
StepAction = Callable[[], Awaitable[Any]]
StepReconciler = Callable[[], Awaitable[Any | None]]


class RunStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"
    UNKNOWN_SIDE_EFFECT = "unknown_side_effect"


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"
    UNKNOWN_SIDE_EFFECT = "unknown_side_effect"


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_attempts: int = 3
    initial_delay: float = 0.5
    multiplier: float = 2.0
    maximum_delay: float = 10.0


@dataclass(frozen=True, slots=True)
class RunRecord:
    id: str
    workflow_id: str
    status: RunStatus
    config: JsonObject
    input: JsonObject
    output: JsonObject | None
    error: JsonObject | None
    cancel_requested: bool
    created_at: float
    updated_at: float


@dataclass(frozen=True, slots=True)
class StepRecord:
    id: str
    run_id: str
    key: str
    status: StepStatus
    attempts: int
    side_effect: bool
    output: Any
    error: JsonObject | None
    started_at: float | None
    completed_at: float | None


@dataclass(frozen=True, slots=True)
class EventRecord:
    sequence: int
    run_id: str
    type: str
    payload: JsonObject
    created_at: float


@dataclass(frozen=True, slots=True)
class ArtifactRecord:
    id: str
    run_id: str
    step_key: str | None
    type: str
    path: str
    metadata: JsonObject
    created_at: float


@dataclass(frozen=True, slots=True)
class CompletedSideEffectRecord:
    workflow_id: str
    run_id: str
    step_key: str
    output: JsonObject
    completed_at: float


@dataclass(frozen=True, slots=True)
class ReportRecord:
    id: str
    workflow_id: str
    report_date: str
    type: str
    path: str
    record_count: int
    metadata: JsonObject
    created_at: float
    updated_at: float


@dataclass(frozen=True, slots=True)
class ScheduleRecord:
    id: str
    workflow_id: str
    config_path: str
    daily_at: str
    timezone: str
    enabled: bool
    agent_label: str
    plist_path: str
    keep_awake: bool
    metadata: JsonObject
    created_at: float
    updated_at: float


@dataclass(frozen=True, slots=True)
class WorkflowDescriptor:
    id: str
    version: str
    title: str
    available: bool = True
    capabilities: tuple[str, ...] = field(default_factory=tuple)
    input_schema: JsonObject = field(default_factory=dict)
    config_schema: JsonObject = field(default_factory=dict)


class WorkflowContextPort(Protocol):
    run_id: str
    config: JsonObject
    input: JsonObject
    safari: SafariAutomationPort
    llm: LocalLlmPort

    async def step(
        self,
        key: str,
        action: StepAction,
        *,
        retry: RetryPolicy | None = None,
        side_effect: bool = False,
        reconcile: StepReconciler | None = None,
    ) -> Any: ...

    async def emit(self, event_type: str, payload: JsonObject) -> None: ...

    async def add_artifact(
        self, artifact_type: str, path: str, metadata: JsonObject | None = None, step_key: str | None = None
    ) -> ArtifactRecord: ...

    async def write_text_artifact(
        self,
        name: str,
        content: str,
        artifact_type: str,
        metadata: JsonObject | None = None,
        step_key: str | None = None,
    ) -> ArtifactRecord: ...

    async def capture_directory(self, directory: str) -> dict[str, tuple[int, int]]: ...

    async def collect_new_file(
        self,
        directory: str,
        baseline: dict[str, tuple[int, int]],
        *,
        preferred_name: str,
        artifact_type: str,
        timeout: float,
        allowed_suffixes: tuple[str, ...] = (),
        step_key: str | None = None,
    ) -> ArtifactRecord: ...

    async def side_effect_completed(self, step_key: str) -> bool: ...

    async def completed_side_effect(self, step_key: str) -> CompletedSideEffectRecord | None: ...

    async def count_completed_side_effects(self, step_prefix: str, since: float) -> int: ...

    async def list_completed_side_effects(
        self, step_prefix: str, since: float
    ) -> tuple[CompletedSideEffectRecord, ...]: ...

    async def find_artifact(self, step_key: str, artifact_type: str) -> ArtifactRecord | None: ...

    async def write_daily_report(
        self,
        report_id: str,
        report_date: str,
        content: str,
        *,
        record_count: int,
        metadata: JsonObject | None = None,
    ) -> ReportRecord: ...

    async def write_period_report(
        self,
        category: str,
        scope_key: str,
        period_key: str,
        name: str,
        content: str,
        artifact_type: str,
        metadata: JsonObject | None = None,
    ) -> ArtifactRecord: ...

    async def upsert_period_items(
        self,
        scope_key: str,
        period_key: str,
        records: list[JsonObject],
        *,
        workflow_id: str | None = None,
    ) -> tuple[JsonObject, ...]: ...

    async def complete_period_items(
        self,
        scope_key: str,
        period_key: str,
        records: list[JsonObject],
        *,
        workflow_id: str | None = None,
    ) -> None: ...

    async def list_period_items(
        self,
        scope_key: str,
        period_key: str,
        *,
        workflow_id: str | None = None,
    ) -> tuple[JsonObject, ...]: ...

    async def check_cancelled(self) -> None: ...


class Workflow(Protocol):
    descriptor: WorkflowDescriptor

    async def execute(self, context: WorkflowContextPort) -> JsonObject: ...
