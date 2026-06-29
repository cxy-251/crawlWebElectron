from __future__ import annotations

from safari_rpa.contracts.errors import ErrorKind, RpaError
from safari_rpa.contracts.llm import JsonObject
from promptloom import PromptLoomError, PromptLoomErrorKind, WorkflowRuntime


class LocalLlmService:
    def __init__(self, runtime: WorkflowRuntime | None = None) -> None:
        self.runtime = runtime or WorkflowRuntime()

    async def run_workflow(
        self,
        workflow_id: str,
        input_data: JsonObject,
        runtime_options: JsonObject | None = None,
    ) -> JsonObject:
        try:
            return await self.runtime.run_workflow(workflow_id, input_data, runtime_options)
        except PromptLoomError as error:
            raise self._to_rpa_error(error) from error

    @staticmethod
    def _to_rpa_error(error: PromptLoomError) -> RpaError:
        kind = ErrorKind.RETRYABLE if error.kind == PromptLoomErrorKind.RETRYABLE else ErrorKind.PERMANENT
        return RpaError(error.code, error.message, kind, error.details or {})
