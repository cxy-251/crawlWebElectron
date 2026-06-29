from __future__ import annotations

from safari_rpa.cli.output import success
from safari_rpa.transport import run_http_server


async def handle_serve(arguments, application) -> int:
    return await run_http_server(
        application,
        arguments.host,
        arguments.port,
        on_started=lambda url: success({"listening": url}),
    )
