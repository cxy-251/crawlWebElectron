from __future__ import annotations

from argparse import Namespace
from collections.abc import Awaitable, Callable
from typing import Any

from macrpa.cli.commands.artifacts import handle_artifacts
from macrpa.cli.commands.cancel import handle_cancel
from macrpa.cli.commands.doctor import handle_doctor
from macrpa.cli.commands.reports import handle_reports
from macrpa.cli.commands.resume import handle_resume
from macrpa.cli.commands.run import handle_run
from macrpa.cli.commands.schedule import handle_schedule
from macrpa.cli.commands.scheduled_run import handle_scheduled_run
from macrpa.cli.commands.serve import handle_serve
from macrpa.cli.commands.status import handle_status
from macrpa.cli.commands.twitter import handle_twitter
from macrpa.cli.commands.workflows import handle_workflows

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
