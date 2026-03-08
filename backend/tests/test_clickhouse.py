"""Tests for ClickHouse service — security & functionality.

Verifies that:
1. SQL injection is structurally impossible (JSONEachRow + parameterized queries)
2. Malicious inputs are rejected at validation layer
3. Normal inputs work correctly
4. Edge cases (empty URL, timeouts) are handled gracefully
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.clickhouse_service import (
    _validate_identifier,
    insert_routing_log,
    query_analytics,
)


# ─── Identifier Validation Tests ─────────────────────────────────


class TestValidateIdentifier:
    """Test the defense-in-depth identifier validator."""

    def test_valid_project_id(self):
        assert _validate_identifier("proj_abc123", "test") == "proj_abc123"

    def test_valid_uuid(self):
        assert _validate_identifier("550e8400-e29b-41d4-a716-446655440000", "test")

    def test_valid_provider(self):
        assert _validate_identifier("openai", "test") == "openai"

    def test_valid_model_with_dots(self):
        """Model names like gpt-4o, claude-3.5-sonnet contain dots/hyphens."""
        assert _validate_identifier("gpt-4o", "test") == "gpt-4o"
        assert _validate_identifier("claude-3.5-sonnet", "test") == "claude-3.5-sonnet"

    def test_valid_model_with_colon_slash(self):
        """Azure models may contain colons/slashes."""
        assert _validate_identifier("deployment:gpt-4o", "test")
        assert _validate_identifier("org/model-v1", "test")

    def test_rejects_single_quote(self):
        """Single quote = classic SQL injection char."""
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("test'; DROP TABLE --", "field")

    def test_rejects_double_quote(self):
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier('test" OR 1=1', "field")

    def test_rejects_semicolon(self):
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("test; DROP TABLE routing_logs", "field")

    def test_rejects_parentheses(self):
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("test() OR 1=1", "field")

    def test_rejects_backslash(self):
        """Backslash can be used to escape quotes in some SQL dialects."""
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("test\\'; DROP TABLE --", "field")

    def test_rejects_spaces(self):
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("test value", "field")

    def test_rejects_newline(self):
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("test\nDROP TABLE", "field")

    def test_rejects_null_byte(self):
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("test\x00", "field")

    def test_rejects_empty_string(self):
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("", "field")

    def test_rejects_unicode_homoglyph(self):
        """Unicode characters that look like ASCII but aren't."""
        with pytest.raises(ValueError, match="disallowed characters"):
            _validate_identifier("proj＇injection", "field")  # fullwidth apostrophe


# ─── Insert Tests ─────────────────────────────────────────────────


class TestInsertRoutingLog:
    """Test that inserts use JSONEachRow (data separate from SQL)."""

    @pytest.fixture
    def mock_client(self):
        """Mock httpx client that captures request details."""
        mock = AsyncMock()
        mock.post = AsyncMock(return_value=MagicMock(status_code=200))
        mock.post.return_value.raise_for_status = MagicMock()
        return mock

    async def test_insert_success(self, mock_client):
        """Normal insert should succeed with JSONEachRow format."""
        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await insert_routing_log(
                project_id="proj_abc123",
                provider="openai",
                model="gpt-4o",
                complexity="simple",
                latency_ms=150,
                status_code=200,
                cache_hit=False,
                was_fallback=False,
                input_tokens=100,
                output_tokens=50,
                cost_cents=3,
            )

            assert result is True
            mock_client.post.assert_called_once()

            # Verify the SQL is static (no user data embedded)
            call_kwargs = mock_client.post.call_args
            query_param = call_kwargs.kwargs.get("params", {}).get("query", "")
            assert "proj_abc123" not in query_param, "Project ID must NOT be in SQL query"
            assert "openai" not in query_param, "Provider must NOT be in SQL query"
            assert "FORMAT JSONEachRow" in query_param

            # Verify data is in the JSON body (separate from SQL)
            body = call_kwargs.kwargs.get("content", "")
            data = json.loads(body)
            assert data["project_id"] == "proj_abc123"
            assert data["provider"] == "openai"
            assert data["model"] == "gpt-4o"
            assert data["cache_hit"] == 0
            assert data["cost_cents"] == 3

    async def test_insert_rejects_injection_in_project_id(self, mock_client):
        """SQL injection attempt in project_id should be rejected."""
        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await insert_routing_log(
                project_id="'; DROP TABLE styx.routing_logs; --",
                provider="openai",
                model="gpt-4o",
                complexity="simple",
                latency_ms=100,
                status_code=200,
                cache_hit=False,
                was_fallback=False,
            )

            assert result is False
            mock_client.post.assert_not_called()

    async def test_insert_rejects_injection_in_provider(self, mock_client):
        """SQL injection attempt in provider should be rejected."""
        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await insert_routing_log(
                project_id="proj_123",
                provider="openai'; SELECT * FROM system.users --",
                model="gpt-4o",
                complexity="simple",
                latency_ms=100,
                status_code=200,
                cache_hit=False,
                was_fallback=False,
            )

            assert result is False
            mock_client.post.assert_not_called()

    async def test_insert_rejects_injection_in_model(self, mock_client):
        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await insert_routing_log(
                project_id="proj_123",
                provider="openai",
                model="gpt-4o\n; DROP TABLE routing_logs",
                complexity="simple",
                latency_ms=100,
                status_code=200,
                cache_hit=False,
                was_fallback=False,
            )

            assert result is False

    async def test_insert_disabled_when_no_url(self):
        """Should gracefully return False when ClickHouse is not configured."""
        with patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = ""

            result = await insert_routing_log(
                project_id="proj_123",
                provider="openai",
                model="gpt-4o",
                complexity="simple",
                latency_ms=100,
                status_code=200,
                cache_hit=False,
                was_fallback=False,
            )
            assert result is False

    async def test_insert_handles_timeout(self, mock_client):
        """Timeout should return False, not raise."""
        import httpx as _httpx

        mock_client.post.side_effect = _httpx.TimeoutException("timed out")

        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await insert_routing_log(
                project_id="proj_123",
                provider="openai",
                model="gpt-4o",
                complexity="simple",
                latency_ms=100,
                status_code=200,
                cache_hit=False,
                was_fallback=False,
            )
            assert result is False


