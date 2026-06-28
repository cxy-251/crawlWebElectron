from __future__ import annotations

from typing import Any

from macrpa.application import jsonable
from macrpa.cli.output import success
from macrpa.contracts.errors import RpaError


async def handle_reports(arguments, application) -> int:
    handlers = {
        "list": list_reports,
        "show": show_report,
        "rebuild": rebuild_report,
    }
    return await handlers[arguments.reports_command](arguments, application)


async def list_reports(arguments, application) -> int:
    success(await application.list_reports(arguments.limit))
    return 0


async def show_report(arguments, application) -> int:
    report = await application.get_report(arguments.report_id)
    if report is None:
        raise RpaError("REPORT_NOT_FOUND", f"Report does not exist: {arguments.report_id}")
    data: Any = report
    if arguments.content:
        data = {"report": jsonable(report), "content": await application.report_content(report.id)}
    success(data)
    return 0


async def rebuild_report(arguments, application) -> int:
    success(await application.rebuild_boss_report(arguments.date))
    return 0
