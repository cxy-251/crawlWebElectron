from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ErrorKind(StrEnum):
    RETRYABLE = "retryable"
    PERMANENT = "permanent"
    BLOCKED_AUTH = "blocked_auth"
    BLOCKED_RISK = "blocked_risk"
    UNKNOWN_SIDE_EFFECT = "unknown_side_effect"
    CANCELLED = "cancelled"


@dataclass(slots=True)
class RpaError(Exception):
    code: str
    message: str
    kind: ErrorKind = ErrorKind.PERMANENT
    details: dict[str, object] | None = None

    def __str__(self) -> str:
        return f"{self.code}: {self.message}"


class SafariUnavailableError(RpaError):
    def __init__(self, message: str, details: dict[str, object] | None = None):
        super().__init__("SAFARI_UNAVAILABLE", message, ErrorKind.BLOCKED_AUTH, details)


class PageLostError(RpaError):
    def __init__(self, message: str, details: dict[str, object] | None = None):
        super().__init__("PAGE_LOST", message, ErrorKind.RETRYABLE, details)


class WaitTimeoutError(RpaError):
    def __init__(self, message: str, details: dict[str, object] | None = None):
        super().__init__("WAIT_TIMEOUT", message, ErrorKind.RETRYABLE, details)


class UnknownSideEffectError(RpaError):
    def __init__(self, message: str, details: dict[str, object] | None = None):
        super().__init__("UNKNOWN_SIDE_EFFECT", message, ErrorKind.UNKNOWN_SIDE_EFFECT, details)
