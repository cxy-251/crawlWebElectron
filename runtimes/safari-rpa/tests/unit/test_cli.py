from __future__ import annotations

import inspect
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from macrpa.cli import _run
from macrpa.cli.commands.run import handle_run
from macrpa.cli.commands.scheduled_run import handle_scheduled_run
from macrpa.cli.commands.twitter import handle_twitter
from macrpa.cli.parser import build_parser
from macrpa.cli.registry import COMMAND_HANDLERS
from macrpa.contracts.runtime import RunRecord, RunStatus


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

            async def run_scheduled_workflow(self, workflow_id, config, *, profile, ready_until, retry_seconds):
                self.calls.append((workflow_id, config, profile, ready_until, retry_seconds))
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
        arguments = Namespace(
            workflow_id="boss.search-and-communicate.v1",
            config=Path("configs/boss.production.yaml"),
            profile="production",
            ready_until="12:00",
            retry_seconds=300,
        )
        with patch("macrpa.cli.commands.scheduled_run.result") as output:
            code = await handle_scheduled_run(arguments, app)
        self.assertEqual(0, code)
        self.assertEqual(
            [("boss.search-and-communicate.v1", Path("configs/boss.production.yaml"), "production", "12:00", 300)],
            app.calls,
        )
        output.assert_called_once()

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
            with patch("macrpa.cli.commands.run.result"):
                code = await handle_run(arguments, app)
        self.assertEqual(0, code)
        self.assertEqual("test", app.created[0][1]["profile"])

    async def test_workflows_command_keeps_json_shape_after_package_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            arguments = build_parser().parse_args(["--home", tmp, "workflows"])
            with patch("macrpa.cli.commands.workflows.success") as output:
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
            config_path = Path(tmp) / "twitter.yaml"
            input_path = Path(tmp) / "target.json"
            config_path.write_text("target:\n  handle: example\n", encoding="utf-8")
            input_path.write_text('{"profile_url":"https://x.com/example"}', encoding="utf-8")
            with patch("macrpa.cli.commands.twitter.result") as output:
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
        root = Path(__file__).resolve().parents[2]
        self.assertFalse((root / "src" / "macrpa" / "cli.py").exists())
        self.assertTrue((root / "src" / "macrpa" / "cli" / "__init__.py").is_file())
