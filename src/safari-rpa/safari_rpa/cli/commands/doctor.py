from __future__ import annotations

from safari_rpa.cli.output import raw


async def handle_doctor(arguments, application) -> int:
    result = await application.doctor()
    raw(result)
    return 0 if result["ok"] else 1
