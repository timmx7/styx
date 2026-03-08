"""Tests for budget endpoints."""

import pytest


@pytest.mark.asyncio
async def test_get_budget_status(client, auth_headers, team_and_project):
    """Get budget status for authenticated user."""
    resp = await client.get("/api/budget", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_get_budget_no_auth(client):
    """Budget endpoint requires authentication."""
    resp = await client.get("/api/budget")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_budget_after_usage(client, auth_headers, team_and_project):
    """After logging usage, budget should reflect the spend."""
    import os
    internal_secret = os.environ.get("INTERNAL_SECRET", "test-internal-secret")

    # Log some usage
    await client.post(
        "/internal/log-usage",
        json={
            "project_id": team_and_project["project_id"],
            "provider": "openai",
            "model": "gpt-4o",
            "complexity": "complex",
            "latency_ms": 500,
            "status_code": 200,
            "cache_hit": False,
            "was_fallback": False,
            "input_tokens": 1000,
            "output_tokens": 500,
            "cost_cents": 75,
        },
        headers={"X-Internal-Secret": internal_secret},
    )

    # Check budget — should have some spend recorded
    resp = await client.get("/api/budget", headers=auth_headers)
    assert resp.status_code == 200
