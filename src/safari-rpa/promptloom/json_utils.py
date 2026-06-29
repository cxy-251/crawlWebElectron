from __future__ import annotations

import json
import re
from typing import Any

from promptloom.errors import PromptLoomError, PromptLoomErrorKind
from promptloom.types import JsonObject


def parse_json_object(value: str) -> JsonObject:
    text = _strip_code_fence(value.strip())
    try:
        parsed: Any = json.loads(text)
    except json.JSONDecodeError as error:
        raise PromptLoomError(
            "LLM_JSON_INVALID",
            "Local model did not return parseable JSON",
            PromptLoomErrorKind.RETRYABLE,
            {"response_preview": value[:400]},
        ) from error
    if not isinstance(parsed, dict):
        raise PromptLoomError(
            "LLM_JSON_INVALID",
            "Local model JSON response is not an object",
            PromptLoomErrorKind.RETRYABLE,
            {"response_preview": value[:400]},
        )
    return parsed


def _strip_code_fence(value: str) -> str:
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", value, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1) if match else value
