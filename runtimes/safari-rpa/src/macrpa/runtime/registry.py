from __future__ import annotations

from macrpa.contracts.runtime import Workflow, WorkflowDescriptor


class WorkflowRegistry:
    def __init__(self) -> None:
        self._workflows: dict[str, Workflow] = {}
        self._reserved: dict[str, WorkflowDescriptor] = {}

    def register(self, workflow: Workflow) -> None:
        workflow_id = workflow.descriptor.id
        if workflow_id in self._workflows or workflow_id in self._reserved:
            raise ValueError(f"Workflow already registered: {workflow_id}")
        self._workflows[workflow_id] = workflow

    def reserve(self, descriptor: WorkflowDescriptor) -> None:
        if descriptor.available:
            raise ValueError("Reserved workflow descriptors must be unavailable")
        if descriptor.id in self._workflows or descriptor.id in self._reserved:
            raise ValueError(f"Workflow already registered: {descriptor.id}")
        self._reserved[descriptor.id] = descriptor

    def get(self, workflow_id: str) -> Workflow | None:
        return self._workflows.get(workflow_id)

    def descriptors(self) -> tuple[WorkflowDescriptor, ...]:
        values = [workflow.descriptor for workflow in self._workflows.values()]
        values.extend(self._reserved.values())
        return tuple(sorted(values, key=lambda descriptor: descriptor.id))
