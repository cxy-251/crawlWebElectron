from __future__ import annotations

import json

from promptloom.providers.lmstudio import LmStudioClient
from promptloom.types import JsonObject


class PromptCleanWorkflow:
    id = "prompt.clean.v1"

    async def run(self, client: LmStudioClient, input_data: JsonObject) -> JsonObject:
        items = self._items(input_data)
        if not items:
            return {"cleaned": [], "failed": []}
        payload = await client.generate_json(
            [
                {"role": "system", "content": self._system_prompt()},
                {"role": "user", "content": json.dumps({"items": items}, ensure_ascii=False)},
            ]
        )
        return self._normalize_results(items, payload)

    @staticmethod
    def _items(input_data: JsonObject) -> list[JsonObject]:
        raw_items = input_data.get("items", [])
        if not isinstance(raw_items, list):
            return []
        items: list[JsonObject] = []
        for index, raw in enumerate(raw_items):
            if not isinstance(raw, dict):
                continue
            item_id = str(raw.get("id") or raw.get("tweet_id") or raw.get("source_id") or index).strip()
            text = str(raw.get("text") or raw.get("content") or "").strip()
            if not item_id or not text:
                continue
            items.append(
                {
                    "id": item_id,
                    "source_url": str(raw.get("source_url") or raw.get("url") or ""),
                    "text": text,
                    "context": raw.get("context") if isinstance(raw.get("context"), dict) else {},
                }
            )
        return items

    @staticmethod
    def _normalize_results(items: list[JsonObject], payload: JsonObject) -> JsonObject:
        raw_results = payload.get("results", [])
        if isinstance(raw_results, dict):
            raw_results = [raw_results]
        if not isinstance(raw_results, list):
            raw_results = []
        by_id = {
            str(item.get("id") or item.get("tweet_id") or "").strip(): item
            for item in raw_results
            if isinstance(item, dict)
        }
        cleaned: list[JsonObject] = []
        failed: list[JsonObject] = []
        for item in items:
            item_id = str(item["id"])
            result = by_id.get(item_id)
            if result is None:
                failed.append(
                    {
                        "id": item_id,
                        "source_url": item.get("source_url", ""),
                        "code": "LLM_RESULT_MISSING",
                        "message": "PromptLoom did not return a result for this item",
                    }
                )
                continue
            cleaned.append(
                {
                    "id": item_id,
                    "source_url": str(result.get("source_url") or item.get("source_url") or ""),
                    "prompt": str(result.get("prompt") or "").strip(),
                    "topic": str(result.get("topic") or "").strip(),
                    "quality": str(result.get("quality") or "medium").strip() or "medium",
                    "reason": str(result.get("reason") or "").strip(),
                    "dropped": bool(result.get("dropped")),
                }
            )
        return {"cleaned": cleaned, "failed": failed}

    @staticmethod
    def _system_prompt() -> str:
        return (
            "You are PromptLoom's local prompt-cleaning workflow. Return only a JSON object. "
            "For each input item, decide whether it contains a reusable creative or work prompt. "
            "Drop ads, casual chatter, pure links, incomplete text, and content without reusable prompt value. "
            "Preserve useful prompts in a concise, actionable form. "
            "Return {\"results\":[{\"id\":\"...\",\"source_url\":\"...\",\"prompt\":\"...\","
            "\"topic\":\"...\",\"quality\":\"high|medium|low\",\"reason\":\"...\",\"dropped\":false}]}."
        )
