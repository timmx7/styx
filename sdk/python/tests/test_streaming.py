"""Tests for SSE streaming support."""

from __future__ import annotations

import httpx
import pytest
import respx

from styx import Styx, AsyncStyx
from styx.streaming import SSEStream, _parse_sse_line
from styx.types import ChatCompletionChunk

from .conftest import STYX_HEADERS, SSE_CHUNKS, make_sse_body


# =====================================================================
# SSE line parsing
# =====================================================================


class TestSSELineParsing:
    """Test the low-level SSE line parser."""

    def test_data_line(self):
        assert _parse_sse_line('data: {"id":"abc"}') == '{"id":"abc"}'

    def test_data_line_no_space(self):
        assert _parse_sse_line('data:{"id":"abc"}') == '{"id":"abc"}'

    def test_done_sentinel(self):
        assert _parse_sse_line("data: [DONE]") is None

    def test_empty_line(self):
        assert _parse_sse_line("") is None

    def test_comment_line(self):
        assert _parse_sse_line(": keep-alive") is None

    def test_whitespace_line(self):
        assert _parse_sse_line("   ") is None

    def test_non_data_line(self):
        assert _parse_sse_line("event: message") is None


# =====================================================================
# Streaming (Sync)
# =====================================================================


class TestStreamingSync:
    """Test synchronous SSE streaming."""

    @respx.mock
    def test_streaming_chat_completion(self):
        body = make_sse_body(SSE_CHUNKS)
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                content=body.encode(),
                headers={
                    **STYX_HEADERS,
                    "content-type": "text/event-stream",
                },
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            stream = client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
                stream=True,
            )

            chunks: list[ChatCompletionChunk] = list(stream)

        assert len(chunks) == 3
        assert chunks[0].choices[0].delta.role == "assistant"
        assert chunks[1].choices[0].delta.content == "Hello"
        assert chunks[2].choices[0].delta.content == "!"
        assert chunks[2].choices[0].finish_reason == "stop"


    @respx.mock
    def test_stream_context_manager(self):
        body = make_sse_body(SSE_CHUNKS)
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                content=body.encode(),
                headers={
                    **STYX_HEADERS,
                    "content-type": "text/event-stream",
                },
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            stream = client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Say hi"}],
                stream=True,
            )
            with stream:
                collected = "".join(
                    c.choices[0].delta.content or ""
                    for c in stream
                )

        assert collected == "Hello!"

    @respx.mock
    def test_empty_stream(self):
        body = "data: [DONE]\n\n"
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                content=body.encode(),
                headers={"content-type": "text/event-stream"},
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            stream = client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
                stream=True,
            )
            chunks = list(stream)

        assert chunks == []


# =====================================================================
# Streaming (Async)
# =====================================================================


class TestStreamingAsync:
    """Test asynchronous SSE streaming."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_streaming(self):
        body = make_sse_body(SSE_CHUNKS)
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                content=body.encode(),
                headers={
                    **STYX_HEADERS,
                    "content-type": "text/event-stream",
                },
            )
        )

        async with AsyncStyx(api_key="sk_styx_test") as client:
            stream = await client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
                stream=True,
            )

            chunks: list[ChatCompletionChunk] = []
            async for chunk in stream:
                chunks.append(chunk)

        assert len(chunks) == 3
        assert chunks[1].choices[0].delta.content == "Hello"
