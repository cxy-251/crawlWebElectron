from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from safari_rpa.contracts.errors import ErrorKind, RpaError, UnknownSideEffectError
from safari_rpa.contracts.llm import LocalLlmPort
from safari_rpa.contracts.runtime import (
    ArtifactRecord,
    CompletedSideEffectRecord,
    JsonObject,
    RetryPolicy,
    ReportRecord,
    StepAction,
    StepReconciler,
    StepStatus,
)
from safari_rpa.contracts.safari import SafariAutomationPort
from safari_rpa.runtime.artifacts import ArtifactFiles
from safari_rpa.runtime.store import RunStore


class WorkflowContext:
    def __init__(
        self,
        *,
        run_id: str,
        config: JsonObject,
        input_data: JsonObject,
        safari: SafariAutomationPort,
        llm: LocalLlmPort,
        store: RunStore,
        artifacts: ArtifactFiles,
    ) -> None:
        self.run_id = run_id
        self.config = config
        self.input = input_data
        self.safari = safari
        self.llm = llm
        self.store = store
        self.artifacts = artifacts

    async def step(
        self,
        key: str,
        action: StepAction,
        *,
        retry: RetryPolicy | None = None,
        side_effect: bool = False,
        reconcile: StepReconciler | None = None,
    ) -> Any:
        await self.check_cancelled()
        existing = await self.store.get_step(self.run_id, key)
        if existing and existing.status == StepStatus.SUCCEEDED:
            return existing.output
        if existing and existing.status == StepStatus.UNKNOWN_SIDE_EFFECT:
            if reconcile is None:
                raise UnknownSideEffectError(
                    f"Step {key} has an unresolved side effect",
                    {"step": key, "previous_error": existing.error},
                )
            reconciled = await reconcile()
            if reconciled is None:
                raise UnknownSideEffectError(
                    f"Step {key} still cannot be reconciled",
                    {"step": key, "previous_error": existing.error},
                )
            await self.store.finish_step(self.run_id, key, reconciled)
            return reconciled

        policy = retry or RetryPolicy()
        attempt = 0
        delay = policy.initial_delay
        while True:
            await self.check_cancelled()
            attempt += 1
            await self.store.start_step(self.run_id, key, side_effect)
            try:
                output = await action()
                await self.store.finish_step(self.run_id, key, output)
                return output
            except asyncio.CancelledError:
                error = {"code": "CANCELLED", "message": "Task was cancelled", "kind": ErrorKind.CANCELLED}
                await self.store.fail_step(self.run_id, key, StepStatus.CANCELLED, error)
                raise
            except RpaError as error:
                payload = self._error_payload(error)
                uncertain = side_effect and error.kind not in (
                    ErrorKind.BLOCKED_AUTH,
                    ErrorKind.BLOCKED_RISK,
                    ErrorKind.CANCELLED,
                    ErrorKind.UNKNOWN_SIDE_EFFECT,
                )
                status = StepStatus.UNKNOWN_SIDE_EFFECT if uncertain else self._step_status_for_error(error)
                await self.store.fail_step(self.run_id, key, status, payload)
                if uncertain:
                    raise UnknownSideEffectError(
                        f"Side-effect step {key} failed without a confirmed outcome",
                        {"step": key, "cause": payload},
                    ) from error
                may_retry = (
                    error.kind == ErrorKind.RETRYABLE
                    and not side_effect
                    and attempt < max(1, policy.max_attempts)
                )
                if not may_retry:
                    raise
                await self.emit(
                    "step.retry_scheduled",
                    {"key": key, "attempt": attempt, "delay": delay, "error": payload},
                )
                await asyncio.sleep(delay)
                delay = min(policy.maximum_delay, delay * policy.multiplier)
            except Exception as error:
                payload = {"code": type(error).__name__, "message": str(error), "kind": ErrorKind.PERMANENT}
                status = StepStatus.UNKNOWN_SIDE_EFFECT if side_effect else StepStatus.FAILED
                await self.store.fail_step(self.run_id, key, status, payload)
                if side_effect:
                    raise UnknownSideEffectError(
                        f"Side-effect step {key} raised an unexpected error",
                        {"step": key, "cause": payload},
                    ) from error
                raise RpaError(payload["code"], payload["message"], ErrorKind.PERMANENT) from error

    async def emit(self, event_type: str, payload: JsonObject) -> None:
        await self.store.append_event(self.run_id, event_type, payload)

    async def add_artifact(
        self,
        artifact_type: str,
        path: str,
        metadata: JsonObject | None = None,
        step_key: str | None = None,
    ) -> ArtifactRecord:
        resolved = str(Path(path).expanduser().resolve())
        return await self.store.add_artifact(self.run_id, artifact_type, resolved, metadata, step_key)

    async def write_text_artifact(
        self,
        name: str,
        content: str,
        artifact_type: str,
        metadata: JsonObject | None = None,
        step_key: str | None = None,
    ) -> ArtifactRecord:
        path = self.artifacts.write_text(self.run_id, name, content)
        return await self.add_artifact(artifact_type, str(path), metadata, step_key)

    async def capture_directory(self, directory: str) -> dict[str, tuple[int, int]]:
        return self.artifacts.directory_snapshot(directory)

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
    ) -> ArtifactRecord:
        source = await self.artifacts.wait_for_stable_new_file(
            directory,
            baseline,
            timeout=timeout,
            allowed_suffixes=allowed_suffixes,
        )
        destination = self.artifacts.move_into_run(self.run_id, source, preferred_name)
        return await self.add_artifact(
            artifact_type,
            str(destination),
            {"source_name": source.name},
            step_key,
        )

    async def side_effect_completed(self, step_key: str) -> bool:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        return await self.store.side_effect_completed(run.workflow_id, step_key)

    async def completed_side_effect(self, step_key: str) -> CompletedSideEffectRecord | None:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        return await self.store.completed_side_effect(run.workflow_id, step_key)

    async def write_daily_report(
        self, report_id: str, report_date: str, content: str, *, record_count: int,
        metadata: JsonObject | None = None,
    ) -> ReportRecord:
        path = self.artifacts.write_daily_report("boss", report_date, content)
        report = await self.store.upsert_report(
            report_id, "boss.search-and-communicate.v1", report_date,
            "boss_confirmed_daily_csv", str(path.resolve()), record_count, metadata,
        )
        await self.add_artifact(
            "boss_confirmed_daily_csv", report.path,
            {"report_id": report.id, "records": record_count, "date": report_date},
        )
        return report

    async def write_period_report(
        self,
        category: str,
        scope_key: str,
        period_key: str,
        name: str,
        content: str,
        artifact_type: str,
        metadata: JsonObject | None = None,
    ) -> ArtifactRecord:
        path = self.artifacts.write_period_report(category, scope_key, period_key, name, content)
        return await self.add_artifact(
            artifact_type,
            str(path.resolve()),
            {"scope_key": scope_key, "period_key": period_key, **(metadata or {})},
        )

    async def upsert_period_items(
        self,
        scope_key: str,
        period_key: str,
        records: list[JsonObject],
        *,
        workflow_id: str | None = None,
    ) -> tuple[JsonObject, ...]:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        return await self.store.upsert_period_items(
            workflow_id or run.workflow_id, scope_key, period_key, records, self.run_id
        )

    async def complete_period_items(
        self,
        scope_key: str,
        period_key: str,
        records: list[JsonObject],
        *,
        workflow_id: str | None = None,
    ) -> None:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        await self.store.complete_period_items(
            workflow_id or run.workflow_id, scope_key, period_key, records, self.run_id
        )

    async def list_period_items(
        self,
        scope_key: str,
        period_key: str,
        *,
        workflow_id: str | None = None,
    ) -> tuple[JsonObject, ...]:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        return await self.store.list_period_items(workflow_id or run.workflow_id, scope_key, period_key)

    async def count_completed_side_effects(self, step_prefix: str, since: float) -> int:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        return await self.store.count_completed_side_effects(run.workflow_id, step_prefix, since)

    async def list_completed_side_effects(
        self, step_prefix: str, since: float
    ) -> tuple[CompletedSideEffectRecord, ...]:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        return await self.store.list_completed_side_effects(run.workflow_id, step_prefix, since)

    async def find_artifact(self, step_key: str, artifact_type: str) -> ArtifactRecord | None:
        return await self.store.find_artifact(self.run_id, step_key, artifact_type)

    async def check_cancelled(self) -> None:
        run = await self.store.get_run(self.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {self.run_id}")
        if run.cancel_requested:
            raise RpaError("CANCELLED", "Cancellation was requested", ErrorKind.CANCELLED)

    @staticmethod
    def _step_status_for_error(error: RpaError) -> StepStatus:
        if error.kind in (ErrorKind.BLOCKED_AUTH, ErrorKind.BLOCKED_RISK):
            return StepStatus.BLOCKED
        if error.kind == ErrorKind.UNKNOWN_SIDE_EFFECT:
            return StepStatus.UNKNOWN_SIDE_EFFECT
        if error.kind == ErrorKind.CANCELLED:
            return StepStatus.CANCELLED
        return StepStatus.FAILED

    @staticmethod
    def _error_payload(error: RpaError) -> JsonObject:
        return {
            "code": error.code,
            "message": error.message,
            "kind": error.kind,
            "details": error.details or {},
        }
