from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import yaml

from safari_rpa.contracts.errors import RpaError


def load_mapping(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    value = yaml.safe_load(path.expanduser().read_text(encoding="utf-8"))
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RpaError("INVALID_CONFIG", "Configuration root must be an object")
    return value


def load_input(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    expanded = path.expanduser()
    if expanded.suffix.lower() == ".csv":
        with expanded.open("r", encoding="utf-8-sig", newline="") as handle:
            return {"items": list(csv.DictReader(handle))}
    return load_mapping(expanded)
