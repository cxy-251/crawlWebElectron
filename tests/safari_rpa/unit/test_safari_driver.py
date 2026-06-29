from __future__ import annotations

import json
import re
import unittest

from safari_rpa.adapters.safari import SafariDriver
from safari_rpa.contracts.safari import ElementState, Locator, PageCondition, PageRef, PageState


class FakeRunner:
    def __init__(self) -> None:
        self.commands: list[tuple[str, ...]] = []

    async def run(self, command: str, *arguments: object) -> str:
        self.commands.append((command, *(str(value) for value in arguments)))
        if command == "inspect":
            return json.dumps(
                [
                    {
                        "window_id": 44,
                        "index": 1,
                        "tabs": [
                            {
                                "tab_index": 1,
                                "url": "https://x.com/",
                                "title": "X",
                                "is_current": False,
                            }
                        ],
                    }
                ]
            )
        if command == "activate":
            return "ok"
        if command == "eval":
            source = str(arguments[2])
            if "window.name =" in source:
                match = re.search(r'window\.name = "([^"]+)"', source)
                value = match.group(1) if match else ""
            else:
                value = {
                    "url": "https://x.com/",
                    "title": "X",
                    "ready_state": "complete",
                    "text_excerpt": "",
                }
            return json.dumps({"ok": True, "value": value})
        raise AssertionError((command, arguments))


class SystemClickRunner(FakeRunner):
    async def run(self, command: str, *arguments: object) -> str:
        if command == "front_app":
            self.commands.append((command,))
            return "Codex"
        if command == "activate_app":
            self.commands.append((command, *(str(value) for value in arguments)))
            return "ok"
        if command == "system_click":
            self.commands.append((command, *(str(value) for value in arguments)))
            return "ok"
        return await super().run(command, *arguments)


