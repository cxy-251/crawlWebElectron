from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from macrpa.runtime import ArtifactFiles


class ArtifactTests(unittest.IsolatedAsyncioTestCase):
    async def test_waits_until_new_file_size_is_stable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = ArtifactFiles(root / "var")
            baseline = files.directory_snapshot(root)

            async def produce() -> None:
                await asyncio.sleep(0.02)
                target = root / "result.md"
                target.write_text("partial", encoding="utf-8")
                await asyncio.sleep(0.02)
                target.write_text("complete result", encoding="utf-8")

            producer = asyncio.create_task(produce())
            result = await files.wait_for_stable_new_file(
                root,
                baseline,
                timeout=1,
                poll_interval=0.03,
                allowed_suffixes=(".md",),
            )
            await producer
            self.assertEqual("complete result", result.read_text(encoding="utf-8"))
