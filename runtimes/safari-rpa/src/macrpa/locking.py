from __future__ import annotations

import asyncio
import fcntl
import time
from pathlib import Path
from types import TracebackType


class AsyncFileLock:
    """Async intra-process lock with an optional cross-process flock."""

    def __init__(self, path: str | Path | None = None, *, timeout: float | None = None) -> None:
        self.path = Path(path) if path is not None else None
        self.timeout = timeout
        self._local = asyncio.Lock()
        self._handle = None

    async def __aenter__(self) -> AsyncFileLock:
        await self._local.acquire()
        try:
            if self.path is not None:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self._handle = self.path.open("a+b")
                acquired = await asyncio.to_thread(self._acquire_file)
                if not acquired:
                    self._handle.close()
                    self._handle = None
                    raise TimeoutError(f"Lock is already held: {self.path}")
            return self
        except BaseException:
            self._local.release()
            raise

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            if self._handle is not None:
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
                self._handle.close()
                self._handle = None
        finally:
            self._local.release()

    def _acquire_file(self) -> bool:
        assert self._handle is not None
        deadline = None if self.timeout is None else time.monotonic() + self.timeout
        while True:
            try:
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except BlockingIOError:
                if deadline is not None and time.monotonic() >= deadline:
                    return False
                time.sleep(0.05)
