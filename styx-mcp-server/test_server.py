"""Unit tests for the Styx MCP server tools.

Tests mock `_api_request` directly so no live Styx backend is needed.
"""

import os
from unittest.mock import AsyncMock, patch

import pytest

# Set env vars before importing server
os.environ.update({
    "STYX_API_URL": "http://test-backend:8000",
    "STYX_PROXY_URL": "http://test-proxy:8080",
    "STYX_API_KEY": "sk-test-key",
    "STYX_TOKEN": "test-jwt-token",
})

import server  # noqa: E402


# ── Helpers ───────────────────────────────────────────────────


def _mock_api(return_value):
    """Patch server._api_request to return a given value."""
    return patch.object(
        server,
        "_api_request",
        new_callable=AsyncMock,
        return_value=return_value,
    )


def _mock_api_error(status_code: int = 500, detail: str = "Internal error"):
    """Patch server._api_request to return an error dict."""
    return _mock_api({"error": True, "status_code": status_code, "detail": detail})


# ── Test styx_send_request ────────────────────────────────────


@pytest.mark.asyncio
async def test_send_request_success():
    """styx_send_request returns formatted response on success."""
    with _mock_api({
        "choices": [{"message": {"content": "Hello from GPT!"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
        "model": "gpt-4o",
        "x-styx-provider": "openai",
    }):
        result = await server.styx_send_request(
            messages=[{"role": "user", "content": "Hi"}],
            model="gpt-4o",
        )

    assert "Hello from GPT!" in result
    assert "Provider: openai" in result
    assert "gpt-4o" in result


@pytest.mark.asyncio
async def test_send_request_no_model_no_default():
    """styx_send_request returns helpful error when no model set."""
    server._default_model = ""

    result = await server.styx_send_request(
        messages=[{"role": "user", "content": "Hi"}],
    )

    assert "No model specified" in result
    assert "styx_switch_model" in result
    assert "styx_list_models" in result


@pytest.mark.asyncio
async def test_send_request_uses_default_model():
    """styx_send_request uses _default_model when model not specified."""
    server._default_model = "claude-sonnet-4-20250514"

    with _mock_api({
        "choices": [{"message": {"content": "Hi from Claude!"}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 10},
        "model": "claude-sonnet-4-20250514",
    }) as mock:
        result = await server.styx_send_request(
            messages=[{"role": "user", "content": "Hi"}],
        )

    assert "Hi from Claude!" in result

    # Verify _api_request was called with claude model
    call_kwargs = mock.call_args.kwargs
    assert call_kwargs["json_body"]["model"] == "claude-sonnet-4-20250514"

    server._default_model = ""


@pytest.mark.asyncio
async def test_send_request_explicit_model_overrides_default():
    """Explicit model overrides default."""
    server._default_model = "gpt-4o"

    with _mock_api({
        "choices": [{"message": {"content": "Response"}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 10},
        "model": "gemini-1.5-pro",
    }) as mock:
        result = await server.styx_send_request(
            messages=[{"role": "user", "content": "Hi"}],
            model="gemini-1.5-pro",
        )

    call_kwargs = mock.call_args.kwargs
    assert call_kwargs["json_body"]["model"] == "gemini-1.5-pro"

    server._default_model = ""


@pytest.mark.asyncio
async def test_send_request_api_error():
    """styx_send_request formats error responses clearly."""
    with _mock_api_error(429, "Rate limit exceeded"):
        result = await server.styx_send_request(
            messages=[{"role": "user", "content": "Hi"}],
            model="gpt-4o",
        )

    assert "Error" in result
    assert "429" in result
    assert "Rate limit" in result


# ── Test styx_list_models ─────────────────────────────────────


@pytest.mark.asyncio
async def test_list_models_success():
    """styx_list_models returns formatted model list."""
    with _mock_api([
        {"provider": "openai", "model": "gpt-4o", "display_name": "GPT-4o",
         "input_price_per_1k_client": 0.005, "output_price_per_1k_client": 0.015},
        {"provider": "anthropic", "model": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet",
         "input_price_per_1k_client": 0.003, "output_price_per_1k_client": 0.015},
    ]):
        result = await server.styx_list_models()

    assert "gpt-4o" in result
    assert "claude-sonnet-4-20250514" in result
    assert "OPENAI" in result
    assert "ANTHROPIC" in result
    assert "Available models (2)" in result


@pytest.mark.asyncio
async def test_list_models_fallback():
    """styx_list_models returns fallback list when endpoint fails."""
    with _mock_api_error(500, "Internal error"):
        result = await server.styx_list_models()

    assert "gpt-4o" in result
    assert "pricing endpoint unavailable" in result.lower()


@pytest.mark.asyncio
async def test_list_models_shows_current_default():
    """styx_list_models shows current default model."""
    server._default_model = "gpt-4o"

    with _mock_api_error(500, "unavailable"):
        result = await server.styx_list_models()

    assert "gpt-4o" in result
    assert "Current default model:" in result

    server._default_model = ""


# ── Test styx_switch_model ────────────────────────────────────


@pytest.mark.asyncio
async def test_switch_model_success():
    """styx_switch_model sets default model."""
    server._default_model = ""

    result = await server.styx_switch_model(model="gpt-4o")

    assert server._default_model == "gpt-4o"
    assert "gpt-4o" in result
    assert "switched" in result.lower()


@pytest.mark.asyncio
async def test_switch_model_shows_previous():
    """styx_switch_model shows previous model when switching."""
    server._default_model = "gpt-4o"

    result = await server.styx_switch_model(model="claude-sonnet-4-20250514")

    assert server._default_model == "claude-sonnet-4-20250514"
    assert "gpt-4o" in result  # previous model shown
    assert "claude-sonnet-4-20250514" in result

    server._default_model = ""


@pytest.mark.asyncio
async def test_switch_model_empty_name():
    """styx_switch_model rejects empty model name."""
    server._default_model = "gpt-4o"

    result = await server.styx_switch_model(model="  ")

    assert "Error" in result
    assert server._default_model == "gpt-4o"  # unchanged

    server._default_model = ""


# ── Test styx_list_projects ───────────────────────────────────


@pytest.mark.asyncio
async def test_list_projects_success():
    """styx_list_projects returns formatted project list."""
    with _mock_api([
        {"name": "My Project", "id": "proj-1", "budget_monthly_cents": 5000, "spent_cents": 1200},
    ]):
        result = await server.styx_list_projects()

    assert "My Project" in result
    assert "proj-1" in result
    assert "$50" in result  # budget
    assert "$12.00" in result  # spent


@pytest.mark.asyncio
async def test_list_projects_empty():
    """styx_list_projects shows helpful message when no projects."""
    with _mock_api([]):
        result = await server.styx_list_projects()

    assert "No projects found" in result
    assert "styx_create_project" in result


@pytest.mark.asyncio
async def test_list_projects_api_error():
    """styx_list_projects shows error from API."""
    with _mock_api_error(401, "Unauthorized"):
        result = await server.styx_list_projects()

    assert "Error" in result
    assert "Unauthorized" in result


# ── Test styx_create_project ──────────────────────────────────


@pytest.mark.asyncio
async def test_create_project_success():
    """styx_create_project returns confirmation."""
    with _mock_api({"name": "New Proj", "id": "proj-new"}):
        result = await server.styx_create_project(
            name="New Proj", team_id="team-1", budget_monthly_cents=10000,
        )

    assert "Project created" in result
    assert "New Proj" in result
    assert "proj-new" in result
    assert "$100" in result


# ── Test styx_list_api_keys ───────────────────────────────────


@pytest.mark.asyncio
async def test_list_api_keys_success():
    """styx_list_api_keys returns formatted key list."""
    with _mock_api([
        {"name": "prod-key", "is_active": True, "key_prefix": "sk-styx-abc", "project_id": "proj-1"},
    ]):
        result = await server.styx_list_api_keys()

    assert "prod-key" in result
    assert "active" in result
    assert "sk-styx-abc" in result


@pytest.mark.asyncio
async def test_list_api_keys_empty():
    """styx_list_api_keys shows helpful message when no keys."""
    with _mock_api([]):
        result = await server.styx_list_api_keys()

    assert "No API keys found" in result
    assert "styx_create_api_key" in result


# ── Test styx_create_api_key ──────────────────────────────────


@pytest.mark.asyncio
async def test_create_api_key_success():
    """styx_create_api_key returns key and warning."""
    with _mock_api({"name": "my-key", "key": "sk-styx-full-key-here"}):
        result = await server.styx_create_api_key(project_id="proj-1", name="my-key")

    assert "API key created" in result
    assert "sk-styx-full-key-here" in result
    assert "Save this key now" in result


# ── Test styx_manage_providers ────────────────────────────────


@pytest.mark.asyncio
async def test_manage_providers_list_success():
    """styx_manage_providers list returns configured providers."""
    with _mock_api([
        {"provider": "openai", "key_preview": "sk-...abc"},
    ]):
        result = await server.styx_manage_providers(
            project_id="proj-1", action="list",
        )

    assert "openai" in result
    assert "sk-...abc" in result


@pytest.mark.asyncio
async def test_manage_providers_add_missing_params():
    """styx_manage_providers rejects add without required params."""
    result = await server.styx_manage_providers(
        project_id="proj-1",
        action="add",
        provider="",  # missing
        api_key="sk-xxx",
    )

    assert "Error" in result
    assert "required" in result.lower()


@pytest.mark.asyncio
async def test_manage_providers_unknown_action():
    """styx_manage_providers rejects unknown actions."""
    result = await server.styx_manage_providers(
        project_id="proj-1",
        action="delete-everything",
    )

    assert "Unknown action" in result


# ── Test _auth_headers / _api_key_headers ─────────────────────


def test_auth_headers_missing_token():
    """_auth_headers raises clear error when STYX_TOKEN not set."""
    original = server.STYX_TOKEN
    server.STYX_TOKEN = ""
    try:
        with pytest.raises(ValueError, match="STYX_TOKEN"):
            server._auth_headers()
    finally:
        server.STYX_TOKEN = original


def test_api_key_headers_missing_key():
    """_api_key_headers raises clear error when STYX_API_KEY not set."""
    original = server.STYX_API_KEY
    server.STYX_API_KEY = ""
    try:
        with pytest.raises(ValueError, match="STYX_API_KEY"):
            server._api_key_headers()
    finally:
        server.STYX_API_KEY = original


def test_auth_headers_success():
    """_auth_headers returns Bearer token when set."""
    headers = server._auth_headers()
    assert headers["Authorization"] == "Bearer test-jwt-token"


def test_api_key_headers_success():
    """_api_key_headers returns Bearer key when set."""
    headers = server._api_key_headers()
    assert headers["Authorization"] == "Bearer sk-test-key"
