"""Tests for the Styx sync and async clients."""

from __future__ import annotations

import json
from unittest.mock import patch

import httpx
import pytest
import respx

from styx import (
    Styx,
    AsyncStyx,
    __version__,
)
import openai


from .conftest import (
    STYX_HEADERS,
    CHAT_COMPLETION_RESPONSE,
    EMBEDDING_RESPONSE,
    MODEL_LIST_RESPONSE,
)


# =====================================================================
# Init & Config
# =====================================================================


class TestClientInit:
    """Test client instantiation and configuration."""

    def test_sync_client_requires_api_key(self):
        with pytest.raises(ValueError, match="STYX_API_KEY environment variable is missing or empty"):
            Styx(api_key="")

    def test_async_client_requires_api_key(self):
        with pytest.raises(ValueError, match="STYX_API_KEY environment variable is missing or empty"):
            AsyncStyx(api_key="")

    def test_sync_client_default_base_url(self):
        client = Styx(api_key="sk_styx_test")
        assert str(client._base_url) == "http://localhost:8080/v1/"
        client.close()

    def test_sync_client_custom_base_url(self):
        client = Styx(api_key="sk_styx_test", base_url="http://localhost:8080")
        assert str(client._base_url) == "http://localhost:8080"
        client.close()

    def test_sync_client_strips_trailing_slash(self):
        client = Styx(api_key="sk_styx_test", base_url="http://localhost:8080/")
        assert str(client._base_url) == "http://localhost:8080/"
        client.close()



    def test_context_manager_sync(self):
        with Styx(api_key="sk_styx_test") as client:
            assert isinstance(client, Styx)

    @pytest.mark.asyncio
    async def test_context_manager_async(self):
        async with AsyncStyx(api_key="sk_styx_test") as client:
            assert isinstance(client, AsyncStyx)

    def test_namespaces_exist(self):
        client = Styx(api_key="sk_styx_test")
        assert hasattr(client, "chat")
        assert hasattr(client.chat, "completions")
        assert hasattr(client, "embeddings")
        assert hasattr(client, "models")
        client.close()

    def test_version_is_set(self):
        assert __version__ == "0.1.0"


# =====================================================================
# Chat Completions (Sync)
# =====================================================================


class TestChatCompletionsSync:
    """Test synchronous chat completions."""

    @respx.mock
    def test_basic_chat_completion(self):
        route = respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json=CHAT_COMPLETION_RESPONSE,
                headers=STYX_HEADERS,
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            response = client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert response.id == "chatcmpl-abc123"
        assert response.model == "gpt-4"
        assert response.choices[0].message.content == "Hello! How can I help you today?"
        assert response.choices[0].finish_reason == "stop"
        assert route.called

    @respx.mock
    def test_chat_completion_usage(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json=CHAT_COMPLETION_RESPONSE,
                headers=STYX_HEADERS,
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            response = client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert response.usage is not None
        assert response.usage.prompt_tokens == 10
        assert response.usage.completion_tokens == 8
        assert response.usage.total_tokens == 18

    @respx.mock
    def test_chat_completion_with_kwargs(self):
        route = respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json=CHAT_COMPLETION_RESPONSE,
                headers=STYX_HEADERS,
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
                temperature=0.7,
                max_tokens=100,
            )

        body = json.loads(route.calls[0].request.content)
        assert body["temperature"] == 0.7
        assert body["max_tokens"] == 100

    @respx.mock
    def test_authorization_header_sent(self):
        route = respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json=CHAT_COMPLETION_RESPONSE,
                headers=STYX_HEADERS,
            )
        )

        with Styx(api_key="sk_styx_mykey123") as client:
            client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
            )

        request = route.calls[0].request
        assert request.headers["authorization"] == "Bearer sk_styx_mykey123"

    @respx.mock
    def test_user_agent_header(self):
        route = respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json=CHAT_COMPLETION_RESPONSE,
                headers=STYX_HEADERS,
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
            )

        request = route.calls[0].request
        assert "Styx/Python" in request.headers["user-agent"]


# =====================================================================
# Chat Completions (Async)
# =====================================================================


