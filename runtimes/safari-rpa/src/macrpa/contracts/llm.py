from __future__ import annotations

from typing import Any, Protocol

JsonObject = dict[str, Any]


class LocalLlmPort(Protocol):
    async def run_workflow(
        self,
        workflow_id: str,
        input_data: JsonObject,
        runtime_options: JsonObject | None = None,
    ) -> JsonObject: ...
