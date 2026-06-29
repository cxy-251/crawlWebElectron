from __future__ import annotations

from argparse import Namespace
from collections.abc import Awaitable, Callable
from typing import Any

from safari_rpa.cli.commands.artifacts import handle_artifacts
from safari_rpa.cli.commands.cancel import handle_cancel
from safari_rpa.cli.commands.doctor import handle_doctor
from safari_rpa.cli.commands.reports import handle_reports
from safari_rpa.cli.commands.resume import handle_resume
from safari_rpa.cli.commands.run import handle_run
from safari_rpa.cli.commands.schedule import handle_schedule
from safari_rpa.cli.commands.scheduled_run import handle_scheduled_run
from safari_rpa.cli.commands.serve import handle_serve
from safari_rpa.cli.commands.status import handle_status
from safari_rpa.cli.commands.twitter import handle_twitter
from safari_rpa.cli.commands.workflows import handle_workflows

CommandHandler = Callable[[Namespace, Any], Awaitable[int]]

COMMAND_HANDLERS: dict[str, CommandHandler] = {
    "doctor": handle_doctor,
    "workflows": handle_workflows,
    "run": handle_run,
    "twitter": handle_twitter,
    "status": handle_status,
    "resume": handle_resume,
    "cancel": handle_cancel,
    "artifacts": handle_artifacts,
    "reports": handle_reports,
    "schedule": handle_schedule,
    "scheduled-run": handle_scheduled_run,
    "serve": handle_serve,
}
