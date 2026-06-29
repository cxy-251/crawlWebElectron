from __future__ import annotations

from safari_rpa.cli.output import result


async def handle_resume(arguments, application) -> int:
    completed = await application.resume(arguments.run_id, background=False)
    ok = completed.status == "succeeded"
    result(ok, completed)
    return 0 if ok else 1
