from __future__ import annotations

from macrpa.cli.output import success
from macrpa.contracts.errors import RpaError


async def handle_cancel(arguments, application) -> int:
    cancelled = await application.cancel(arguments.run_id)
    if not cancelled:
        raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {arguments.run_id}")
    success({"cancel_requested": True})
    return 0
