from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol


class LocatorKind(StrEnum):
    CSS = "css"
    TEXT = "text"
    ARIA_LABEL = "aria_label"
    SCRIPT = "script"


@dataclass(frozen=True, slots=True)
class Locator:
    kind: LocatorKind
    value: str

    @classmethod
    def css(cls, value: str) -> Locator:
        return cls(LocatorKind.CSS, value)

    @classmethod
    def text(cls, value: str) -> Locator:
        return cls(LocatorKind.TEXT, value)

    @classmethod
    def aria(cls, value: str) -> Locator:
        return cls(LocatorKind.ARIA_LABEL, value)

    @classmethod
    def script(cls, expression: str) -> Locator:
        """Locate an element with an internal JavaScript expression.

        Site adapters use this for scoped controls whose accessible names are
        repeated. The expression is trusted application code, never API input.
        """

        return cls(LocatorKind.SCRIPT, expression)


class ConditionKind(StrEnum):
    READY = "ready"
    URL_CONTAINS = "url_contains"
    PRESENT = "present"
    ABSENT = "absent"
    TEXT_PRESENT = "text_present"
    JS_TRUTHY = "js_truthy"


@dataclass(frozen=True, slots=True)
class PageCondition:
    kind: ConditionKind
    value: str | None = None
    locator: Locator | None = None
    description: str = ""

    @classmethod
    def ready(cls) -> PageCondition:
        return cls(ConditionKind.READY, description="document is ready")

    @classmethod
    def present(cls, locator: Locator, description: str = "") -> PageCondition:
        return cls(ConditionKind.PRESENT, locator=locator, description=description)

    @classmethod
    def absent(cls, locator: Locator, description: str = "") -> PageCondition:
        return cls(ConditionKind.ABSENT, locator=locator, description=description)

    @classmethod
    def js(cls, expression: str, description: str) -> PageCondition:
        return cls(ConditionKind.JS_TRUTHY, value=expression, description=description)


@dataclass(frozen=True, slots=True)
class SafariTabInfo:
    window_id: int
    tab_index: int
    url: str
    title: str
    is_current: bool


@dataclass(frozen=True, slots=True)
class SafariWindowInfo:
    window_id: int
    index: int
    tabs: tuple[SafariTabInfo, ...]


@dataclass(frozen=True, slots=True)
class PageRef:
    session_id: str
    marker: str
    expected_origin: str
    window_id: int
    tab_index: int


@dataclass(frozen=True, slots=True)
class ElementState:
    found: bool
    visible: bool = False
    enabled: bool = False
    text: str = ""
    value: str = ""


@dataclass(frozen=True, slots=True)
class PageState:
    url: str
    title: str
    ready_state: str
    text_excerpt: str = ""


@dataclass(frozen=True, slots=True)
class ActionEvidence:
    action: str
    started_at: float
    completed_at: float
    before: PageState | None
    after: PageState
    details: dict[str, object] = field(default_factory=dict)


class SafariAutomationPort(Protocol):
    async def inspect_windows(self) -> tuple[SafariWindowInfo, ...]: ...

    async def ensure_site(self, origin: str, start_url: str, timeout: float = 30) -> PageRef: ...

    async def create_page(self, parent: PageRef, start_url: str, timeout: float = 30) -> PageRef: ...

    async def navigate(self, page: PageRef, url: str, timeout: float = 30) -> ActionEvidence: ...

    async def wait_for(self, page: PageRef, condition: PageCondition, timeout: float = 30) -> PageState: ...

    async def query(self, page: PageRef, locator: Locator) -> ElementState: ...

    async def read(self, page: PageRef, locator: Locator) -> str | None: ...

    async def click(
        self, page: PageRef, locator: Locator, postcondition: PageCondition, timeout: float = 15
    ) -> ActionEvidence: ...

    async def trusted_click(
        self, page: PageRef, locator: Locator, postcondition: PageCondition, timeout: float = 15
    ) -> ActionEvidence: ...

    async def trusted_click_relative(
        self,
        page: PageRef,
        locator: Locator,
        offset_x: float,
        offset_y: float,
        postcondition: PageCondition,
        timeout: float = 15,
    ) -> ActionEvidence: ...

    async def hover(
        self, page: PageRef, locator: Locator, postcondition: PageCondition, timeout: float = 15
    ) -> ActionEvidence: ...

    async def fill(self, page: PageRef, locator: Locator, value: str, timeout: float = 15) -> ActionEvidence: ...

    async def evaluate(self, page: PageRef, expression: str) -> object: ...

    async def snapshot(self, page: PageRef) -> PageState: ...

    async def close_page(self, page: PageRef) -> None: ...
