"""Stable cross-layer contracts."""

from macrpa.contracts.errors import ErrorKind, RpaError
from macrpa.contracts.llm import LocalLlmPort
from macrpa.contracts.safari import (
    ActionEvidence,
    ConditionKind,
    ElementState,
    Locator,
    LocatorKind,
    PageCondition,
    PageRef,
    PageState,
    SafariAutomationPort,
    SafariTabInfo,
    SafariWindowInfo,
)
from macrpa.contracts.runtime import (
    ArtifactRecord,
    CompletedSideEffectRecord,
    EventRecord,
    RetryPolicy,
    RunRecord,
    RunStatus,
    StepRecord,
    StepStatus,
    Workflow,
    WorkflowContextPort,
    WorkflowDescriptor,
)

__all__ = [
    "ActionEvidence",
    "ArtifactRecord",
    "CompletedSideEffectRecord",
    "ConditionKind",
    "ElementState",
    "EventRecord",
    "ErrorKind",
    "LocalLlmPort",
    "Locator",
    "LocatorKind",
    "PageCondition",
    "PageRef",
    "PageState",
    "RpaError",
    "RetryPolicy",
    "RunRecord",
    "RunStatus",
    "SafariAutomationPort",
    "SafariTabInfo",
    "SafariWindowInfo",
    "StepRecord",
    "StepStatus",
    "Workflow",
    "WorkflowContextPort",
    "WorkflowDescriptor",
]
