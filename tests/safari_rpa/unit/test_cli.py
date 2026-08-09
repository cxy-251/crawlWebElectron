from __future__ import annotations

import io
import inspect
import json
import tempfile
import unittest
from argparse import Namespace
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from safari_rpa.cli import _run
from safari_rpa.cli.commands.run import handle_run
from safari_rpa.cli.commands.scheduled_run import handle_scheduled_run
from safari_rpa.cli.commands.twitter import handle_twitter
from safari_rpa.cli.output import success
from safari_rpa.cli.parser import build_parser
from safari_rpa.cli.registry import COMMAND_HANDLERS
from safari_rpa.contracts.runtime import RunRecord, RunStatus
from safari_rpa.paths import default_config_path


class CliTests(unittest.IsolatedAsyncioTestCase):
    def test_registry_matches_top_level_parser_commands(self) -> None:
        parser = build_parser()
        choices = next(action.choices for action in parser._actions if getattr(action, "choices", None))
        self.assertEqual(set(choices), set(COMMAND_HANDLERS))
        for command, handler in COMMAND_HANDLERS.items():
            expected = f"handle_{command.replace('-', '_')}"
            self.assertEqual(expected, handler.__name__)

    def test_scheduled_run_handler_has_no_readiness_loop_or_safari_calls(self) -> None:
        source = inspect.getsource(handle_scheduled_run)
        self.assertNotIn("while ", source)
        self.assertNotIn("sleep", source)
        self.assertNotIn("inspect_windows", source)
        self.assertNotIn(".safari", source)
        self.assertIn("run_scheduled_workflow", source)

    async def test_scheduled_run_handler_delegates_to_application(self) -> None:
        class FakeApplication:
            def __init__(self) -> None:
                self.calls = []

            async def run_scheduled_workflow(
                self, workflow_id, config, *, profile, ready_until, ready_for_minutes, retry_seconds,
            ):
                self.calls.append(
                    (workflow_id, config, profile, ready_until, ready_for_minutes, retry_seconds)
                )
                return RunRecord(
                    "run-1",
                    workflow_id,
                    RunStatus.SUCCEEDED,
                    {},
                    {},
                    {"ok": True},
                    None,
                    False,
                    0,
                    0,
                )

        app = FakeApplication()
        config = default_config_path("boss/production.yaml")
        arguments = Namespace(
            workflow_id="boss.search-and-communicate.v1",
            config=config,
            profile="production",
            ready_until="12:00",
            ready_for_minutes=90,
            retry_seconds=300,
        )
        with patch("safari_rpa.cli.commands.scheduled_run.result") as output:
            code = await handle_scheduled_run(arguments, app)
        self.assertEqual(0, code)
        self.assertEqual(
            [("boss.search-and-communicate.v1", config, "production", "12:00", 90, 300)],
            app.calls,
        )
        output.assert_called_once()

    def test_schedule_parser_accepts_repeated_daily_times(self) -> None:
        arguments = build_parser().parse_args(
            ["schedule", "install", "--at", "08:00", "--at", "13:00"]
        )
        self.assertEqual(["08:00", "13:00"], arguments.at)

    def test_cli_run_record_output_omits_full_config_and_input(self) -> None:
        run = RunRecord(
            "run-1",
            "boss.search-and-communicate.v1",
            RunStatus.FAILED,
            {"search": {"weekday_keywords": {"mon": ["secretly-long-config"]}}},
            {"large": "input"},
            None,
            {"code": "EXAMPLE", "message": "failed"},
            False,
            1,
            2,
        )
        stream = io.StringIO()
        with redirect_stdout(stream):
            success(run)
        payload = json.loads(stream.getvalue())
        self.assertNotIn("config", payload["data"])
        self.assertNotIn("input", payload["data"])
        self.assertEqual("EXAMPLE", payload["data"]["error"]["code"])
        self.assertNotIn("secretly-long-config", stream.getvalue())

    def test_cli_boss_run_record_output_keeps_only_operational_summary(self) -> None:
        run = RunRecord(
            "run-1",
            "boss.search-and-communicate.v1",
            RunStatus.SUCCEEDED,
            {},
            {},
            {
                "profile": "production",
                "communicated": 12,
                "daily_confirmed_total": 42,
                "stop_reason": "source_exhausted",
                "page_metrics": {"huge": ["detail"] * 100},
                "keyword_order": ["many", "keywords"],
            },
            None,
            False,
            1,
            2,
        )
        stream = io.StringIO()
        with redirect_stdout(stream):
            success(run)
        payload = json.loads(stream.getvalue())

        self.assertEqual(12, payload["data"]["output"]["communicated"])
        self.assertEqual(42, payload["data"]["output"]["daily_confirmed_total"])
        self.assertNotIn("page_metrics", payload["data"]["output"])
        self.assertNotIn("keyword_order", payload["data"]["output"])

    async def test_run_handler_applies_config_profile_override(self) -> None:
        class FakeApplication:
            def __init__(self) -> None:
                self.created = []

            async def create_run(self, workflow_id, config, input_data, *, background):
                self.created.append((workflow_id, config, input_data, background))
                return RunRecord(
                    "run-1",
                    workflow_id,
                    RunStatus.RUNNING,
                    config,
                    input_data,
                    {},
                    None,
                    background,
                    0,
                    0,
                )

            async def execute_run(self, run_id):
                return RunRecord(
                    run_id,
                    self.created[-1][0],
                    RunStatus.SUCCEEDED,
                    self.created[-1][1],
                    self.created[-1][2],
                    {},
                    None,
                    False,
                    0,
                    0,
                )

        app = FakeApplication()
        parser = build_parser()
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "boss.yaml"
            config_path.write_text("profile: production\nsearch: {}\n", encoding="utf-8")
            arguments = parser.parse_args(
                [
                    "run",
                    "boss.search-and-communicate.v1",
                    "--config",
                    str(config_path),
                    "--profile",
                    "test",
                ]
            )
            with patch("safari_rpa.cli.commands.run.result"):
                code = await handle_run(arguments, app)
        self.assertEqual(0, code)
        self.assertEqual("test", app.created[0][1]["profile"])

    async def test_workflows_command_keeps_json_shape_after_package_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            arguments = build_parser().parse_args(["--home", tmp, "workflows"])
            with patch("safari_rpa.cli.commands.workflows.success") as output:
                code = await _run(arguments)
        self.assertEqual(0, code)
        output.assert_called_once()
        self.assertEqual("boss.search-and-communicate.v1", output.call_args.args[0][0].id)

    async def test_twitter_convenience_commands_delegate_to_workflows(self) -> None:
        class FakeApplication:
            def __init__(self) -> None:
                self.created = []

            async def create_run(self, workflow_id, config, input_data, *, background):
                self.created.append((workflow_id, config, input_data, background))
                return RunRecord(
                    f"run-{len(self.created)}",
                    workflow_id,
                    RunStatus.RUNNING,
                    config,
                    input_data,
                    {},
                    None,
                    background,
                    0,
                    0,
                )

            async def execute_run(self, run_id):
                workflow_id = self.created[-1][0]
                return RunRecord(
                    run_id,
                    workflow_id,
                    RunStatus.SUCCEEDED,
                    self.created[-1][1],
                    self.created[-1][2],
                    {"workflow_id": workflow_id},
                    None,
                    False,
                    0,
                    0,
                )

        app = FakeApplication()
        parser = build_parser()
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "twitter-config.yaml"
            input_path = Path(tmp) / "target.json"
            config_path.write_text("target:\n  handle: example\n", encoding="utf-8")
            input_path.write_text('{"profile_url":"https://x.com/example"}', encoding="utf-8")
            with patch("safari_rpa.cli.commands.twitter.result") as output:
                collect_args = parser.parse_args(["twitter", "collect", "--config", str(config_path), "--input", str(input_path)])
                collect_code = await handle_twitter(collect_args, app)
                clean_args = parser.parse_args(["twitter", "clean", "--config", str(config_path), "--input", str(input_path)])
                clean_code = await handle_twitter(clean_args, app)

        self.assertEqual(0, collect_code)
        self.assertEqual(0, clean_code)
        self.assertEqual("twitter.collect-raw.v1", app.created[0][0])
        self.assertEqual("twitter.clean-prompts.v1", app.created[1][0])
        self.assertFalse(app.created[0][3])
        self.assertEqual(2, output.call_count)

    def test_cli_is_package_not_monolithic_module(self) -> None:
        root = Path(__file__).resolve().parents[3]
        self.assertFalse((root / "src" / "safari-rpa" / "safari_rpa" / "cli.py").exists())
        self.assertTrue((root / "src" / "safari-rpa" / "safari_rpa" / "cli" / "__init__.py").is_file())
