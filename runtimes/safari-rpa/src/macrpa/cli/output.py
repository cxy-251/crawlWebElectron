from __future__ import annotations

import json
from typing import Any

from macrpa.application import jsonable


def raw(value: Any) -> None:
    print(json.dumps(jsonable(value), ensure_ascii=False, indent=2))


def success(data: Any) -> None:
    raw({"ok": True, "data": data})


def result(ok: bool, data: Any) -> None:
    raw({"ok": ok, "data": data})
