from __future__ import annotations

from safari_rpa.cli.output import success
from safari_rpa.contracts.errors import RpaError


async def handle_schedule(arguments, application) -> int:
    handlers = {
        "install": install_schedule,
        "status": schedule_status,
        "uninstall": uninstall_schedule,
    }
    return await handlers[arguments.schedule_command](arguments, application)


async def install_schedule(arguments, application) -> int:
    record = await application.put_schedule(
        arguments.id,
        {
            "config_path": str(arguments.config),
            "profile": arguments.profile,
            "daily_at": arguments.at,
            "timezone": arguments.timezone,
            "keep_awake": not arguments.no_keep_awake,
        },
    )
    success(record)
    return 0


async def schedule_status(arguments, application) -> int:
    if arguments.schedule_id:
        record = await application.get_schedule(arguments.schedule_id)
        if record is None:
            raise RpaError("SCHEDULE_NOT_FOUND", arguments.schedule_id)
        success(record)
        return 0
    success(await application.list_schedules())
    return 0


async def uninstall_schedule(arguments, application) -> int:
    if not await application.delete_schedule(arguments.schedule_id):
        raise RpaError("SCHEDULE_NOT_FOUND", arguments.schedule_id)
    success({"deleted": True})
    return 0
