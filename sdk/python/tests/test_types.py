"""Tests for Pydantic models and exception hierarchy."""

from __future__ import annotations

import pytest

from styx.exceptions import (
    StyxError,
    AuthenticationError,
    BadRequestError,
    BudgetExceededError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    StreamError,
    raise_for_status,
)
from styx.types import (
    StyxMetadata,
    ChatCompletion,
    ChatCompletionChunk,
    ChatMessage,
    DeltaMessage,
    Embedding,
    EmbeddingResponse,
    Model,
    ModelList,
    ToolCall,
    Usage,
)


# =====================================================================
# Pydantic models
# =====================================================================


class TestChatCompletionModel:
    """Test ChatCompletion Pydantic model."""

    def test_parse_minimal(self):
        data = {
            "id": "test-1",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hi"},
                    "finish_reason": "stop",
                }
            ],
        }
        obj = ChatCompletion.model_validate(data)
        assert obj.id == "test-1"
        assert obj.model == "gpt-4"
        assert obj.choices[0].message.content == "Hi"

    def test_parse_with_usage(self):
        data = {
            "id": "test-2",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
        }
        obj = ChatCompletion.model_validate(data)
        assert obj.usage is not None
        assert obj.usage.total_tokens == 8

    def test_parse_with_tool_calls(self):
        data = {
            "id": "test-3",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "get_weather",
                                    "arguments": '{"city": "Paris"}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
        }
        obj = ChatCompletion.model_validate(data)
        assert obj.choices[0].message.tool_calls is not None
        assert len(obj.choices[0].message.tool_calls) == 1
        assert obj.choices[0].message.tool_calls[0].function.name == "get_weather"

    def test_extra_fields_allowed(self):
        """OpenAI may add new fields — we should accept them."""
        data = {
            "id": "test-4",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hi"},
                    "finish_reason": "stop",
                }
            ],
            "new_field": "should not raise",
        }
        obj = ChatCompletion.model_validate(data)
        assert obj.id == "test-4"

    def test_default_metadata(self):
        data = {
            "id": "test-5",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [],
        }
        obj = ChatCompletion.model_validate(data)
        assert obj.metadata.provider is None


class TestStreamingModels:
    """Test ChatCompletionChunk and DeltaMessage models."""

    def test_parse_chunk(self):
        data = {
            "id": "chunk-1",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": "Hello"},
                    "finish_reason": None,
                }
            ],
        }
        chunk = ChatCompletionChunk.model_validate(data)
        assert chunk.choices[0].delta.content == "Hello"
        assert chunk.choices[0].finish_reason is None

    def test_delta_message_partial(self):
        delta = DeltaMessage(content="world")
        assert delta.content == "world"
        assert delta.role is None


class TestEmbeddingModels:
    """Test embedding-related models."""

    def test_parse_embedding(self):
        data = {
            "object": "list",
            "data": [
                {"object": "embedding", "index": 0, "embedding": [0.1, 0.2, 0.3]},
            ],
            "model": "text-embedding-3-small",
            "usage": {"prompt_tokens": 3, "total_tokens": 3},
        }
        resp = EmbeddingResponse.model_validate(data)
        assert len(resp.data) == 1
        assert resp.data[0].embedding == [0.1, 0.2, 0.3]
        assert resp.model == "text-embedding-3-small"


class TestModelList:
    """Test ModelList model."""

    def test_parse_model_list(self):
        data = {
            "object": "list",
            "data": [
                {"id": "gpt-4", "object": "model"},
                {"id": "claude-3", "object": "model"},
            ],
        }
        models = ModelList.model_validate(data)
        assert len(models.data) == 2


class TestStyxMetadata:
    """Test StyxMetadata model."""

    def test_defaults(self):
        meta = StyxMetadata()
        assert meta.provider is None
        assert meta.cache_hit is None
        assert meta.latency_ms is None
        assert meta.complexity is None
        assert meta.request_id is None

    def test_full_metadata(self):
        meta = StyxMetadata(
            provider="anthropic",
            cache_hit=True,
            latency_ms=150,
            complexity="complex",
            request_id="req_abc",
        )
        assert meta.provider == "anthropic"
        assert meta.cache_hit is True


# =====================================================================
# Exception hierarchy
# =====================================================================


class TestExceptionHierarchy:
    """Test exception classes and inheritance."""

    def test_all_exceptions_inherit_from_base(self):
        exceptions = [
            AuthenticationError,
            BadRequestError,
            BudgetExceededError,
            InternalServerError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
            StreamError,
        ]
        for exc_cls in exceptions:
            assert issubclass(exc_cls, StyxError)

    def test_exception_attributes(self):
        exc = StyxError(
            "test",
            status_code=500,
            body={"error": "oops"},
            request_id="req_123",
        )
        assert exc.message == "test"
        assert exc.status_code == 500
        assert exc.body == {"error": "oops"}
        assert exc.request_id == "req_123"

    def test_exception_repr(self):
        exc = AuthenticationError(
            status_code=401,
            request_id="req_abc",
        )
        r = repr(exc)
        assert "AuthenticationError" in r
        assert "401" in r
        assert "req_abc" in r

    def test_rate_limit_retry_after(self):
        exc = RateLimitError(retry_after=2.5)
        assert exc.retry_after == 2.5


class TestRaiseForStatus:
    """Test the raise_for_status helper."""

    def test_2xx_does_not_raise(self):
        raise_for_status(200)
        raise_for_status(201)
        raise_for_status(204)

    def test_400_raises_bad_request(self):
        with pytest.raises(BadRequestError):
            raise_for_status(400)

    def test_401_raises_auth_error(self):
        with pytest.raises(AuthenticationError):
            raise_for_status(401)

    def test_402_raises_budget(self):
        with pytest.raises(BudgetExceededError):
            raise_for_status(402)

    def test_403_raises_permission(self):
        with pytest.raises(PermissionDeniedError):
            raise_for_status(403)

    def test_404_raises_not_found(self):
        with pytest.raises(NotFoundError):
            raise_for_status(404)

    def test_429_raises_rate_limit(self):
        with pytest.raises(RateLimitError):
            raise_for_status(429)

    def test_500_raises_internal(self):
        with pytest.raises(InternalServerError):
            raise_for_status(500)

    def test_unknown_status_raises_base(self):
        with pytest.raises(StyxError):
            raise_for_status(418)

    def test_extracts_error_message(self):
        with pytest.raises(StyxError, match="custom error msg"):
            raise_for_status(
                500,
                body={"error": {"message": "custom error msg"}},
            )

    def test_extracts_string_error(self):
        with pytest.raises(StyxError, match="string error"):
            raise_for_status(
                500,
                body={"error": "string error"},
            )
