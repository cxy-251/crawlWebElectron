from __future__ import annotations

from safari_rpa.cli.io import load_input, load_mapping
from safari_rpa.cli.output import result


WORKFLOW_BY_COMMAND = {
    "collect": "twitter.collect-raw.v1",
    "clean": "twitter.clean-prompts.v1",
}


async def handle_twitter(arguments, application) -> int:
    workflow_id = WORKFLOW_BY_COMMAND[str(arguments.twitter_command)]
    config = load_mapping(arguments.config)
    input_data = load_input(arguments.input)
    created = await application.create_run(workflow_id, config, input_data, background=False)
    completed = await application.execute_run(created.id)
    ok = completed.status == "succeeded"
    result(ok, completed)
    return 0 if ok else 1