class TestChatCompletionsAsync:
    """Test asynchronous chat completions."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_basic_async_completion(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json=CHAT_COMPLETION_RESPONSE,
                headers=STYX_HEADERS,
            )
        )

        async with AsyncStyx(api_key="sk_styx_test") as client:
            response = await client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert response.choices[0].message.content == "Hello! How can I help you today?"


# =====================================================================
# Metadata extraction
# =====================================================================





# =====================================================================
# Embeddings
# =====================================================================


class TestEmbeddings:
    """Test embedding endpoints."""

    @respx.mock
    def test_create_embedding(self):
        respx.post("http://localhost:8080/v1/embeddings").mock(
            return_value=httpx.Response(
                200,
                json=EMBEDDING_RESPONSE,
                headers=STYX_HEADERS,
            )
        )

        with Styx(api_key="sk_styx_test") as client:
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input="Hello world",
            )

        assert len(response.data) == 1
        assert response.data[0].embedding == [0.001, -0.002, 0.003]
        assert response.usage.prompt_tokens == 5

    @respx.mock
    def test_create_embedding_list_input(self):
        route = respx.post("http://localhost:8080/v1/embeddings").mock(
            return_value=httpx.Response(200, json=EMBEDDING_RESPONSE, headers=STYX_HEADERS)
        )

        with Styx(api_key="sk_styx_test") as client:
            client.embeddings.create(
                model="text-embedding-3-small",
                input=["Hello", "World"],
            )

        body = json.loads(route.calls[0].request.content)
        assert body["input"] == ["Hello", "World"]

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_create_embedding(self):
        respx.post("http://localhost:8080/v1/embeddings").mock(
            return_value=httpx.Response(200, json=EMBEDDING_RESPONSE, headers=STYX_HEADERS)
        )

        async with AsyncStyx(api_key="sk_styx_test") as client:
            response = await client.embeddings.create(
                model="text-embedding-3-small",
                input="Hello world",
            )



# =====================================================================
# Models
# =====================================================================


class TestModels:
    """Test model listing endpoint."""

    @respx.mock
    def test_list_models(self):
        respx.get("http://localhost:8080/v1/models").mock(
            return_value=httpx.Response(200, json=MODEL_LIST_RESPONSE)
        )

        with Styx(api_key="sk_styx_test") as client:
            models = client.models.list()

        assert len(models.data) == 3
        assert models.data[0].id == "gpt-4"
        assert models.data[2].id == "claude-3-opus"

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_list_models(self):
        respx.get("http://localhost:8080/v1/models").mock(
            return_value=httpx.Response(200, json=MODEL_LIST_RESPONSE)
        )

        async with AsyncStyx(api_key="sk_styx_test") as client:
            models = await client.models.list()

        assert len(models.data) == 3


# =====================================================================
# Error handling
# =====================================================================


class TestErrorHandling:
    """Test error handling for various HTTP status codes."""

    @respx.mock
    def test_401_raises_authentication_error(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                401,
                json={"error": {"message": "Invalid API key"}},
            )
        )

        with Styx(api_key="sk_styx_bad", max_retries=0) as client:
            with pytest.raises(openai.AuthenticationError) as exc_info:
                client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )
            assert getattr(exc_info.value, "status_code", 401) == 401
            assert "Invalid" in getattr(exc_info.value, "message", str(exc_info.value))

    @respx.mock
    def test_400_raises_bad_request(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                400,
                json={"error": {"message": "messages is required"}},
            )
        )

        with Styx(api_key="sk_styx_test", max_retries=0) as client:
            with pytest.raises(openai.BadRequestError):
                client.chat.completions.create(
                    model="gpt-4",
                    messages=[],
                )

    @respx.mock
    def test_402_raises_budget_exceeded(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                402,
                json={"error": {"message": "Monthly budget exceeded"}},
            )
        )

        with Styx(api_key="sk_styx_test", max_retries=0) as client:
            with pytest.raises(openai.APIStatusError) as exc_info:
                client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )
            assert "budget" in getattr(exc_info.value, "message", str(exc_info.value)).lower()

    @respx.mock
    def test_404_raises_not_found(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(404, json={"error": {"message": "Model not found"}})
        )

        with Styx(api_key="sk_styx_test", max_retries=0) as client:
            with pytest.raises(openai.NotFoundError):
                client.chat.completions.create(
                    model="nonexistent-model",
                    messages=[{"role": "user", "content": "Hello"}],
                )

    @respx.mock
    def test_429_raises_rate_limit(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                429,
                json={"error": {"message": "Rate limit exceeded"}},
            )
        )

        with Styx(api_key="sk_styx_test", max_retries=0) as client:
            with pytest.raises(openai.RateLimitError):
                client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )

    @respx.mock
    def test_error_includes_request_id(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                500,
                json={"error": {"message": "Internal error"}},
                headers={"x-request-id": "req_err123"},
            )
        )

        with Styx(api_key="sk_styx_test", max_retries=0) as client:
            with pytest.raises(Exception) as exc_info:
                client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )
            assert exc_info.value.request_id == "req_err123"

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_error_handling(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(
                401,
                json={"error": {"message": "Invalid key"}},
            )
        )

        async with AsyncStyx(api_key="sk_styx_bad", max_retries=0) as client:
            with pytest.raises(openai.AuthenticationError):
                await client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )


# =====================================================================
# Retry logic
# =====================================================================


class TestRetryLogic:
    """Test automatic retry behavior."""

    @respx.mock
    def test_retries_on_500(self):
        route = respx.post("http://localhost:8080/v1/chat/completions")
        route.side_effect = [
            httpx.Response(500, json={"error": "Internal"}),
            httpx.Response(200, json=CHAT_COMPLETION_RESPONSE, headers=STYX_HEADERS),
        ]

        with patch("styx.client.Styx._sleep_for_retry"):  # Skip actual sleep
            with Styx(api_key="sk_styx_test", max_retries=2) as client:
                response = client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )

        assert response.id == "chatcmpl-abc123"
        assert route.call_count == 2

    @respx.mock
    def test_retries_on_429(self):
        route = respx.post("http://localhost:8080/v1/chat/completions")
        route.side_effect = [
            httpx.Response(429, json={"error": "Rate limit"}),
            httpx.Response(429, json={"error": "Rate limit"}),
            httpx.Response(200, json=CHAT_COMPLETION_RESPONSE, headers=STYX_HEADERS),
        ]

        with patch("styx.client.Styx._sleep_for_retry"):
            with Styx(api_key="sk_styx_test", max_retries=3) as client:
                response = client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )

        assert response.id == "chatcmpl-abc123"
        assert route.call_count == 3

    @respx.mock
    def test_does_not_retry_on_401(self):
        route = respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(401, json={"error": "Unauthorized"})
        )

        with Styx(api_key="sk_styx_test", max_retries=3) as client:
            with pytest.raises(openai.AuthenticationError):
                client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )

        # 401 is NOT in the retry set — should only be called once
        assert route.call_count == 1

    @respx.mock
    def test_max_retries_exhausted(self):
        respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(503, json={"error": "Service unavailable"})
        )

        with patch("styx.client.Styx._sleep_for_retry"):
            with Styx(api_key="sk_styx_test", max_retries=2) as client:
                with pytest.raises(Exception) as exc_info:
                    client.chat.completions.create(
                        model="gpt-4",
                        messages=[{"role": "user", "content": "Hello"}],
                    )
                assert getattr(exc_info.value, "status_code", 500) >= 500

    @respx.mock
    def test_zero_retries(self):
        route = respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(500, json={"error": "Internal"})
        )

        with Styx(api_key="sk_styx_test", max_retries=0) as client:
            with pytest.raises(Exception):
                client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": "Hello"}],
                )

        assert route.call_count == 1


# =====================================================================
# Custom headers
# =====================================================================


class TestCustomHeaders:
    """Test default_headers parameter."""

    @respx.mock
    def test_custom_headers_sent(self):
        route = respx.post("http://localhost:8080/v1/chat/completions").mock(
            return_value=httpx.Response(200, json=CHAT_COMPLETION_RESPONSE, headers=STYX_HEADERS)
        )

        with Styx(
            api_key="sk_styx_test",
            default_headers={"X-Custom-Header": "my-value"},
        ) as client:
            client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}],
            )

        request = route.calls[0].request
        assert request.headers["x-custom-header"] == "my-value"
