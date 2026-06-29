from __future__ import annotations

from safari_rpa.cli.output import success
from safari_rpa.contracts.errors import RpaError


async def handle_cancel(arguments, application) -> int:
    cancelled = await application.cancel(arguments.run_id)
    if not cancelled:
        raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {arguments.run_id}")
    success({"cancel_requested": True})
    return 0
