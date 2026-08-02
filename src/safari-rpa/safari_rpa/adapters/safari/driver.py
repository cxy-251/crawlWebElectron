from __future__ import annotations

import asyncio
import json
import time
import uuid
from importlib.resources import files
from typing import Any
from urllib.parse import quote, urlparse

from safari_rpa.locking import AsyncFileLock

from safari_rpa.contracts.errors import (
    PageLostError,
    RpaError,
    SafariUnavailableError,
    UnknownSideEffectError,
    WaitTimeoutError,
)
from safari_rpa.contracts.safari import (
    ActionEvidence,
    ConditionKind,
    ElementState,
    Locator,
    LocatorKind,
    PageCondition,
    PageRef,
    PageState,
    SafariTabInfo,
    SafariWindowInfo,
)


class AppleScriptRunner:
    def __init__(self, bridge_path: str | None = None):
        resource = files("safari_rpa.adapters.safari").joinpath("safari_bridge.applescript")
        self.bridge_path = bridge_path or str(resource)

    async def run(self, command: str, *arguments: object) -> str:
        process = await asyncio.create_subprocess_exec(
            "osascript",
            self.bridge_path,
            command,
            *(str(argument) for argument in arguments),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        output = stdout.decode("utf-8", errors="replace").strip()
        error = stderr.decode("utf-8", errors="replace").strip()
        if process.returncode != 0:
            if "not authorised" in error.lower() or "not allowed" in error.lower():
                raise SafariUnavailableError(
                    "Safari automation permission is not available",
                    {"stderr": error},
                )
            raise RpaError("APPLESCRIPT_FAILED", error or "AppleScript failed", details={"command": command})
        return output


class SafariDriver:
    """State-aware Safari implementation of the public automation contract."""

    WORKSPACE_TITLE_PREFIX = "Safari RPA Workspace"

    def __init__(
        self, runner: AppleScriptRunner | None = None, poll_interval: float = 0.5,
        action_lock_path: str | None = None,
    ):
        self.runner = runner or AppleScriptRunner()
        self.poll_interval = poll_interval
        self._lock = AsyncFileLock(action_lock_path)

    async def inspect_windows(self) -> tuple[SafariWindowInfo, ...]:
        raw = await self.runner.run("inspect")
        try:
            payload = json.loads(raw or "[]")
        except json.JSONDecodeError as exc:
            raise RpaError("SAFARI_INSPECTION_INVALID", "Safari returned invalid window data", details={"raw": raw}) from exc
        return tuple(
            SafariWindowInfo(
                window_id=int(window["window_id"]),
                index=int(window["index"]),
                tabs=tuple(
                    SafariTabInfo(
                        window_id=int(window["window_id"]),
                        tab_index=int(tab["tab_index"]),
                        url=str(tab.get("url") or ""),
                        title=str(tab.get("title") or ""),
                        is_current=bool(tab.get("is_current")),
                    )
                    for tab in window.get("tabs", [])
                ),
            )
            for window in payload
        )

    async def ensure_site(self, origin: str, start_url: str, timeout: float = 30) -> PageRef:
        expected_origin = self._normalize_origin(origin)
        session_id = uuid.uuid4().hex
        marker = f"safari_rpa:{session_id}"
        async with self._lock:
            windows = await self.inspect_windows()
            workspace = self._workspace_window(windows, expected_origin)
            if workspace is not None:
                matching_tabs = [
                    tab for tab in workspace.tabs if self._url_matches_origin(tab.url, expected_origin)
                ]
            else:
                matching_tabs = []

            if matching_tabs:
                selected = next((tab for tab in matching_tabs if tab.is_current), matching_tabs[0])
                window_id = selected.window_id
                tab_index = await self._activate_site_tab(
                    window_id,
                    selected.tab_index,
                    expected_origin,
                    selected.url,
                )
            else:
                if workspace is None:
                    window_id = int(await self.runner.run("create_window", self._workspace_url(expected_origin)))
                else:
                    window_id = workspace.window_id
                tab_index = int(await self.runner.run("create_tab", window_id, start_url))
                tab_index = await self._activate_site_tab(
                    window_id,
                    tab_index,
                    expected_origin,
                    start_url,
                )

            await self._wait_direct_ready(window_id, tab_index, expected_origin, timeout)
            await self._evaluate_at(
                window_id,
                tab_index,
                f"window.name = {json.dumps(marker)}; return window.name;",
            )
            return PageRef(session_id, marker, expected_origin, window_id, tab_index)

    async def _activate_site_tab(
        self,
        window_id: int,
        tab_index: int,
        expected_origin: str,
        preferred_url: str,
    ) -> int:
        """Activate a site tab and recover once from Safari index reordering."""

        try:
            await self.runner.run("activate", window_id, tab_index)
            return tab_index
        except RpaError as exc:
            if exc.code != "APPLESCRIPT_FAILED":
                raise

        windows = await self.inspect_windows()
        window = next((item for item in windows if item.window_id == window_id), None)
        if window is None:
            raise PageLostError(
                "Safari reordered or removed the target workspace window",
                {"window_id": window_id, "origin": expected_origin},
            )
        candidates = [
            tab
            for tab in window.tabs
            if self._url_matches_origin(tab.url, expected_origin)
        ]
        if not candidates:
            raise PageLostError(
                "Safari reordered or removed the target site tab",
                {"window_id": window_id, "origin": expected_origin},
            )
        selected = next(
            (tab for tab in candidates if tab.tab_index == tab_index),
            next(
                (tab for tab in candidates if tab.is_current and tab.url == preferred_url),
                next(
                    (tab for tab in candidates if tab.is_current),
                    next((tab for tab in candidates if tab.url == preferred_url), candidates[-1]),
                ),
            ),
        )
        await self.runner.run("activate", selected.window_id, selected.tab_index)
        return selected.tab_index

    async def create_page(self, parent: PageRef, start_url: str, timeout: float = 30) -> PageRef:
        """Create a separately owned tab in the parent's RPA workspace."""

        expected_origin = self._normalize_origin(urlparse(start_url).hostname or parent.expected_origin)
        session_id = uuid.uuid4().hex
        marker = f"safari_rpa:{session_id}"
        async with self._lock:
            parent_window_id, _ = await self._resolve(parent)
            tab_index = int(await self.runner.run("create_tab", parent_window_id, start_url))
            tab_index = await self._activate_site_tab(
                parent_window_id,
                tab_index,
                expected_origin,
                start_url,
            )
            await self._wait_direct_ready(parent_window_id, tab_index, expected_origin, timeout)
            await self._evaluate_at(
                parent_window_id,
                tab_index,
                f"window.name = {json.dumps(marker)}; return window.name;",
            )
            return PageRef(session_id, marker, expected_origin, parent_window_id, tab_index)

    async def navigate(self, page: PageRef, url: str, timeout: float = 30) -> ActionEvidence:
        async with self._lock:
            resolved = await self._resolve(page)
            before = await self._snapshot_at(*resolved)
            started = time.time()
            await self.runner.run("navigate", resolved[0], resolved[1], url)
            await self._wait_direct_ready(resolved[0], resolved[1], page.expected_origin, timeout)
            await self._evaluate_at(
                resolved[0], resolved[1], f"window.name = {json.dumps(page.marker)}; return window.name;"
            )
            after = await self._snapshot_at(*resolved)
            return ActionEvidence("navigate", started, time.time(), before, after, {"url": url})

    async def wait_for(self, page: PageRef, condition: PageCondition, timeout: float = 30) -> PageState:
        deadline = time.monotonic() + timeout
        stable_matches = 0
        last_state: PageState | None = None
        while time.monotonic() < deadline:
            resolved = await self._resolve(page)
            matched, state = await self._condition_at(resolved, condition)
            last_state = state
            stable_matches = stable_matches + 1 if matched else 0
            if stable_matches >= 2:
                return state
            await asyncio.sleep(self.poll_interval)
        raise WaitTimeoutError(
            f"Timed out waiting for {condition.description or condition.kind}",
            {"condition": condition.kind, "last_state": self._state_dict(last_state)},
        )

    async def query(self, page: PageRef, locator: Locator) -> ElementState:
        resolved = await self._resolve(page)
        value = await self._evaluate_at(*resolved, self._element_state_script(locator))
        if not isinstance(value, dict):
            return ElementState(found=False)
        return ElementState(
            found=bool(value.get("found")),
            visible=bool(value.get("visible")),
            enabled=bool(value.get("enabled")),
            text=str(value.get("text") or ""),
            value=str(value.get("value") or ""),
        )

    async def read(self, page: PageRef, locator: Locator) -> str | None:
        state = await self.query(page, locator)
        return state.text if state.found else None

    async def click(
        self,
        page: PageRef,
        locator: Locator,
        postcondition: PageCondition,
        timeout: float = 15,
    ) -> ActionEvidence:
        async with self._lock:
            resolved = await self._resolve(page)
            element = await self._query_at(resolved, locator)
            if not element.found or not element.visible or not element.enabled:
                raise WaitTimeoutError("Click target is not interactable", {"locator": locator.value})
            before = await self._snapshot_at(*resolved)
            started = time.time()
            clicked = await self._evaluate_at(*resolved, self._click_script(locator))
            if clicked is not True:
                raise RpaError("CLICK_REJECTED", "Safari page did not accept the click", details={"locator": locator.value})
            try:
                after = await self.wait_for(page, postcondition, timeout)
            except WaitTimeoutError as exc:
                raise UnknownSideEffectError(
                    "Click was issued but its postcondition could not be confirmed",
                    {"locator": locator.value, "postcondition": postcondition.description},
                ) from exc
            return ActionEvidence("click", started, time.time(), before, after, {"locator": locator.value})

    async def trusted_click(
        self,
        page: PageRef,
        locator: Locator,
        postcondition: PageCondition,
        timeout: float = 15,
    ) -> ActionEvidence:
        async with self._lock:
            resolved = await self._resolve(page)
            await self.runner.run("activate", resolved[0], resolved[1])
            element = await self._query_at(resolved, locator)
            if not element.found or not element.visible or not element.enabled:
                raise WaitTimeoutError("Trusted click target is not interactable", {"locator": locator.value})
            before = await self._snapshot_at(*resolved)
            started = time.time()
            point = await self._evaluate_at(*resolved, self._screen_point_script(locator))
            if not isinstance(point, dict) or not point.get("ok"):
                raise RpaError("CLICK_COORDINATES_UNAVAILABLE", "Safari could not resolve click coordinates", details={"locator": locator.value})
            await self.runner.run("system_click", int(round(float(point["x"]))), int(round(float(point["y"]))))
            try:
                after = await self.wait_for(page, postcondition, timeout)
            except WaitTimeoutError as exc:
                raise UnknownSideEffectError(
                    "Trusted click was issued but its postcondition could not be confirmed",
                    {
                        "locator": locator.value,
                        "postcondition": postcondition.description,
                        "point": {key: point.get(key) for key in ("x", "y")},
                    },
                ) from exc
            return ActionEvidence(
                "trusted_click",
                started,
                time.time(),
                before,
                after,
                {"locator": locator.value, "point": {key: point.get(key) for key in ("x", "y")}},
            )

    async def trusted_click_relative(
        self,
        page: PageRef,
        locator: Locator,
        offset_x: float,
        offset_y: float,
        postcondition: PageCondition,
        timeout: float = 15,
    ) -> ActionEvidence:
        async with self._lock:
            resolved = await self._resolve(page)
            previous_app = await self.runner.run("front_app")
            await self.runner.run("activate", resolved[0], resolved[1])
            element = await self._query_at(resolved, locator)
            if not element.found or not element.visible or not element.enabled:
                raise WaitTimeoutError("Trusted click target is not interactable", {"locator": locator.value})
            before = await self._snapshot_at(*resolved)
            started = time.time()
            point = await self._evaluate_at(*resolved, self._screen_point_script(locator))
            if not isinstance(point, dict) or not point.get("ok"):
                raise RpaError("CLICK_COORDINATES_UNAVAILABLE", "Safari could not resolve click coordinates", details={"locator": locator.value})
            dpr = float(point.get("devicePixelRatio") or 1)
            anchor_x = int(round(float(point["x"])))
            anchor_y = int(round(float(point["y"])))
            target_x = int(round(float(point["x"]) + offset_x * dpr))
            target_y = int(round(float(point["y"]) + offset_y * dpr))
            await self.runner.run("system_click", anchor_x, anchor_y)
            await asyncio.sleep(0.15)
            await self.runner.run("system_click", target_x, target_y)
            if previous_app and previous_app != "Safari":
                await self.runner.run("activate_app", previous_app)
            try:
                after = await self.wait_for(page, postcondition, timeout)
            except WaitTimeoutError as exc:
                raise UnknownSideEffectError(
                    "Trusted click sequence was issued but its postcondition could not be confirmed",
                    {
                        "locator": locator.value,
                        "postcondition": postcondition.description,
                        "anchor": {"x": anchor_x, "y": anchor_y},
                        "target": {"x": target_x, "y": target_y},
                        "offset": {"x": offset_x, "y": offset_y},
                        "restored_app": previous_app,
                    },
                ) from exc
            return ActionEvidence(
                "trusted_click_relative",
                started,
                time.time(),
                before,
                after,
                {
                    "locator": locator.value,
                    "anchor": {"x": anchor_x, "y": anchor_y},
                    "target": {"x": target_x, "y": target_y},
                    "offset": {"x": offset_x, "y": offset_y},
                    "restored_app": previous_app,
                },
            )

    async def hover(
        self,
        page: PageRef,
        locator: Locator,
        postcondition: PageCondition,
        timeout: float = 15,
    ) -> ActionEvidence:
        async with self._lock:
            resolved = await self._resolve(page)
            element = await self._query_at(resolved, locator)
            if not element.found or not element.visible:
                raise WaitTimeoutError("Hover target is not visible", {"locator": locator.value})
            before = await self._snapshot_at(*resolved)
            started = time.time()
            hovered = await self._evaluate_at(*resolved, self._hover_script(locator))
            if hovered is not True:
                raise RpaError("HOVER_REJECTED", "Safari page did not accept the hover", details={"locator": locator.value})
            after = await self.wait_for(page, postcondition, timeout)
            return ActionEvidence("hover", started, time.time(), before, after, {"locator": locator.value})

    async def fill(self, page: PageRef, locator: Locator, value: str, timeout: float = 15) -> ActionEvidence:
        async with self._lock:
            resolved = await self._resolve(page)
            element = await self._query_at(resolved, locator)
            if not element.found or not element.visible or not element.enabled:
                raise WaitTimeoutError("Fill target is not interactable", {"locator": locator.value})
            before = await self._snapshot_at(*resolved)
            started = time.time()
            filled = await self._evaluate_at(*resolved, self._fill_script(locator, value))
            if filled is not True:
                raise RpaError("FILL_REJECTED", "Safari page did not accept text input")
            condition = PageCondition.js(
                self._value_matches_script(locator, value),
                f"value of {locator.value} matches input",
            )
            after = await self.wait_for(page, condition, timeout)
            return ActionEvidence("fill", started, time.time(), before, after, {"locator": locator.value})

    async def evaluate(self, page: PageRef, expression: str) -> object:
        resolved = await self._resolve(page)
        return await self._evaluate_at(*resolved, expression)

    async def snapshot(self, page: PageRef) -> PageState:
        resolved = await self._resolve(page)
        return await self._snapshot_at(*resolved)

    async def close_page(self, page: PageRef) -> None:
        async with self._lock:
            resolved = await self._resolve(page)
            await self.runner.run("close_tab", resolved[0], resolved[1])

    async def _resolve(self, page: PageRef) -> tuple[int, int]:
        windows = await self.inspect_windows()
        candidates = [
            tab
            for window in windows
            if window.window_id == page.window_id
            for tab in window.tabs
            if self._url_matches_origin(tab.url, page.expected_origin)
        ]
        candidates.sort(key=lambda tab: tab.tab_index != page.tab_index)
        for candidate in candidates:
            try:
                marker = await self._evaluate_at(candidate.window_id, candidate.tab_index, "return window.name;")
            except RpaError:
                continue
            if marker == page.marker:
                return candidate.window_id, candidate.tab_index
        raise PageLostError(
            "The Safari page owned by this run can no longer be resolved",
            {"window_id": page.window_id, "origin": page.expected_origin},
        )

    async def _wait_direct_ready(
        self, window_id: int, tab_index: int, expected_origin: str, timeout: float
    ) -> None:
        deadline = time.monotonic() + timeout
        stable_matches = 0
        while time.monotonic() < deadline:
            try:
                state = await self._snapshot_at(window_id, tab_index)
                matched = state.ready_state == "complete" and self._url_matches_origin(state.url, expected_origin)
            except RpaError:
                matched = False
            stable_matches = stable_matches + 1 if matched else 0
            if stable_matches >= 2:
                return
            await asyncio.sleep(self.poll_interval)
        raise WaitTimeoutError("Safari page did not reach a stable ready state", {"origin": expected_origin})

    async def _condition_at(
        self, resolved: tuple[int, int], condition: PageCondition
    ) -> tuple[bool, PageState]:
        state = await self._snapshot_at(*resolved)
        if condition.kind == ConditionKind.READY:
            return state.ready_state == "complete", state
        if condition.kind == ConditionKind.URL_CONTAINS:
            return bool(condition.value and condition.value in state.url), state
        if condition.kind == ConditionKind.TEXT_PRESENT:
            return bool(condition.value and condition.value in state.text_excerpt), state
        if condition.kind in (ConditionKind.PRESENT, ConditionKind.ABSENT):
            if condition.locator is None:
                return False, state
            element = await self._query_at(resolved, condition.locator)
            matched = element.found and element.visible
            return (not matched if condition.kind == ConditionKind.ABSENT else matched), state
        if condition.kind == ConditionKind.JS_TRUTHY:
            value = await self._evaluate_at(*resolved, condition.value or "return false;")
            return value is True, state
        return False, state

    async def _query_at(self, resolved: tuple[int, int], locator: Locator) -> ElementState:
        value = await self._evaluate_at(*resolved, self._element_state_script(locator))
        if not isinstance(value, dict):
            return ElementState(found=False)
        return ElementState(
            bool(value.get("found")),
            bool(value.get("visible")),
            bool(value.get("enabled")),
            str(value.get("text") or ""),
            str(value.get("value") or ""),
        )

    async def _snapshot_at(self, window_id: int, tab_index: int) -> PageState:
        value = await self._evaluate_at(
            window_id,
            tab_index,
            "return {url: location.href, title: document.title, ready_state: document.readyState, "
            "text_excerpt: (document.body?.innerText || '').slice(0, 4000)};",
        )
        if not isinstance(value, dict):
            raise RpaError("PAGE_STATE_INVALID", "Safari returned an invalid page snapshot")
        return PageState(
            url=str(value.get("url") or ""),
            title=str(value.get("title") or ""),
            ready_state=str(value.get("ready_state") or ""),
            text_excerpt=str(value.get("text_excerpt") or ""),
        )

    async def _evaluate_at(self, window_id: int, tab_index: int, body: str) -> object:
        wrapped = (
            "(function(){try{const value=(function(){"
            + body
            + "})();return JSON.stringify({ok:true,value:value===undefined?null:value});}"
            "catch(error){return JSON.stringify({ok:false,error:String(error),stack:error?.stack||''});}})();"
        )
        raw = await self.runner.run("eval", window_id, tab_index, wrapped)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RpaError("JAVASCRIPT_RESULT_INVALID", "Safari JavaScript returned invalid JSON", details={"raw": raw}) from exc
        if not payload.get("ok"):
            raise RpaError(
                "JAVASCRIPT_FAILED",
                str(payload.get("error") or "JavaScript failed"),
                details={"stack": payload.get("stack")},
            )
        return payload.get("value")

    def _element_lookup(self, locator: Locator) -> str:
        value = json.dumps(locator.value)
        if locator.kind == LocatorKind.CSS:
            return f"document.querySelector({value})"
        if locator.kind == LocatorKind.ARIA_LABEL:
            return f"Array.from(document.querySelectorAll('[aria-label]')).find(el => el.getAttribute('aria-label') === {value})"
        if locator.kind == LocatorKind.SCRIPT:
            return f"({locator.value})"
        return (
            "(()=>{const nodes=Array.from(document.querySelectorAll('button,a,input,textarea,[role=button],"
            "[role=menuitem],[role=menuitemradio],[role=option],[contenteditable=true],div,span'));"
            f"const matches=nodes.filter(el=>(el.innerText||el.textContent||'').trim()==={value});"
            "return matches.find(el=>el.matches('button,a,input,textarea,[role=button],[role=menuitem],"
            "[role=menuitemradio],[role=option],[contenteditable=true]'))||"
            "matches.map(el=>el.closest('button,a,[role=button],[role=menuitem],[role=menuitemradio],[role=option]'))"
            ".find(Boolean)||matches[0]||null;})()"
        )

    def _element_state_script(self, locator: Locator) -> str:
        lookup = self._element_lookup(locator)
        return (
            f"const el={lookup}; if(!el) return {{found:false}}; const style=getComputedStyle(el);"
            "const rect=el.getBoundingClientRect(); return {found:true,visible:style.display!=='none'&&"
            "style.visibility!=='hidden'&&rect.width>0&&rect.height>0,enabled:!el.disabled&&"
            "el.getAttribute('aria-disabled')!=='true',text:(el.innerText||el.textContent||'').trim(),"
            "value:el.isContentEditable?(el.innerText||''):(el.value||'')};"
        )

    def _click_script(self, locator: Locator) -> str:
        lookup = self._element_lookup(locator)
        return (
            f"const el={lookup}; if(!el) return false; el.scrollIntoView({{block:'center',inline:'center'}});el.focus();"
            "const rect=el.getBoundingClientRect();const init={bubbles:true,cancelable:true,composed:true,"
            "clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,button:0,buttons:1,"
            "pointerId:1,pointerType:'mouse',isPrimary:true};"
            "for(const type of ['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown',"
            "'pointerup','mouseup','click']){const EventClass=type.startsWith('pointer')&&window.PointerEvent?"
            "PointerEvent:MouseEvent;el.dispatchEvent(new EventClass(type,init));}return true;"
        )

    def _screen_point_script(self, locator: Locator) -> str:
        lookup = self._element_lookup(locator)
        return (
            f"const el={lookup}; if(!el) return {json.dumps({'ok': False})};"
            "el.scrollIntoView({block:'center',inline:'center'});"
            "el.focus({preventScroll:true});"
            "const rect=el.getBoundingClientRect();"
            "const style=getComputedStyle(el);"
            "const visible=style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;"
            "if(!visible)return {ok:false};"
            "const visual=window.visualViewport;"
            "const offsetX=visual?visual.offsetLeft:0;"
            "const offsetY=visual?visual.offsetTop:0;"
            "const clientX=offsetX+rect.left+rect.width/2;"
            "const clientY=offsetY+rect.top+rect.height/2;"
            "const dpr=window.devicePixelRatio||1;"
            "const chromeX=Math.max(0,(window.outerWidth-(visual?visual.width:window.innerWidth)*dpr)/2);"
            "const chromeY=Math.max(0,window.outerHeight-(visual?visual.height:window.innerHeight)*dpr);"
            "return {ok:true,x:window.screenX+chromeX+clientX*dpr,y:window.screenY+chromeY+clientY*dpr,"
            "clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,"
            "screenX:window.screenX,screenY:window.screenY,outerWidth:window.outerWidth,"
            "outerHeight:window.outerHeight,innerWidth:window.innerWidth,innerHeight:window.innerHeight,"
            "devicePixelRatio:dpr,chromeX,chromeY};"
        )

    def _hover_script(self, locator: Locator) -> str:
        lookup = self._element_lookup(locator)
        return (
            f"const el={lookup}; if(!el) return false; el.scrollIntoView({{block:'center',inline:'center'}});"
            "el.focus({preventScroll:true});const rect=el.getBoundingClientRect();"
            "const init={bubbles:true,cancelable:true,composed:true,clientX:rect.left+rect.width/2,"
            "clientY:rect.top+rect.height/2,button:0,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true};"
            "for(const type of ['pointerover','pointerenter','pointermove','mouseover','mouseenter','mousemove']){"
            "const EventClass=type.startsWith('pointer')&&window.PointerEvent?PointerEvent:MouseEvent;"
            "el.dispatchEvent(new EventClass(type,init));}return true;"
        )

    def _fill_script(self, locator: Locator, value: str) -> str:
        lookup = self._element_lookup(locator)
        encoded = json.dumps(value)
        return (
            f"const el={lookup}; if(!el) return false; const value={encoded}; el.focus();"
            "if(el.isContentEditable){const preserved=Array.from(el.querySelectorAll("
            "\"[contenteditable=false][data-inline-selection-pill],[contenteditable=false][data-system-hint-type]\"))"
            ".map(node=>node.cloneNode(true));const selection=window.getSelection(),range=document.createRange();"
            "if(preserved.length){el.textContent='';const block=document.createElement('p');"
            "for(const node of preserved){block.appendChild(node);block.appendChild(document.createTextNode(' '));}"
            "el.appendChild(block);range.setStart(block,block.childNodes.length);range.collapse(true);}"
            "else{range.selectNodeContents(el);}selection.removeAllRanges();selection.addRange(range);"
            "let inserted=false;try{inserted=document.execCommand('insertText',false,value);}catch(_error){}"
            "if(!inserted){if(preserved.length){el.appendChild(document.createTextNode(value));}else{el.textContent=value;}"
            "el.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));}}"
            "else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;"
            "const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,value);else el.value=value;"
            "el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}return true;"
        )

    def _value_matches_script(self, locator: Locator, value: str) -> str:
        lookup = self._element_lookup(locator)
        encoded = json.dumps(value)
        return (
            f"const el={lookup},expected={encoded};if(!el)return false;"
            "const normalize=value=>String(value??'').replace(/\\r\\n?/g,'\\n').replace(/\\u00a0/g,' ')"
            ".replace(/[\\u200b\\u200c\\u200d\\ufeff]/g,'').replace(/[ \\t]+\\n/g,'\\n')"
            ".replace(/\\n[ \\t]+/g,'\\n').replace(/\\n+$/g,'').trim();"
            "const contentText=target=>{if(!target.isContentEditable)return target.value||'';"
            "const clone=target.cloneNode(true);clone.querySelectorAll('[data-inline-selection-pill],[data-system-hint-type]')"
            ".forEach(node=>node.remove());return clone.innerText||clone.textContent||'';};const actual=contentText(el);"
            "return normalize(actual)===normalize(expected);"
        )

    @staticmethod
    def _normalize_origin(value: str) -> str:
        parsed = urlparse(value if "://" in value else f"https://{value}")
        return (parsed.hostname or value).lower().removeprefix("www.")

    @classmethod
    def _url_matches_origin(cls, url: str, origin: str) -> bool:
        try:
            host = (urlparse(url).hostname or "").lower().removeprefix("www.")
        except ValueError:
            return False
        return host == origin or host.endswith(f".{origin}")

    @classmethod
    def _workspace_window(
        cls, windows: tuple[SafariWindowInfo, ...], expected_origin: str
    ) -> SafariWindowInfo | None:
        title = cls._workspace_title(expected_origin)
        marker_url_prefix = cls._workspace_url_prefix(expected_origin)
        for window in windows:
            if any(tab.title == title or tab.url.startswith(marker_url_prefix) for tab in window.tabs):
                return window
        return None

    @classmethod
    def _workspace_title(cls, expected_origin: str) -> str:
        return f"{cls.WORKSPACE_TITLE_PREFIX}: {expected_origin}"

    @classmethod
    def _workspace_url_prefix(cls, expected_origin: str) -> str:
        return "data:text/html;charset=utf-8," + quote(
            f"<!doctype html><title>{cls._workspace_title(expected_origin)}</title>"
        )

    @classmethod
    def _workspace_url(cls, expected_origin: str) -> str:
        title = cls._workspace_title(expected_origin)
        html = (
            "<!doctype html>"
            f"<title>{title}</title>"
            f"<body><h1>{title}</h1><p>Reserved for Safari RPA automation.</p></body>"
        )
        return "data:text/html;charset=utf-8," + quote(html)

    @staticmethod
    def _state_dict(state: PageState | None) -> dict[str, str] | None:
        if state is None:
            return None
        return {"url": state.url, "title": state.title, "ready_state": state.ready_state}
