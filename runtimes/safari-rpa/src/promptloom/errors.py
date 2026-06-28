from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from promptloom.types import JsonObject


class PromptLoomErrorKind(StrEnum):
    RETRYABLE = "retryable"
    PERMANENT = "permanent"


@dataclass
class PromptLoomError(Exception):
    code: str
    message: str
    kind: PromptLoomErrorKind = PromptLoomErrorKind.PERMANENT
    details: JsonObject | None = None

    def __str__(self) -> str:
        return f"{self.code}: {self.message}"
