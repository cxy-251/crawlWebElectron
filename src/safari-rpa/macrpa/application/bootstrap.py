from __future__ import annotations

from pathlib import Path

from macrpa.application.service import RpaApplication, default_home
from macrpa.runtime import WorkflowRegistry
from macrpa.workflows import BossWorkflow, TwitterCleanPromptsWorkflow, TwitterCollectRawWorkflow, TwitterPromptWorkflow


def build_registry() -> WorkflowRegistry:
    registry = WorkflowRegistry()
    registry.register(BossWorkflow())
    registry.register(TwitterCollectRawWorkflow())
    registry.register(TwitterCleanPromptsWorkflow())
    registry.register(TwitterPromptWorkflow())
    return registry


def build_application(home: str | Path | None = None) -> RpaApplication:
    return RpaApplication(home or default_home(), build_registry())
