from __future__ import annotations

import unittest

from safari_rpa.application.llm_service import LocalLlmService
from safari_rpa.contracts.errors import RpaError
from promptloom import PromptLoomError, PromptLoomErrorKind, LmStudioClient, LmStudioConfig, WorkflowRuntime


class CapturingLmStudioClient(LmStudioClient):
    def __init__(self, config: LmStudioConfig, responses: list[str]) -> None:
        super().__init__(config)
        self.responses = responses
        self.payloads = []
        self.urls = []

    async def _post_json(self, url, payload, timeout_seconds):
        self.urls.append(url)
        self.payloads.append(payload)
        content = self.responses.pop(0)
        return {"choices": [{"message": {"content": content}}]}


class PromptLoomTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_payload_targets_lm_studio_chat_completions(self) -> None:
        client = CapturingLmStudioClient(
            LmStudioConfig(model="qwen-local", temperature=0.1, max_tokens=512),
            ['{"ok":true}'],
        )
        result = await client.generate_json([{"role": "user", "content": "return json"}])
        self.assertTrue(result["ok"])
        self.assertEqual("http://127.0.0.1:1234/v1/chat/completions", client.urls[0])
        self.assertEqual("qwen-local", client.payloads[0]["model"])
        self.assertEqual({"type": "json_object"}, client.payloads[0]["response_format"])
        self.assertEqual(0.1, client.payloads[0]["temperature"])
        self.assertEqual(512, client.payloads[0]["max_tokens"])

    async def test_generate_json_strips_code_fence_and_retries_invalid_json(self) -> None:
        client = CapturingLmStudioClient(
            LmStudioConfig(retries=1),
            ["not json", '```json\n{"results":[]}\n```'],
        )
        result = await client.generate_json([{"role": "user", "content": "clean"}])
        self.assertEqual([], result["results"])
        self.assertEqual(2, len(client.payloads))

    async def test_generate_json_reports_sanitized_invalid_response(self) -> None:
        client = CapturingLmStudioClient(LmStudioConfig(retries=0), ["not json"])
        with self.assertRaises(PromptLoomError) as raised:
            await client.generate_json([{"role": "user", "content": "clean"}])
        self.assertEqual("LLM_JSON_INVALID", raised.exception.code)
        self.assertIn("response_preview", raised.exception.details)

    async def test_prompt_clean_workflow_returns_cleaned_dropped_and_missing_results(self) -> None:
        client = CapturingLmStudioClient(
            LmStudioConfig(),
            [
                """{"results":[
                    {"id":"1","source_url":"https://x.com/a/status/1","prompt":"Use strong light.","topic":"image","quality":"high","reason":"usable","dropped":false},
                    {"id":"2","source_url":"https://x.com/a/status/2","prompt":"","topic":"daily","quality":"low","reason":"chatter","dropped":true}
                ]}"""
            ],
        )

        runtime = WorkflowRuntime(client_factory=lambda config: client)
        result = await runtime.run_workflow(
            "prompt.clean.v1",
            {
                "items": [
                    {"id": "1", "source_url": "https://x.com/a/status/1", "text": "Prompt: Use strong light."},
                    {"id": "2", "source_url": "https://x.com/a/status/2", "text": "Breakfast."},
                    {"id": "3", "source_url": "https://x.com/a/status/3", "text": "Prompt missing."},
                ]
            },
        )

        self.assertEqual(["1", "2"], [item["id"] for item in result["cleaned"]])
        self.assertFalse(result["cleaned"][0]["dropped"])
        self.assertTrue(result["cleaned"][1]["dropped"])
        self.assertEqual("3", result["failed"][0]["id"])
        self.assertEqual("LLM_RESULT_MISSING", result["failed"][0]["code"])

    async def test_application_llm_service_maps_provider_errors_to_rpa_errors(self) -> None:
        class FailingRuntime:
            async def run_workflow(self, workflow_id, input_data, runtime_options=None):
                raise PromptLoomError("LLM_TIMEOUT", "too slow", PromptLoomErrorKind.RETRYABLE, {"timeout_seconds": 1})

        with self.assertRaises(RpaError) as raised:
            await LocalLlmService(FailingRuntime()).run_workflow(
                "prompt.clean.v1",
                {"items": [{"id": "1", "text": "clean"}]},
                {"timeout_seconds": 1},
            )
        self.assertEqual("LLM_TIMEOUT", raised.exception.code)
        self.assertEqual("retryable", raised.exception.kind)
