from __future__ import annotations

from typing import Any

from macrpa.contracts.safari import PageRef


def page_ref_to_dict(page: PageRef) -> dict[str, Any]:
    return {
        "session_id": page.session_id,
        "marker": page.marker,
        "expected_origin": page.expected_origin,
        "window_id": page.window_id,
        "tab_index": page.tab_index,
    }


def page_ref_from_dict(value: dict[str, Any]) -> PageRef:
    return PageRef(
        session_id=str(value["session_id"]),
        marker=str(value["marker"]),
        expected_origin=str(value["expected_origin"]),
        window_id=int(value["window_id"]),
        tab_index=int(value["tab_index"]),
    )
