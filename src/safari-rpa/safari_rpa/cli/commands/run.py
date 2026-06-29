from __future__ import annotations

from safari_rpa.cli.io import load_input, load_mapping
from safari_rpa.cli.output import result


async def handle_run(arguments, application) -> int:
    config = load_mapping(arguments.config)
    if arguments.profile:
        config["profile"] = arguments.profile
    input_data = load_input(arguments.input)
    created = await application.create_run(arguments.workflow_id, config, input_data, background=False)
    completed = await application.execute_run(created.id)
    ok = completed.status == "succeeded"
    result(ok, completed)
    return 0 if ok else 1
