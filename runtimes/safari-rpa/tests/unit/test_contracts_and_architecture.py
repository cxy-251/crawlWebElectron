from __future__ import annotations

import ast
import asyncio
import tempfile
import unittest
from pathlib import Path

import yaml

from macrpa.application import build_application
from macrpa.contracts.errors import RpaError
from macrpa.transport import create_http_app


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src" / "macrpa"
PROMPTLOOM_SOURCE = ROOT / "src" / "promptloom"


class ContractAndArchitectureTests(unittest.TestCase):
    def test_plan_archive_points_to_existing_current_plan(self) -> None:
        index = (ROOT / "docs" / "plans" / "INDEX.md").read_text(encoding="utf-8")
        self.assertIn("0001-foundation.md", index)
        self.assertIn("0009-twitter-two-phase-collection-cleaning.md", index)
        self.assertTrue((ROOT / "docs" / "plans" / "0001-foundation.md").is_file())
        self.assertTrue((ROOT / "docs" / "plans" / "0009-twitter-two-phase-collection-cleaning.md").is_file())
        self.assertTrue((ROOT / "docs" / "architecture" / "INDEX.md").is_file())
        self.assertTrue((ROOT / "docs" / "architecture" / "design-principles.md").is_file())
        self.assertTrue((ROOT / "AGENTS.md").is_file())

    def test_example_yaml_is_valid(self) -> None:
        for path in (ROOT / "configs").glob("*.yaml"):
            self.assertIsInstance(yaml.safe_load(path.read_text(encoding="utf-8")), dict)

    def test_http_routes_match_versioned_contract(self) -> None:
        application = build_application(ROOT / "var" / "route-test")
        app = create_http_app(application, api_token="test")
        resources = {resource.canonical for resource in app.router.resources()}
        self.assertIn("/api/v1/health", resources)
        self.assertIn("/api/v1/runs/{run_id}/events", resources)
        self.assertIn("/api/v1/openapi.yaml", resources)
        self.assertIn("/api/v1/reports/{report_id}/content", resources)
        self.assertIn("/api/v1/schedules/{schedule_id}", resources)

    def test_registry_exposes_boss_and_twitter_only(self) -> None:
        application = build_application(ROOT / "var" / "registry-test")
        workflow_ids = {descriptor.id for descriptor in application.registry.descriptors()}
        self.assertIn("boss.search-and-communicate.v1", workflow_ids)
        self.assertIn("twitter.collect-raw.v1", workflow_ids)
        self.assertIn("twitter.clean-prompts.v1", workflow_ids)
        self.assertIn("twitter.extract-prompts.v1", workflow_ids)
        self.assertNotIn("chatgpt.batch-generate.v1", workflow_ids)
        self.assertNotIn("kuaishou.upload.v1", workflow_ids)

    def test_old_workflow_ids_are_not_reserved(self) -> None:
        async def create_old_run(workflow_id: str) -> str:
            with tempfile.TemporaryDirectory() as directory:
                application = await build_application(Path(directory) / "var").open()
                try:
                    try:
                        await application.create_run(workflow_id, {}, {}, background=False)
                    except RpaError as error:
                        return error.code
                    return "created"
                finally:
                    await application.close()

        self.assertEqual("WORKFLOW_NOT_FOUND", asyncio.run(create_old_run("chatgpt.batch-generate.v1")))
        self.assertEqual("WORKFLOW_NOT_FOUND", asyncio.run(create_old_run("kuaishou.upload.v1")))

    def test_twitter_workflow_uses_llm_boundary_not_provider_http(self) -> None:
        source = (SOURCE / "workflows" / "twitter.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)
        self.assertIn("macrpa.contracts.runtime", imports)
        self.assertNotIn("aiohttp", imports)
        self.assertNotIn("requests", imports)
        self.assertNotIn("promptloom", imports)
        self.assertNotIn("LmStudio", source)
        self.assertNotIn("127.0.0.1:1234", source)
        self.assertNotIn("system prompt", source.lower())
        self.assertNotIn("你是本地文本清洗器", source)

    def test_promptloom_package_has_no_macrpa_imports(self) -> None:
        failures: list[str] = []
        for path in PROMPTLOOM_SOURCE.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for imported in self._imports(tree):
                if imported == "macrpa" or imported.startswith("macrpa."):
                    failures.append(f"{path.relative_to(ROOT)} imports {imported}")
        self.assertEqual([], failures)

    def test_provider_http_clients_are_confined_to_llm_providers(self) -> None:
        failures: list[str] = []
        for path in (ROOT / "src").rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            imports = self._provider_http_client_imports(tree)
            if imports:
                try:
                    relative = path.relative_to(PROMPTLOOM_SOURCE / "providers")
                except ValueError:
                    failures.append(f"{path.relative_to(ROOT)} imports {imports}")
                else:
                    self.assertTrue(str(relative))
        self.assertEqual([], failures)

    def test_site_adapters_do_not_import_upper_layers_or_llm(self) -> None:
        forbidden = (
            "macrpa.runtime",
            "macrpa.application",
            "macrpa.workflows",
            "macrpa.llm",
            "promptloom",
        )
        failures: list[str] = []
        for path in (SOURCE / "sites").rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for imported in self._imports(tree):
                if imported.startswith(forbidden):
                    failures.append(f"{path.relative_to(ROOT)} imports {imported}")
        self.assertEqual([], failures)

    def test_layer_import_boundaries(self) -> None:
        forbidden = {
            "contracts": ("macrpa.adapters", "macrpa.application", "macrpa.runtime", "macrpa.sites", "macrpa.workflows"),
            "runtime": ("macrpa.adapters", "macrpa.application", "macrpa.sites", "macrpa.workflows"),
            "sites": ("macrpa.adapters", "macrpa.application", "macrpa.runtime", "macrpa.workflows"),
            "workflows": ("macrpa.adapters", "macrpa.application", "macrpa.runtime"),
        }
        failures: list[str] = []
        for layer, prefixes in forbidden.items():
            for path in (SOURCE / layer).rglob("*.py"):
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
                imports = []
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        imports.extend(alias.name for alias in node.names)
                    elif isinstance(node, ast.ImportFrom) and node.module:
                        imports.append(node.module)
                for imported in imports:
                    if imported.startswith(prefixes):
                        failures.append(f"{path.relative_to(ROOT)} imports {imported}")
        self.assertEqual([], failures)

    @staticmethod
    def _imports(tree: ast.AST) -> list[str]:
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)
        return imports

    @staticmethod
    def _provider_http_client_imports(tree: ast.AST) -> list[str]:
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names if alias.name in {"aiohttp", "requests"})
            elif isinstance(node, ast.ImportFrom) and node.module:
                if node.module == "requests":
                    imports.append(node.module)
                elif node.module == "aiohttp":
                    names = {alias.name for alias in node.names}
                    if names - {"web"}:
                        imports.append(f"{node.module}:{','.join(sorted(names))}")
        return imports
