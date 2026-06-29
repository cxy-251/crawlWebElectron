from __future__ import annotations

from macrpa.cli.output import success
from macrpa.contracts.errors import RpaError


async def handle_artifacts(arguments, application) -> int:
    if await application.get_run(arguments.run_id) is None:
        raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {arguments.run_id}")
    success(await application.store.list_artifacts(arguments.run_id))
    return 0
