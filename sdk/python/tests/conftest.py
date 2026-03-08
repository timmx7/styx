"""Shared fixtures for Styx SDK tests."""

import json
from typing import Any

import httpx
import pytest
import respx

# ── Sample API responses ──────────────────────────────────────────────

CHAT_COMPLETION_RESPONSE: dict[str, Any] = {
    "id": "chatcmpl-abc123",
    "object": "chat.completion",
    "created": 1700000000,
    "model": "gpt-4",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "Hello! How can I help you today?",
            },
            "finish_reason": "stop",
        }
    ],
    "usage": {
        "prompt_tokens": 10,
        "completion_tokens": 8,
        "total_tokens": 18,
    },
}

EMBEDDING_RESPONSE: dict[str, Any] = {
    "object": "list",
    "data": [
        {
            "object": "embedding",
            "index": 0,
            "embedding": [0.001, -0.002, 0.003],
        }
    ],
    "model": "text-embedding-3-small",
    "usage": {
        "prompt_tokens": 5,
        "total_tokens": 5,
    },
}

MODEL_LIST_RESPONSE: dict[str, Any] = {
    "object": "list",
    "data": [
        {"id": "gpt-4", "object": "model", "created": 1700000000, "owned_by": "openai"},
        {"id": "gpt-3.5-turbo", "object": "model", "created": 1699000000, "owned_by": "openai"},
        {"id": "claude-3-opus", "object": "model", "created": 1700000000, "owned_by": "anthropic"},
    ],
}

STYX_HEADERS = {
    "x-styx-provider": "openai",
    "x-styx-cache": "miss",
    "x-styx-latency-ms": "42",
    "x-styx-complexity": "simple",
    "x-styx-request-id": "req_test123",
}


def make_sse_body(chunks: list[dict[str, Any]], done: bool = True) -> str:
    """Build a raw SSE response body from a list of chunk dicts."""
    lines: list[str] = []
    for chunk in chunks:
        lines.append(f"data: {json.dumps(chunk)}\n\n")
    if done:
        lines.append("data: [DONE]\n\n")
    return "".join(lines)


SSE_CHUNKS = [
    {
        "id": "chatcmpl-stream1",
        "object": "chat.completion.chunk",
        "created": 1700000000,
        "model": "gpt-4",
        "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}],
    },
    {
        "id": "chatcmpl-stream1",
        "object": "chat.completion.chunk",
        "created": 1700000000,
        "model": "gpt-4",
        "choices": [{"index": 0, "delta": {"content": "Hello"}, "finish_reason": None}],
    },
    {
        "id": "chatcmpl-stream1",
        "object": "chat.completion.chunk",
        "created": 1700000000,
        "model": "gpt-4",
        "choices": [{"index": 0, "delta": {"content": "!"}, "finish_reason": "stop"}],
    },
]
