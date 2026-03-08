"""Tests for internal endpoints used by the Go router."""

import os
import pytest


INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "test-internal-secret")


@pytest.mark.asyncio
async def test_internal_validate_key_requires_secret(client):
    """Internal endpoints must reject requests without X-Internal-Secret."""
    resp = await client.post("/internal/validate-key", json={"key": "sk_styx_test"})
    assert resp.status_code in (403, 500)


@pytest.mark.asyncio
async def test_internal_validate_key_invalid_key(client):
    """Validation of a nonexistent key should return valid=false."""
    resp = await client.post(
        "/internal/validate-key",
        json={"key": "sk_styx_nonexistent_key_12345"},
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    # Should succeed but return valid=false
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False


@pytest.mark.asyncio
async def test_internal_validate_key_success(client, auth_headers, team_and_project):
    """After creating a key, validation should return valid=true with project info."""
    # Create a real API key
    create_resp = await client.post("/api/keys", json={
        "project_id": team_and_project["project_id"],
        "name": "Internal Test Key",
    }, headers=auth_headers)
    assert create_resp.status_code in (200, 201)
    raw_key = create_resp.json()["key"]

    # Validate it via internal endpoint
    resp = await client.post(
        "/internal/validate-key",
        json={"key": raw_key},
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["project_id"] == team_and_project["project_id"]


@pytest.mark.asyncio
async def test_internal_budget_check(client, auth_headers, team_and_project):
    """Budget check should return budget info for a valid project."""
    project_id = team_and_project["project_id"]
    resp = await client.get(
        f"/internal/budget/{project_id}",
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "allowed" in data


@pytest.mark.asyncio
async def test_internal_log_usage(client, auth_headers, team_and_project):
    """Log usage should accept valid usage data."""
    resp = await client.post(
        "/internal/log-usage",
        json={
            "project_id": team_and_project["project_id"],
            "provider": "openai",
            "model": "gpt-4o-mini",
            "complexity": "simple",
            "latency_ms": 150,
            "status_code": 200,
            "cache_hit": False,
            "was_fallback": False,
            "input_tokens": 50,
            "output_tokens": 100,
            "cost_cents": 1,
        },
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 201


# ─── Bug fix regression tests ────────────────────────────────────


@pytest.mark.asyncio
async def test_budget_check_invalid_uuid_returns_401(client):
    """Bug 1: Invalid UUID in budget check should return 401, not 500."""
    resp = await client.get(
        "/internal/budget/not-a-valid-uuid",
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_budget_check_nonexistent_project_returns_401(client):
    """Budget check with a valid UUID that doesn't exist should return 401."""
    import uuid
    fake_project_id = str(uuid.uuid4())
    resp = await client.get(
        f"/internal/budget/{fake_project_id}",
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_log_usage_invalid_project_id_format(client):
    """Bug 1: LogUsageRequest with non-UUID project_id should be rejected."""
    resp = await client.post(
        "/internal/log-usage",
        json={
            "project_id": "not_a_uuid_!!!",
            "provider": "openai",
            "model": "gpt-4o-mini",
            "complexity": "simple",
            "latency_ms": 100,
            "status_code": 200,
        },
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    # Pydantic validator should reject this with 422
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_log_usage_nonexistent_project_returns_404(client):
    """Bug 3: log_usage with a valid UUID for a deleted project should return 404."""
    import uuid
    fake_project_id = str(uuid.uuid4())
    resp = await client.post(
        "/internal/log-usage",
        json={
            "project_id": fake_project_id,
            "provider": "openai",
            "model": "gpt-4o-mini",
            "complexity": "simple",
            "latency_ms": 100,
            "status_code": 200,
        },
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_increment_request_invalid_user_id(client):
    """Bug 1: increment-request with invalid user_id should return error."""
    resp = await client.post(
        "/internal/increment-request?user_id=not-a-uuid",
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["error"] == "invalid_user_id"


@pytest.mark.asyncio
async def test_deduct_credits_invalid_user_id(client):
    """Bug 1: deduct-credits with invalid user_id should return error."""
    resp = await client.post(
        "/internal/deduct-credits?user_id=not-a-uuid&provider=openai&model=gpt-4o&input_tokens=10&output_tokens=10",
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["error"] == "invalid_user_id"
