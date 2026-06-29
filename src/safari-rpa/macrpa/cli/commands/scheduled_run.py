from __future__ import annotations

from macrpa.cli.output import result


async def handle_scheduled_run(arguments, application) -> int:
    completed = await application.run_scheduled_workflow(
        arguments.workflow_id,
        arguments.config,
        profile=arguments.profile,
        ready_until=arguments.ready_until,
        retry_seconds=arguments.retry_seconds,
    )
    ok = completed.status == "succeeded"
    result(ok, completed)
    return 0 if ok else 1
