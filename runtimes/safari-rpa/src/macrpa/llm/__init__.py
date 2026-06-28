"""Compatibility shim for the independent ``promptloom`` package."""

from promptloom import PromptLoomError, PromptLoomErrorKind, LmStudioClient, LmStudioConfig

__all__ = ["PromptLoomError", "PromptLoomErrorKind", "LmStudioClient", "LmStudioConfig"]