class SafariDriverTests(unittest.IsolatedAsyncioTestCase):
    async def test_ensure_site_reuses_existing_matching_tab(self) -> None:
        runner = FakeRunner()
        driver = SafariDriver(runner=runner, poll_interval=0)
        page = await driver.ensure_site("x.com", "https://x.com/")
        self.assertEqual(44, page.window_id)
        self.assertEqual(1, page.tab_index)
        self.assertEqual("x.com", page.expected_origin)
        commands = [command[0] for command in runner.commands]
        self.assertIn("activate", commands)
        self.assertNotIn("create_window", commands)
        self.assertNotIn("create_tab", commands)

    async def test_inspect_returns_typed_window_contract(self) -> None:
        driver = SafariDriver(runner=FakeRunner())
        windows = await driver.inspect_windows()
        self.assertEqual(44, windows[0].window_id)
        self.assertEqual("https://x.com/", windows[0].tabs[0].url)

    def test_pointer_scripts_cover_radix_click_and_hover_events(self) -> None:
        driver = SafariDriver(runner=FakeRunner())
        click_script = driver._click_script(Locator.css("button"))
        hover_script = driver._hover_script(Locator.script("document.querySelector('button')"))
        self.assertIn("PointerEvent", click_script)
        self.assertIn("'pointerdown'", click_script)
        self.assertIn("'click'", click_script)
        self.assertNotIn("el.click()", click_script)
        self.assertIn("'pointermove'", hover_script)
        self.assertIn("focus({preventScroll:true})", hover_script)

    def test_screen_point_script_uses_viewport_and_window_offsets(self) -> None:
        driver = SafariDriver(runner=FakeRunner())
        script = driver._screen_point_script(Locator.css("button"))
        self.assertIn("scrollIntoView({block:'center',inline:'center'})", script)
        self.assertIn("window.screenX", script)
        self.assertIn("window.devicePixelRatio", script)
        self.assertIn("window.screenY+chromeY+clientY*dpr", script)
        self.assertIn("window.outerHeight-(visual?visual.height:window.innerHeight)*dpr", script)
        self.assertIn("visualViewport", script)

    async def test_trusted_click_uses_system_click_and_waits_for_postcondition(self) -> None:
        class TrustedClickDriver(SafariDriver):
            async def _resolve(self, page):
                return (44, 1)

            async def _query_at(self, resolved, locator):
                return ElementState(found=True, visible=True, enabled=True)

            async def _snapshot_at(self, window_id, tab_index):
                return PageState("https://x.com/", "X", "complete")

            async def _evaluate_at(self, window_id, tab_index, body):
                if "window.screenX" in body:
                    return {"ok": True, "x": 123.4, "y": 456.6}
                return True

            async def wait_for(self, page, condition, timeout=30):
                self.waited = condition
                return PageState("https://x.com/", "X", "complete")

        runner = SystemClickRunner()
        driver = TrustedClickDriver(runner=runner)
        page = PageRef("session", "marker", "x.com", 44, 1)
        condition = PageCondition.js("return true;", "real menu opened")
        evidence = await driver.trusted_click(page, Locator.css("button"), condition)
        self.assertEqual("trusted_click", evidence.action)
        self.assertIs(condition, driver.waited)
        self.assertIn(("system_click", "123", "457"), runner.commands)

    async def test_trusted_relative_click_scales_offsets_by_device_pixel_ratio(self) -> None:
        class RelativeClickDriver(SafariDriver):
            async def _resolve(self, page):
                return (44, 1)

            async def _query_at(self, resolved, locator):
                return ElementState(found=True, visible=True, enabled=True)

            async def _snapshot_at(self, window_id, tab_index):
                return PageState("https://x.com/", "X", "complete")

            async def _evaluate_at(self, window_id, tab_index, body):
                if "window.screenX" in body:
                    return {"ok": True, "x": 100, "y": 200, "devicePixelRatio": 1.5}
                return True

            async def wait_for(self, page, condition, timeout=30):
                return PageState("https://x.com/", "X", "complete")

        runner = SystemClickRunner()
        driver = RelativeClickDriver(runner=runner)
        page = PageRef("session", "marker", "x.com", 44, 1)
        evidence = await driver.trusted_click_relative(
            page,
            Locator.css("button"),
            70,
            130,
            PageCondition.js("return true;", "selected"),
        )
        self.assertEqual("trusted_click_relative", evidence.action)
        self.assertIn(("system_click", "100", "200"), runner.commands)
        self.assertIn(("system_click", "205", "395"), runner.commands)
        self.assertIn(("activate_app", "Codex"), runner.commands)
        self.assertEqual("Codex", evidence.details["restored_app"])

    def test_fill_supports_prosemirror_and_normalizes_trailing_newlines(self) -> None:
        driver = SafariDriver(runner=FakeRunner())
        fill = driver._fill_script(Locator.css("#prompt-textarea"), "first\nsecond")
        matches = driver._value_matches_script(Locator.css("#prompt-textarea"), "first\r\nsecond")
        self.assertIn("execCommand('insertText'", fill)
        self.assertIn("data-inline-selection-pill", fill)
        self.assertIn("[contenteditable=false][data-system-hint-type]", fill)
        self.assertIn("InputEvent('input'", fill)
        self.assertIn("replace(/\\r\\n?/g,'\\n')", matches)
        self.assertIn("clone.querySelectorAll('[data-inline-selection-pill],[data-system-hint-type]')", matches)
        self.assertIn("replace(/[\\u200b\\u200c\\u200d\\ufeff]/g,'')", matches)
        self.assertIn(".trim()", matches)
        self.assertIn("replace(/\\n+$/g,'')", matches)

    async def test_hover_waits_for_its_postcondition(self) -> None:
        class HoverDriver(SafariDriver):
            def __init__(self) -> None:
                super().__init__(runner=FakeRunner())
                self.evaluated: list[str] = []
                self.waited: PageCondition | None = None

            async def _resolve(self, page):
                return (44, 1)

            async def _query_at(self, resolved, locator):
                return ElementState(found=True, visible=True, enabled=True)

            async def _snapshot_at(self, window_id, tab_index):
                return PageState("https://x.com/", "X", "complete")

            async def _evaluate_at(self, window_id, tab_index, body):
                self.evaluated.append(body)
                return True

            async def wait_for(self, page, condition, timeout=30):
                self.waited = condition
                return PageState("https://x.com/", "X", "complete")

        driver = HoverDriver()
        page = PageRef("session", "marker", "x.com", 44, 1)
        condition = PageCondition.js("return true;", "revealed control")
        evidence = await driver.hover(page, Locator.css("[data-sidebar-item]"), condition)
        self.assertEqual("hover", evidence.action)
        self.assertIs(condition, driver.waited)
        self.assertTrue(any("pointermove" in script for script in driver.evaluated))
