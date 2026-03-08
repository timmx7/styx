"""Server-Sent Events (SSE) stream parser for Styx streaming responses.

This module provides synchronous and asynchronous iterators that parse raw
SSE byte streams into typed ``ChatCompletionChunk`` objects.
"""

from __future__ import annotations

import json
from typing import AsyncIterator, Iterator, Optional

import httpx

from styx.exceptions import StreamError
from styx.types import StyxMetadata, ChatCompletionChunk


def _parse_sse_line(line: str) -> Optional[str]:
    """Extract the ``data:`` payload from a single SSE line.

    Returns:
        The data string (without the ``data: `` prefix), or ``None`` if the
        line is a comment, empty, or the ``[DONE]`` sentinel.
    """
    line = line.strip()

    # Blank lines are SSE event delimiters -- skip.
    if not line:
        return None

    # Lines starting with ':' are SSE comments.
    if line.startswith(":"):
        return None

    if line.startswith("data:"):
        payload = line[len("data:"):].strip()
        if payload == "[DONE]":
            return None
        return payload

    return None


def _build_chunk(raw_json: str, metadata: StyxMetadata) -> ChatCompletionChunk:
    """Parse a JSON string into a ``ChatCompletionChunk`` with metadata."""
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise StreamError(
            message=f"Failed to decode streaming chunk: {exc}",
        ) from exc

    chunk = ChatCompletionChunk.model_validate(data)
    chunk.metadata = metadata
    return chunk


# ---------------------------------------------------------------------------
# Synchronous stream
# ---------------------------------------------------------------------------


class SSEStream:
    """Synchronous iterator over an httpx streaming response.

    Yields ``ChatCompletionChunk`` objects parsed from the SSE stream.
    The iterator also exposes Styx metadata extracted from the response
    headers.

    Usage::

        with httpx.stream("POST", url, ...) as resp:
            for chunk in SSEStream(resp):
                print(chunk.choices[0].delta.content)
    """

    def __init__(self, response: httpx.Response) -> None:
        self._response = response
        self._metadata = _extract_metadata(response)

    @property
    def metadata(self) -> StyxMetadata:
        """Styx metadata extracted from the response headers."""
        return self._metadata

    # -- Iterator protocol ---------------------------------------------------

    def __iter__(self) -> Iterator[ChatCompletionChunk]:
        return self._iter_chunks()

    def _iter_chunks(self) -> Iterator[ChatCompletionChunk]:
        """Iterate over SSE lines and yield parsed chunks."""
        buffer = ""
        for text in self._response.iter_text():
            buffer += text
            buffer = buffer.replace('\r\n', '\n').replace('\r', '\n')
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                payload = _parse_sse_line(line)
                if payload is not None:
                    yield _build_chunk(payload, self._metadata)

        # Flush any remaining data in the buffer.
        if buffer.strip():
            payload = _parse_sse_line(buffer)
            if payload is not None:
                yield _build_chunk(payload, self._metadata)

    # -- Context manager (optional) -----------------------------------------

    def __enter__(self) -> "SSEStream":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP response."""
        self._response.close()


# ---------------------------------------------------------------------------
# Asynchronous stream
# ---------------------------------------------------------------------------


class AsyncSSEStream:
    """Asynchronous iterator over an httpx async streaming response.

    Yields ``ChatCompletionChunk`` objects parsed from the SSE stream.

    Usage::

        async with httpx.AsyncClient().stream("POST", url, ...) as resp:
            async for chunk in AsyncSSEStream(resp):
                print(chunk.choices[0].delta.content)
    """

    def __init__(self, response: httpx.Response) -> None:
        self._response = response
        self._metadata = _extract_metadata(response)

    @property
    def metadata(self) -> StyxMetadata:
        """Styx metadata extracted from the response headers."""
        return self._metadata

    # -- Async iterator protocol --------------------------------------------

    def __aiter__(self) -> AsyncIterator[ChatCompletionChunk]:
        return self._iter_chunks()

    async def _iter_chunks(self) -> AsyncIterator[ChatCompletionChunk]:
        """Asynchronously iterate over SSE lines and yield parsed chunks."""
        buffer = ""
        async for text in self._response.aiter_text():
            buffer += text
            buffer = buffer.replace('\r\n', '\n').replace('\r', '\n')
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                payload = _parse_sse_line(line)
                if payload is not None:
                    yield _build_chunk(payload, self._metadata)

        # Flush remaining buffer.
        if buffer.strip():
            payload = _parse_sse_line(buffer)
            if payload is not None:
                yield _build_chunk(payload, self._metadata)

    # -- Async context manager ----------------------------------------------

    async def __aenter__(self) -> "AsyncSSEStream":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Close the underlying HTTP response."""
        await self._response.aclose()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_metadata(response: httpx.Response) -> StyxMetadata:
    """Build an ``StyxMetadata`` from response headers."""
    headers = response.headers

    cache_header = headers.get("x-styx-cache")
    cache_hit: Optional[bool] = None
    if cache_header is not None:
        cache_hit = cache_header.lower() in ("true", "hit", "1")

    latency_raw = headers.get("x-styx-latency-ms")
    latency_ms: Optional[int] = None
    if latency_raw is not None:
        try:
            latency_ms = int(latency_raw)
        except (ValueError, TypeError):
            pass

    return StyxMetadata(
        provider=headers.get("x-styx-provider"),
        cache_hit=cache_hit,
        latency_ms=latency_ms,
        complexity=headers.get("x-styx-complexity"),
        request_id=headers.get("x-styx-request-id"),
    )
