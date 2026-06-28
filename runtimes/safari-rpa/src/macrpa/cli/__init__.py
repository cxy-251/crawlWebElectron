from __future__ import annotations

import asyncio

from macrpa.application import build_application
from macrpa.cli.errors import map_error_to_exit_code, map_error_to_response
from macrpa.cli.output import raw
from macrpa.cli.parser import build_parser
from macrpa.cli.registry import COMMAND_HANDLERS
from macrpa.contracts.errors import RpaError


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        return asyncio.run(_run(arguments))
    except KeyboardInterrupt:
        return 130
    except RpaError as error:
        raw(map_error_to_response(error))
        return map_error_to_exit_code(error)


async def _run(arguments) -> int:
    application = build_application(arguments.home)
    await application.open()
    try:
        handler = COMMAND_HANDLERS.get(arguments.command)
        if handler is None:
            raise RpaError("UNKNOWN_COMMAND", str(arguments.command))
        return await handler(arguments, application)
    finally:
        await application.close()
