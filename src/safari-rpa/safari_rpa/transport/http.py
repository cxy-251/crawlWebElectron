from __future__ import annotations

import asyncio
import os
import signal
from pathlib import Path
from typing import Any

from aiohttp import web

from safari_rpa.application import RpaApplication, jsonable
from safari_rpa.contracts.errors import ErrorKind, RpaError

RPA_KEY = web.AppKey("rpa", RpaApplication)
API_TOKEN_KEY = web.AppKey("api_token", str)


@web.middleware
async def error_middleware(request: web.Request, handler: Any) -> web.StreamResponse:
    try:
        return await handler(request)
    except RpaError as error:
        status = 404 if error.code in {
            "RUN_NOT_FOUND", "WORKFLOW_NOT_FOUND", "REPORT_NOT_FOUND", "REPORT_FILE_MISSING",
            "SCHEDULE_NOT_FOUND",
        } else 409
        if error.kind in (ErrorKind.BLOCKED_AUTH, ErrorKind.BLOCKED_RISK):
            status = 423
        return web.json_response(
            {
                "ok": False,
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "kind": error.kind,
                    "details": error.details or {},
                },
            },
            status=status,
        )
    except web.HTTPException:
        raise
    except Exception as error:
        return web.json_response(
            {"ok": False, "error": {"code": "INTERNAL_ERROR", "message": str(error)}}, status=500
        )


@web.middleware
async def auth_middleware(request: web.Request, handler: Any) -> web.StreamResponse:
    if request.path == "/api/v1/health":
        return await handler(request)
    expected = request.app[API_TOKEN_KEY]
    if expected:
        supplied = request.headers.get("Authorization", "")
        if supplied != f"Bearer {expected}":
            raise web.HTTPUnauthorized(text="Missing or invalid bearer token")
    return await handler(request)


def create_http_app(application: RpaApplication, api_token: str | None = None) -> web.Application:
    app = web.Application(middlewares=[error_middleware, auth_middleware])
    app[RPA_KEY] = application
    app[API_TOKEN_KEY] = api_token if api_token is not None else (
        os.environ.get("SAFARI_RPA_API_TOKEN") or os.environ.get("MACRPA_API_TOKEN", "")
    )
    app.add_routes(
        [
            web.get("/api/v1/health", health),
            web.get("/api/v1/capabilities", capabilities),
            web.get("/api/v1/workflows", workflows),
            web.post("/api/v1/runs", create_run),
            web.get("/api/v1/runs", list_runs),
            web.get("/api/v1/runs/{run_id}", get_run),
            web.post("/api/v1/runs/{run_id}:resume", resume_run),
            web.post("/api/v1/runs/{run_id}:cancel", cancel_run),
            web.get("/api/v1/runs/{run_id}/artifacts", artifacts),
            web.get("/api/v1/runs/{run_id}/events", events),
            web.get("/api/v1/reports", list_reports),
            web.get("/api/v1/reports/{report_id}", get_report),
            web.get("/api/v1/reports/{report_id}/content", report_content),
            web.get("/api/v1/schedules", list_schedules),
            web.get("/api/v1/schedules/{schedule_id}", get_schedule),
            web.put("/api/v1/schedules/{schedule_id}", put_schedule),
            web.delete("/api/v1/schedules/{schedule_id}", delete_schedule),
            web.get("/api/v1/openapi.yaml", openapi),
        ]
    )
    return app


async def run_http_server(
    application: RpaApplication,
    host: str,
    port: int,
    *,
    on_started: Any | None = None,
) -> int:
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise RpaError("UNSAFE_BIND", "Safari RPA only binds to loopback addresses")
    http_app = create_http_app(application)
    runner = web.AppRunner(http_app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    if on_started is not None:
        on_started(f"http://{host}:{port}/api/v1")
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, stopped.set)
        except NotImplementedError:
            pass
    await stopped.wait()
    await runner.cleanup()
    return 0


async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "data": {"service": "safari-rpa", "version": "0.1.0"}})


async def capabilities(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "data": request.app[RPA_KEY].capabilities()})


async def workflows(request: web.Request) -> web.Response:
    descriptors = request.app[RPA_KEY].registry.descriptors()
    return web.json_response({"ok": True, "data": jsonable(descriptors)})


async def create_run(request: web.Request) -> web.Response:
    body = await _json_body(request)
    workflow_id = body.get("workflow_id")
    if not isinstance(workflow_id, str) or not workflow_id:
        raise RpaError("INVALID_REQUEST", "workflow_id is required")
    config = body.get("config", {})
    input_data = body.get("input", {})
    if not isinstance(config, dict) or not isinstance(input_data, dict):
        raise RpaError("INVALID_REQUEST", "config and input must be objects")
    run = await request.app[RPA_KEY].create_run(workflow_id, config, input_data, background=True)
    return web.json_response({"ok": True, "data": jsonable(run)}, status=202)


async def list_runs(request: web.Request) -> web.Response:
    try:
        limit = max(1, min(500, int(request.query.get("limit", "100"))))
    except ValueError as error:
        raise RpaError("INVALID_REQUEST", "limit must be an integer") from error
    values = await request.app[RPA_KEY].list_runs(limit)
    return web.json_response({"ok": True, "data": jsonable(values)})


