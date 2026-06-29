from __future__ import annotations

import asyncio
import os
import tempfile
import unittest

from aiohttp import web

from safari_rpa.application import build_application
from safari_rpa.transport import create_http_app


@unittest.skipUnless(os.environ.get("MACRPA_TEST_LOOPBACK") == "1", "requires loopback socket permission")
class LoopbackApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_and_bearer_auth(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = build_application(directory)
            await application.open()
            runner = web.AppRunner(create_http_app(application, api_token="secret"), shutdown_timeout=0.1)
            await runner.setup()
            site = web.TCPSite(runner, "127.0.0.1", 0)
            await site.start()
            sockets = site._server.sockets
            port = sockets[0].getsockname()[1]
            try:
                health = await self._request(port, "/api/v1/health")
                self.assertIn("200 OK", health)
                unauthorized = await self._request(port, "/api/v1/capabilities")
                self.assertIn("401 Unauthorized", unauthorized)
                authorized = await self._request(
                    port,
                    "/api/v1/capabilities",
                    authorization="Bearer secret",
                )
                self.assertIn("200 OK", authorized)
            finally:
                await runner.cleanup()
                await application.close()

    async def _request(self, port: int, path: str, authorization: str | None = None) -> str:
        reader, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), 3)
        headers = [f"GET {path} HTTP/1.1", "Host: 127.0.0.1", "Connection: close"]
        if authorization:
            headers.append(f"Authorization: {authorization}")
        writer.write(("\r\n".join(headers) + "\r\n\r\n").encode("ascii"))
        await writer.drain()
        response = await asyncio.wait_for(reader.read(), 3)
        writer.close()
        await writer.wait_closed()
        return response.decode("utf-8", errors="replace")
