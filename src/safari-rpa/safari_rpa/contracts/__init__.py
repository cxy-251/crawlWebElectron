"""Stable cross-layer contracts."""

from safari_rpa.contracts.errors import ErrorKind, RpaError
from safari_rpa.contracts.llm import LocalLlmPort
from safari_rpa.contracts.safari import (
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
from safari_rpa.contracts.runtime import (
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
