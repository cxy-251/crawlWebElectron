from __future__ import annotations

from safari_rpa.cli.output import success
from safari_rpa.contracts.errors import RpaError


async def handle_status(arguments, application) -> int:
    if arguments.run_id:
        run = await application.get_run(arguments.run_id)
        if run is None:
            raise RpaError("RUN_NOT_FOUND", f"Run does not exist: {arguments.run_id}")
        success(run)
        return 0
    success(await application.list_runs(arguments.limit))
    return 0
