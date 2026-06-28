from __future__ import annotations

from collections.abc import Callable

from promptloom.errors import PromptLoomError, PromptLoomErrorKind
from promptloom.providers.lmstudio import LmStudioClient, LmStudioConfig
from promptloom.types import JsonObject
from promptloom.workflows import WorkflowRegistry, default_registry

ClientFactory = Callable[[LmStudioConfig], LmStudioClient]


class WorkflowRuntime:
    def __init__(
        self,
        registry: WorkflowRegistry | None = None,
        client_factory: ClientFactory | None = None,
    ) -> None:
        self.registry = registry or default_registry()
        self.client_factory = client_factory or LmStudioClient

    async def run_workflow(
        self,
        workflow_id: str,
        input_data: JsonObject,
        runtime_options: JsonObject | None = None,
    ) -> JsonObject:
        workflow = self.registry.get(workflow_id)
        if workflow is None:
            raise PromptLoomError(
                "PROMPTLOOM_WORKFLOW_NOT_FOUND",
                f"Unknown PromptLoom workflow: {workflow_id}",
                PromptLoomErrorKind.PERMANENT,
                {"workflow_id": workflow_id, "available": self.registry.workflow_ids()},
            )
        client = self.client_factory(LmStudioConfig.from_mapping(runtime_options))
        return await workflow.run(client, input_data)