# ─── Query Analytics Tests ────────────────────────────────────────


class TestQueryAnalytics:
    """Test that queries use parameterized format (no string interpolation)."""

    @pytest.fixture
    def mock_client(self):
        mock = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {
            "data": [
                {"date": "2026-02-14", "requests": 100, "avg_latency": 150.5,
                 "total_cost": 350, "cache_hits": 20, "errors": 5}
            ]
        }
        mock.post = AsyncMock(return_value=mock_resp)
        return mock

    async def test_query_uses_parameterized_format(self, mock_client):
        """Project ID must be a parameter, never embedded in SQL."""
        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await query_analytics("proj_abc123", "7d")

            assert len(result) == 1
            mock_client.post.assert_called_once()

            call_kwargs = mock_client.post.call_args
            params = call_kwargs.kwargs.get("params", {})

            # SQL must use {project_id:String} placeholder, not actual value
            sql = params.get("query", "")
            assert "proj_abc123" not in sql, "Project ID must NOT be in SQL"
            assert "{project_id:String}" in sql, "Must use ClickHouse parameter syntax"
            assert "{days:UInt32}" in sql, "Must use ClickHouse parameter syntax"

            # Actual value must be in the params
            assert params.get("param_project_id") == "proj_abc123"
            assert params.get("param_days") == "7"

    async def test_query_rejects_injection_in_project_id(self, mock_client):
        """SQL injection in project_id should be rejected."""
        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await query_analytics("' OR 1=1; --", "7d")

            assert result == []
            mock_client.post.assert_not_called()

    async def test_query_rejects_invalid_period(self, mock_client):
        """Invalid period should default to 7 days, not crash."""
        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await query_analytics("proj_123", "999d; DROP TABLE --")

            # Should still work (defaults to 7d)
            assert len(result) == 1
            params = mock_client.post.call_args.kwargs.get("params", {})
            assert params.get("param_days") == "7"

    async def test_query_disabled_when_no_url(self):
        with patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = ""
            result = await query_analytics("proj_123")
            assert result == []

    async def test_query_handles_timeout(self, mock_client):
        import httpx as _httpx

        mock_client.post.side_effect = _httpx.TimeoutException("timed out")

        with patch("app.services.clickhouse_service._get_client", return_value=mock_client), \
             patch("app.services.clickhouse_service.settings") as mock_settings:
            mock_settings.clickhouse_url = "http://clickhouse:8123"

            result = await query_analytics("proj_123", "7d")
            assert result == []


# ─── Pydantic Validation Tests (LogUsageRequest) ────────────────


class TestLogUsageRequestValidation:
    """Test that the Pydantic schema rejects malicious inputs before
    they ever reach the ClickHouse service."""

    def test_valid_request(self):
        from app.schemas import LogUsageRequest

        req = LogUsageRequest(
            project_id="550e8400-e29b-41d4-a716-446655440000",
            provider="openai",
            model="gpt-4o",
            complexity="simple",
            latency_ms=150,
            status_code=200,
        )
        assert str(req.project_id) == "550e8400-e29b-41d4-a716-446655440000"

    def test_rejects_sql_in_project_id(self):
        from pydantic import ValidationError

        from app.schemas import LogUsageRequest

        with pytest.raises(ValidationError):
            LogUsageRequest(
                project_id="'; DROP TABLE routing_logs; --",
                provider="openai",
                model="gpt-4o",
                complexity="simple",
                latency_ms=100,
                status_code=200,
            )

    def test_rejects_invalid_complexity(self):
        from pydantic import ValidationError

        from app.schemas import LogUsageRequest

        with pytest.raises(ValidationError):
            LogUsageRequest(
                project_id="proj_123",
                provider="openai",
                model="gpt-4o",
                complexity="simple'; DROP TABLE --",
                latency_ms=100,
                status_code=200,
            )

    def test_rejects_negative_latency(self):
        from pydantic import ValidationError

        from app.schemas import LogUsageRequest

        with pytest.raises(ValidationError):
            LogUsageRequest(
                project_id="proj_123",
                provider="openai",
                model="gpt-4o",
                complexity="simple",
                latency_ms=-1,
                status_code=200,
            )

    def test_rejects_absurd_cost(self):
        from pydantic import ValidationError

        from app.schemas import LogUsageRequest

        with pytest.raises(ValidationError):
            LogUsageRequest(
                project_id="proj_123",
                provider="openai",
                model="gpt-4o",
                complexity="simple",
                latency_ms=100,
                status_code=200,
                cost_cents=999_999_999,
            )

    def test_complexity_must_be_known_value(self):
        """Only simple/medium/complex/unknown are valid."""
        from pydantic import ValidationError

        from app.schemas import LogUsageRequest

        with pytest.raises(ValidationError):
            LogUsageRequest(
                project_id="proj_123",
                provider="openai",
                model="gpt-4o",
                complexity="super_complex",
                latency_ms=100,
                status_code=200,
            )
