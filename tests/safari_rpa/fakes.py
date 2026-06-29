from __future__ import annotations

from typing import Any


class UnusedSafari:
    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"Unexpected Safari call in test: {name}")
