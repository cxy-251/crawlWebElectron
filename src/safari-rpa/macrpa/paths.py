from __future__ import annotations

from pathlib import Path


def repository_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "package.json").is_file() and (parent / "src").is_dir():
            return parent
    return current.parents[3]


def source_root() -> Path:
    return Path(__file__).resolve().parents[1]


def config_root() -> Path:
    return repository_root() / "local-api-usage" / "safari-rpa" / "configs"


def default_config_path(name: str) -> Path:
    return config_root() / name
