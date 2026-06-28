from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass

import aiohttp

from promptloom.errors import PromptLoomError, PromptLoomErrorKind
from promptloom.json_utils import parse_json_object
from promptloom.retry import PromptLoomRetryPolicy
from promptloom.types import ChatMessage, JsonObject


@dataclass(frozen=True, slots=True)
class LmStudioConfig:
    base_url: str = "http://127.0.0.1:1234/v1"
    model: str = "local-model"
    temperature: float = 0.2
    timeout_seconds: float = 60.0
    max_tokens: int = 2048
    retries: int = 1
    batch_size: int = 5

    @classmethod
    def from_mapping(cls, value: JsonObject | None) -> LmStudioConfig:
        data = value or {}
        defaults = cls()
        return cls(
            base_url=str(data.get("base_url") or defaults.base_url),
            model=str(data.get("model") or defaults.model),
            temperature=float(data.get("temperature", defaults.temperature)),
            timeout_seconds=float(data.get("timeout_seconds", defaults.timeout_seconds)),
            max_tokens=int(data.get("max_tokens", defaults.max_tokens)),
            retries=int(data.get("retries", defaults.retries)),
            batch_size=max(1, int(data.get("batch_size", defaults.batch_size))),
        )


class LmStudioClient:
    def __init__(self, config: LmStudioConfig):
        self.config = config

    async def chat(self, messages: list[ChatMessage], *, json_mode: bool = False) -> str:
        payload: JsonObject = {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        data = await self._post_json(self._endpoint(), payload, self.config.timeout_seconds)
        try:
            return str(data["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as error:
            raise PromptLoomError(
                "LLM_RESPONSE_INVALID",
                "LM Studio returned an unexpected response shape",
                PromptLoomErrorKind.RETRYABLE,
                {"endpoint": self._redacted_endpoint(), "keys": sorted(data.keys())},
            ) from error

    async def generate_json(self, messages: list[ChatMessage]) -> JsonObject:
        retry = PromptLoomRetryPolicy(retries=self.config.retries)
        last_error: PromptLoomError | None = None
        for attempt in range(1, retry.attempts + 1):
            try:
                content = await self.chat(messages, json_mode=True)
                return parse_json_object(content)
            except PromptLoomError as error:
                last_error = error
                if attempt >= retry.attempts:
                    break
                await asyncio.sleep(retry.delay(attempt))
        assert last_error is not None
        raise last_error

    async def _post_json(self, url: str, payload: JsonObject, timeout_seconds: float) -> JsonObject:
        timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as response:
                    text = await response.text()
                    if response.status >= 500:
                        raise PromptLoomError(
                            "LLM_SERVER_ERROR",
                            "LM Studio returned a retryable server error",
                            PromptLoomErrorKind.RETRYABLE,
                            {"status": response.status, "endpoint": self._redacted_endpoint()},
                        )
                    if response.status >= 400:
                        raise PromptLoomError(
                            "LLM_REQUEST_REJECTED",
                            "LM Studio rejected the request",
                            PromptLoomErrorKind.PERMANENT,
                            {"status": response.status, "endpoint": self._redacted_endpoint(), "body_preview": text[:200]},
                        )
                    try:
                        data = json.loads(text)
                    except json.JSONDecodeError as error:
                        raise PromptLoomError(
                            "LLM_HTTP_JSON_INVALID",
                            "LM Studio returned non-JSON HTTP content",
                            PromptLoomErrorKind.RETRYABLE,
                            {"endpoint": self._redacted_endpoint(), "body_preview": text[:200]},
                        ) from error
                    if not isinstance(data, dict):
                        raise PromptLoomError(
                            "LLM_HTTP_JSON_INVALID",
                            "LM Studio returned a non-object JSON response",
                            PromptLoomErrorKind.RETRYABLE,
                            {"endpoint": self._redacted_endpoint()},
                        )
                    return data
        except TimeoutError as error:
            raise PromptLoomError(
                "LLM_TIMEOUT",
                "Timed out waiting for LM Studio",
                PromptLoomErrorKind.RETRYABLE,
                {"endpoint": self._redacted_endpoint(), "timeout_seconds": timeout_seconds},
            ) from error
        except aiohttp.ClientError as error:
            raise PromptLoomError(
                "LLM_UNAVAILABLE",
                "Could not connect to LM Studio",
                PromptLoomErrorKind.RETRYABLE,
                {"endpoint": self._redacted_endpoint(), "cause": type(error).__name__},
            ) from error

    def _endpoint(self) -> str:
        return f"{self.config.base_url.rstrip('/')}/chat/completions"

    def _redacted_endpoint(self) -> str:
        return self._endpoint()
