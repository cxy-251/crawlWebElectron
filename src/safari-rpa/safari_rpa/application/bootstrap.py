from __future__ import annotations

from pathlib import Path

from safari_rpa.application.service import RpaApplication, default_home
from safari_rpa.runtime import WorkflowRegistry
from safari_rpa.workflows import BossWorkflow, TwitterCleanPromptsWorkflow, TwitterCollectRawWorkflow, TwitterPromptWorkflow


def build_registry() -> WorkflowRegistry:
    registry = WorkflowRegistry()
    registry.register(BossWorkflow())
    registry.register(TwitterCollectRawWorkflow())
    registry.register(TwitterCleanPromptsWorkflow())
    registry.register(TwitterPromptWorkflow())
    return registry


def build_application(home: str | Path | None = None) -> RpaApplication:
    return RpaApplication(home or default_home(), build_registry())
