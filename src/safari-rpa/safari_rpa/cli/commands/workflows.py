from __future__ import annotations

from safari_rpa.cli.output import success


async def handle_workflows(arguments, application) -> int:
    success(application.registry.descriptors())
    return 0
