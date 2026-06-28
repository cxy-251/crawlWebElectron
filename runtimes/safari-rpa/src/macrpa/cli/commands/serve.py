from __future__ import annotations

from macrpa.cli.output import success
from macrpa.transport import run_http_server


async def handle_serve(arguments, application) -> int:
    return await run_http_server(
        application,
        arguments.host,
        arguments.port,
        on_started=lambda url: success({"listening": url}),
    )
