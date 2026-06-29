from __future__ import annotations

import asyncio
from typing import Any

from safari_rpa.contracts.errors import ErrorKind, RpaError
from safari_rpa.contracts.llm import LocalLlmPort
from safari_rpa.contracts.runtime import JsonObject, RunRecord, RunStatus, StepStatus
from safari_rpa.contracts.safari import SafariAutomationPort
from safari_rpa.locking import AsyncFileLock
from safari_rpa.runtime.artifacts import ArtifactFiles
from safari_rpa.runtime.context import WorkflowContext
from safari_rpa.runtime.registry import WorkflowRegistry
from safari_rpa.runtime.store import RunStore


class WorkflowRunner:
    def __init__(
        self,
        store: RunStore,
        registry: WorkflowRegistry,
        safari: SafariAutomationPort,
        artifacts: ArtifactFiles,
        llm: LocalLlmPort | None = None,
    ) -> None:
        self.store = store
        self.registry = registry
        self.safari = safari
        self.artifacts = artifacts
        self.llm = llm or UnavailableLocalLlm()
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def create_run(self, workflow_id: str, config: JsonObject, input_data: JsonObject) -> RunRecord:
        workflow = self.registry.get(workflow_id)
        if workflow is None:
            descriptor = next(
                (item for item in self.registry.descriptors() if item.id == workflow_id), None
            )
            if descriptor is not None and not descriptor.available:
                raise RpaError("WORKFLOW_NOT_AVAILABLE", f"Workflow is reserved but unavailable: {workflow_id}")
            raise RpaError("WORKFLOW_NOT_FOUND", f"Unknown workflow: {workflow_id}")
        return await self.store.create_run(workflow_id, config, input_data)

    def start_background(self, run_id: str) -> None:
        current = self._tasks.get(run_id)
        if current and not current.done():
            return
        task = asyncio.create_task(self.execute(run_id), name=f"safari_rpa-run-{run_id}")
        self._tasks[run_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run_id, None))

    async def execute(self, run_id: str) -> None:
        run = await self.store.get_run(run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {run_id}")
        lock_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in run.workflow_id)
        workflow_lock = AsyncFileLock(self.artifacts.root / "locks" / f"workflow-{lock_name}.lock", timeout=0)
        try:
            async with workflow_lock:
                await self._execute_locked(run_id)
        except TimeoutError:
            await self.store.set_run_status(
                run_id, RunStatus.FAILED,
                error={"code": "WORKFLOW_ALREADY_RUNNING", "message": run.workflow_id},
            )

    async def _execute_locked(self, run_id: str) -> None:
        run = await self.store.get_run(run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {run_id}")
        workflow = self.registry.get(run.workflow_id)
        if workflow is None:
            await self.store.set_run_status(
                run_id,
                RunStatus.FAILED,
                error={"code": "WORKFLOW_NOT_FOUND", "message": run.workflow_id},
            )
            return
        await self._recover_interrupted_steps(run_id)
        await self.store.set_run_status(run_id, RunStatus.RUNNING)
        context = WorkflowContext(
            run_id=run.id,
            config=run.config,
            input_data=run.input,
            safari=self.safari,
            llm=self.llm,
            store=self.store,
            artifacts=self.artifacts,
        )
        try:
            output = await workflow.execute(context)
            await context.check_cancelled()
            await self.store.set_run_status(run_id, RunStatus.SUCCEEDED, output=output)
        except asyncio.CancelledError:
            await self.store.set_run_status(
                run_id,
                RunStatus.CANCELLED,
                error={"code": "CANCELLED", "message": "Execution task was cancelled"},
            )
            raise
        except RpaError as error:
            await self.store.set_run_status(
                run_id,
                self._run_status_for_error(error),
                error={
                    "code": error.code,
                    "message": error.message,
                    "kind": error.kind,
                    "details": error.details or {},
                },
            )
        except Exception as error:
            await self.store.set_run_status(
                run_id,
                RunStatus.FAILED,
                error={"code": type(error).__name__, "message": str(error)},
            )

    async def resume(self, run_id: str) -> RunRecord:
        run = await self.store.get_run(run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {run_id}")
        if run.status not in (RunStatus.BLOCKED, RunStatus.FAILED, RunStatus.UNKNOWN_SIDE_EFFECT):
            raise RpaError("RUN_NOT_RESUMABLE", f"Run is not resumable from {run.status}")
        self.start_background(run_id)
        return run

    async def cancel(self, run_id: str) -> bool:
        return await self.store.request_cancel(run_id)

    async def shutdown(self) -> None:
        active = tuple(self._tasks.values())
        for task in active:
            task.cancel()
        if active:
            await asyncio.gather(*active, return_exceptions=True)

    async def _recover_interrupted_steps(self, run_id: str) -> None:
        connection = self.store._connection()
        cursor = await connection.execute(
            "SELECT step_key, side_effect FROM steps WHERE run_id = ? AND status = ?",
            (run_id, StepStatus.RUNNING),
        )
        for row in await cursor.fetchall():
            side_effect = bool(row["side_effect"])
            status = StepStatus.UNKNOWN_SIDE_EFFECT if side_effect else StepStatus.FAILED
            error: JsonObject = {
                "code": "INTERRUPTED",
                "message": "The process stopped while this step was running",
                "kind": ErrorKind.UNKNOWN_SIDE_EFFECT if side_effect else ErrorKind.RETRYABLE,
            }
            await self.store.fail_step(run_id, str(row["step_key"]), status, error)

    @staticmethod
    def _run_status_for_error(error: RpaError) -> RunStatus:
        if error.kind in (ErrorKind.BLOCKED_AUTH, ErrorKind.BLOCKED_RISK):
            return RunStatus.BLOCKED
        if error.kind == ErrorKind.UNKNOWN_SIDE_EFFECT:
            return RunStatus.UNKNOWN_SIDE_EFFECT
        if error.kind == ErrorKind.CANCELLED:
            return RunStatus.CANCELLED
        return RunStatus.FAILED


class UnavailableLocalLlm:
    async def run_workflow(
        self,
        workflow_id: str,
        input_data: JsonObject,
        runtime_options: JsonObject | None = None,
    ) -> JsonObject:
        raise RpaError("LLM_UNAVAILABLE", "No local LLM service is configured", ErrorKind.PERMANENT)