async def get_run(request: web.Request) -> web.Response:
    run = await request.app[RPA_KEY].get_run(request.match_info["run_id"])
    if run is None:
        raise RpaError("RUN_NOT_FOUND", "Run not found")
    return web.json_response({"ok": True, "data": jsonable(run)})


async def resume_run(request: web.Request) -> web.Response:
    run = await request.app[RPA_KEY].resume(request.match_info["run_id"], background=True)
    return web.json_response({"ok": True, "data": jsonable(run)}, status=202)


async def cancel_run(request: web.Request) -> web.Response:
    cancelled = await request.app[RPA_KEY].cancel(request.match_info["run_id"])
    if not cancelled:
        raise RpaError("RUN_NOT_FOUND", "Run not found")
    return web.json_response({"ok": True, "data": {"cancel_requested": True}}, status=202)


async def artifacts(request: web.Request) -> web.Response:
    run_id = request.match_info["run_id"]
    if await request.app[RPA_KEY].get_run(run_id) is None:
        raise RpaError("RUN_NOT_FOUND", "Run not found")
    values = await request.app[RPA_KEY].store.list_artifacts(run_id)
    return web.json_response({"ok": True, "data": jsonable(values)})


async def list_reports(request: web.Request) -> web.Response:
    try:
        limit = max(1, min(500, int(request.query.get("limit", "100"))))
    except ValueError as error:
        raise RpaError("INVALID_REQUEST", "limit must be an integer") from error
    return web.json_response({"ok": True, "data": jsonable(await request.app[RPA_KEY].list_reports(limit))})


async def get_report(request: web.Request) -> web.Response:
    report = await request.app[RPA_KEY].get_report(request.match_info["report_id"])
    if report is None:
        raise RpaError("REPORT_NOT_FOUND", "Report not found")
    return web.json_response({"ok": True, "data": jsonable(report)})


async def report_content(request: web.Request) -> web.Response:
    report_id = request.match_info["report_id"]
    report = await request.app[RPA_KEY].get_report(report_id)
    if report is None:
        raise RpaError("REPORT_NOT_FOUND", "Report not found")
    content = await request.app[RPA_KEY].report_content(report_id)
    return web.Response(
        text=content, content_type="text/csv", charset="utf-8",
        headers={"Content-Disposition": f'inline; filename="{Path(report.path).name}"'},
    )


async def list_schedules(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "data": jsonable(await request.app[RPA_KEY].list_schedules())})


async def get_schedule(request: web.Request) -> web.Response:
    record = await request.app[RPA_KEY].get_schedule(request.match_info["schedule_id"])
    if record is None:
        raise RpaError("SCHEDULE_NOT_FOUND", "Schedule not found")
    return web.json_response({"ok": True, "data": jsonable(record)})


async def put_schedule(request: web.Request) -> web.Response:
    body = await _json_body(request)
    record = await request.app[RPA_KEY].put_schedule(request.match_info["schedule_id"], body)
    return web.json_response({"ok": True, "data": jsonable(record)})


async def delete_schedule(request: web.Request) -> web.Response:
    removed = await request.app[RPA_KEY].delete_schedule(request.match_info["schedule_id"])
    if not removed:
        raise RpaError("SCHEDULE_NOT_FOUND", "Schedule not found")
    return web.json_response({"ok": True, "data": {"deleted": True}})


async def events(request: web.Request) -> web.StreamResponse:
    run_id = request.match_info["run_id"]
    if await request.app[RPA_KEY].get_run(run_id) is None:
        raise RpaError("RUN_NOT_FOUND", "Run not found")
    raw_sequence = request.headers.get("Last-Event-ID", request.query.get("after", "0"))
    try:
        sequence = int(raw_sequence)
    except ValueError as error:
        raise RpaError("INVALID_REQUEST", "Last-Event-ID must be an integer") from error
    response = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    await response.prepare(request)
    await response.write(b"retry: 1000\n\n")
    heartbeat = 0
    try:
        while True:
            records = await request.app[RPA_KEY].store.list_events(run_id, sequence)
            for record in records:
                sequence = record.sequence
                payload = jsonable(record)
                data = _compact_json(payload)
                frame = f"id: {sequence}\nevent: {record.type}\ndata: {data}\n\n"
                await response.write(frame.encode("utf-8"))
            heartbeat += 1
            if heartbeat >= 30:
                await response.write(b": heartbeat\n\n")
                heartbeat = 0
            await asyncio.sleep(0.5)
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    return response


async def openapi(request: web.Request) -> web.FileResponse:
    path = Path(__file__).resolve().parents[3] / "docs" / "api" / "openapi-v1.yaml"
    if not path.exists():
        raise web.HTTPNotFound(text="OpenAPI document not installed")
    return web.FileResponse(path)


async def _json_body(request: web.Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as error:
        raise RpaError("INVALID_JSON", "Request body must be valid JSON") from error
    if not isinstance(body, dict):
        raise RpaError("INVALID_REQUEST", "Request body must be an object")
    return body


def _compact_json(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
