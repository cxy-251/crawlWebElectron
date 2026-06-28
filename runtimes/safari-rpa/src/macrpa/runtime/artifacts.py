from __future__ import annotations

import asyncio
import fcntl
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any


class ArtifactFiles:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def run_directory(self, run_id: str) -> Path:
        directory = self.root / "runs" / self._safe_name(run_id)
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def write_json(self, run_id: str, name: str, value: Any) -> Path:
        destination = self.run_directory(run_id) / self._safe_name(name)
        if destination.suffix.lower() != ".json":
            destination = destination.with_suffix(".json")
        self._atomic_write(destination, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8"))
        return destination

    def write_text(self, run_id: str, name: str, value: str) -> Path:
        destination = self.run_directory(run_id) / self._safe_name(name)
        self._atomic_write(destination, value.encode("utf-8"))
        return destination

    def write_daily_report(self, category: str, report_date: str, value: str) -> Path:
        category_name = self._safe_name(category)
        date_name = self._safe_name(report_date)
        destination = self.root / "reports" / category_name / f"{date_name}.csv"
        lock_path = self.root / "locks" / f"report-{category_name}-{date_name}.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                self._atomic_write(destination, value.encode("utf-8"))
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        return destination

    def write_period_report(
        self,
        category: str,
        scope_key: str,
        period_key: str,
        name: str,
        value: str,
    ) -> Path:
        category_name = self._safe_name(category)
        scope_name = self._safe_name(scope_key)
        period_name = self._safe_name(period_key)
        file_name = self._safe_name(name)
        destination = self.root / "reports" / category_name / scope_name / period_name / file_name
        lock_path = self.root / "locks" / f"report-{category_name}-{scope_name}-{period_name}.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                self._atomic_write(destination, value.encode("utf-8"))
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        return destination

    def move_into_run(self, run_id: str, source: str | Path, preferred_name: str | None = None) -> Path:
        source_path = Path(source).expanduser().resolve()
        name = self._safe_name(preferred_name or source_path.name)
        destination = self.run_directory(run_id) / name
        if destination.exists():
            destination = destination.with_name(f"{destination.stem}-{int(time.time())}{destination.suffix}")
        shutil.move(str(source_path), destination)
        return destination

    @staticmethod
    def directory_snapshot(directory: str | Path) -> dict[str, tuple[int, int]]:
        root = Path(directory).expanduser()
        if not root.exists():
            return {}
        return {
            str(path.resolve()): (path.stat().st_size, path.stat().st_mtime_ns)
            for path in root.iterdir()
            if path.is_file()
        }

    async def wait_for_stable_new_file(
        self,
        directory: str | Path,
        baseline: dict[str, tuple[int, int]],
        *,
        timeout: float = 90,
        poll_interval: float = 1,
        allowed_suffixes: tuple[str, ...] = (),
    ) -> Path:
        root = Path(directory).expanduser()
        deadline = time.monotonic() + timeout
        stable: dict[str, tuple[int, int]] = {}
        while time.monotonic() < deadline:
            snapshot = self.directory_snapshot(root)
            candidates = []
            for path_value, state in snapshot.items():
                path = Path(path_value)
                if path_value in baseline and baseline[path_value] == state:
                    continue
                if path.suffix.lower() in {".download", ".part", ".crdownload", ".tmp"}:
                    continue
                if allowed_suffixes and path.suffix.lower() not in {suffix.lower() for suffix in allowed_suffixes}:
                    continue
                if state[0] <= 0:
                    continue
                if stable.get(path_value) == state:
                    candidates.append(path)
                stable[path_value] = state
            if candidates:
                return max(candidates, key=lambda path: path.stat().st_mtime_ns)
            await asyncio.sleep(poll_interval)
        raise TimeoutError(f"No stable new file appeared in {root}")

    @staticmethod
    def _atomic_write(destination: Path, data: bytes) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(data)
        os.replace(temporary, destination)

    @staticmethod
    def _safe_name(value: str) -> str:
        safe = "".join(character if character.isalnum() or character in "-_." else "_" for character in value)
        return safe.strip("._") or "artifact"
