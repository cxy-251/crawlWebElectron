from __future__ import annotations

from typing import Protocol

from promptloom.providers.lmstudio import LmStudioClient
from promptloom.types import JsonObject
from promptloom.workflows.prompt_clean import PromptCleanWorkflow


class PromptLoomWorkflow(Protocol):
    id: str

    async def run(self, client: LmStudioClient, input_data: JsonObject) -> JsonObject: ...


class WorkflowRegistry:
    def __init__(self) -> None:
        self._items: dict[str, PromptLoomWorkflow] = {}

    def register(self, workflow: PromptLoomWorkflow) -> None:
        self._items[workflow.id] = workflow

    def get(self, workflow_id: str) -> PromptLoomWorkflow | None:
        return self._items.get(workflow_id)

    def workflow_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._items))


def default_registry() -> WorkflowRegistry:
    registry = WorkflowRegistry()
    registry.register(PromptCleanWorkflow())
    return registry
