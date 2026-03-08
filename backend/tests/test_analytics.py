"""Comprehensive tests for analytics endpoints.

Covers:
  - GET /analytics/overview       (total requests, avg latency, cache/fallback/error rates)
  - GET /analytics/by-provider    (request breakdown by provider)
  - GET /analytics/by-day         (daily time-series data)
  - GET /analytics/by-model       (request breakdown by model)

Tests create RoutingLog entries directly in the database via the internal
log-usage endpoint or via direct model insertion for edge cases.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.routing_log import RoutingLog


INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "test-internal-secret")


# ─── Helpers ────────────────────────────────────────────────────


async def _log_usage(client, project_id: str, **overrides) -> None:
    """Log a usage event via the internal endpoint."""
    payload = {
        "project_id": project_id,
        "provider": "openai",
        "model": "gpt-4o",
        "complexity": "medium",
        "latency_ms": 200,
        "status_code": 200,
        "cache_hit": False,
        "was_fallback": False,
        "input_tokens": 100,
        "output_tokens": 50,
        "cost_cents": 5,
    }
    payload.update(overrides)
    resp = await client.post(
        "/internal/log-usage",
        json=payload,
        headers={"X-Internal-Secret": INTERNAL_SECRET},
    )
    assert resp.status_code == 201, f"log-usage failed: {resp.text}"


async def _insert_routing_log(db_session, project_id: str, **overrides) -> RoutingLog:
    """Insert a RoutingLog directly in the DB for fine-grained control."""
    log = RoutingLog(
        project_id=project_id,
        provider=overrides.get("provider", "openai"),
        model=overrides.get("model", "gpt-4o"),
        complexity=overrides.get("complexity", "medium"),
        latency_ms=overrides.get("latency_ms", 200),
        status_code=overrides.get("status_code", 200),
        cache_hit=overrides.get("cache_hit", False),
        was_fallback=overrides.get("was_fallback", False),
        input_tokens=overrides.get("input_tokens", 100),
        output_tokens=overrides.get("output_tokens", 50),
        created_at=overrides.get("created_at", datetime.now(timezone.utc)),
    )
    db_session.add(log)
    await db_session.flush()
    return log


# ═══════════════════════════════════════════════════════════════
#  GET /analytics/overview
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_analytics_overview_requires_auth(client):
    """Overview should reject unauthenticated requests."""
    resp = await client.get("/api/analytics/overview")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_analytics_overview_no_data(client, auth_headers, team_and_project):
    """Overview with no routing logs should return zeros."""
    resp = await client.get("/api/analytics/overview", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_requests"] == 0
    assert data["avg_latency_ms"] == 0
    assert data["cache_hit_rate"] == 0.0
    assert data["fallback_rate"] == 0.0
    assert data["error_rate"] == 0.0
    assert data["period_days"] == 30  # default


@pytest.mark.asyncio
async def test_analytics_overview_no_team(client, auth_headers):
    """User without a team/project should get empty results."""
    resp = await client.get("/api/analytics/overview", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_requests"] == 0


@pytest.mark.asyncio
async def test_analytics_overview_with_data(client, auth_headers, team_and_project):
    """Overview should correctly aggregate routing logs."""
    pid = team_and_project["project_id"]

    # Log 3 normal requests
    for _ in range(3):
        await _log_usage(client, pid, latency_ms=100, status_code=200)

    # Log 1 cache hit
    await _log_usage(client, pid, latency_ms=5, cache_hit=True)

    # Log 1 fallback
    await _log_usage(client, pid, latency_ms=500, was_fallback=True)

    # Log 1 error
    await _log_usage(client, pid, latency_ms=1000, status_code=500)

    resp = await client.get("/api/analytics/overview", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    assert data["total_requests"] == 6
    assert data["avg_latency_ms"] > 0
    # 1 cache hit out of 6 = 16.7%
    assert data["cache_hit_rate"] > 0
    assert data["cache_hits"] == 1
    # 1 fallback out of 6
    assert data["fallback_rate"] > 0
    # 1 error out of 6
    assert data["error_rate"] > 0


@pytest.mark.asyncio
async def test_analytics_overview_days_filter(
    client, auth_headers, team_and_project, db_session
):
    """Overview should respect the 'days' query parameter."""
    pid = team_and_project["project_id"]

    # Create a recent log (today)
    await _insert_routing_log(db_session, pid, latency_ms=100)

    # Create an old log (60 days ago)
    await _insert_routing_log(
        db_session, pid,
        latency_ms=200,
        created_at=datetime.now(timezone.utc) - timedelta(days=60),
    )
    await db_session.commit()

    # With days=30, only the recent log should be counted
    resp = await client.get(
        "/api/analytics/overview?days=7", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["total_requests"] == 1

    # With days=90, both logs should be counted
    resp = await client.get(
        "/api/analytics/overview?days=90", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["total_requests"] == 2


@pytest.mark.asyncio
async def test_analytics_overview_days_validation(client, auth_headers, team_and_project):
    """Days parameter should be validated (1-365)."""
    resp = await client.get(
        "/api/analytics/overview?days=0", headers=auth_headers
    )
    assert resp.status_code == 422

    resp = await client.get(
        "/api/analytics/overview?days=500", headers=auth_headers
    )
    assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════
#  GET /analytics/by-provider
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_by_provider_requires_auth(client):
    """By-provider should reject unauthenticated requests."""
    resp = await client.get("/api/analytics/by-provider")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_by_provider_no_data(client, auth_headers, team_and_project):
    """Empty project should return empty list."""
    resp = await client.get("/api/analytics/by-provider", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_by_provider_single_provider(client, auth_headers, team_and_project):
    """Single provider should return one entry."""
    pid = team_and_project["project_id"]
    await _log_usage(client, pid, provider="openai", latency_ms=150)
    await _log_usage(client, pid, provider="openai", latency_ms=250)

    resp = await client.get("/api/analytics/by-provider", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["provider"] == "openai"
    assert data[0]["request_count"] == 2
    assert data[0]["avg_latency_ms"] == 200.0  # (150+250)/2


@pytest.mark.asyncio
async def test_by_provider_multiple_providers(
    client, auth_headers, team_and_project
):
    """Multiple providers should appear in descending order by count."""
    pid = team_and_project["project_id"]

    # 3 OpenAI requests
    for _ in range(3):
        await _log_usage(client, pid, provider="openai", model="gpt-4o")

    # 2 Anthropic requests
    for _ in range(2):
        await _log_usage(client, pid, provider="anthropic", model="claude-3.5-sonnet")

    # 1 Google request
    await _log_usage(client, pid, provider="google", model="gemini-1.5-pro")

    resp = await client.get("/api/analytics/by-provider", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    assert len(data) == 3
    # Ordered by request_count desc
    assert data[0]["provider"] == "openai"
    assert data[0]["request_count"] == 3
    assert data[1]["provider"] == "anthropic"
    assert data[1]["request_count"] == 2
    assert data[2]["provider"] == "google"
    assert data[2]["request_count"] == 1


@pytest.mark.asyncio
async def test_by_provider_error_tracking(client, auth_headers, team_and_project):
    """By-provider should track error counts and rates per provider."""
    pid = team_and_project["project_id"]

    # 2 successful + 1 error for openai
    await _log_usage(client, pid, provider="openai", status_code=200)
    await _log_usage(client, pid, provider="openai", status_code=200)
    await _log_usage(client, pid, provider="openai", status_code=500)

    resp = await client.get("/api/analytics/by-provider", headers=auth_headers)
    data = resp.json()
    assert len(data) == 1
    assert data[0]["error_count"] == 1
    # 1 error out of 3 ≈ 33.3%
    assert data[0]["error_rate"] == pytest.approx(33.3, abs=0.1)


# ═══════════════════════════════════════════════════════════════
#  GET /analytics/by-day
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_by_day_requires_auth(client):
    """By-day should reject unauthenticated requests."""
    resp = await client.get("/api/analytics/by-day")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_by_day_no_data(client, auth_headers, team_and_project):
    """Empty project should return empty list."""
    resp = await client.get("/api/analytics/by-day", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_by_day_single_day(client, auth_headers, team_and_project):
    """Logs on the same day should be aggregated into one entry."""
    pid = team_and_project["project_id"]
    await _log_usage(client, pid, latency_ms=100)
    await _log_usage(client, pid, latency_ms=300)

    resp = await client.get("/api/analytics/by-day", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["request_count"] == 2
    assert data[0]["avg_latency_ms"] == 200.0
    # Date should be today
    assert data[0]["date"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")


@pytest.mark.asyncio
async def test_by_day_multiple_days(
    client, auth_headers, team_and_project, db_session
):
    """Logs on different days should produce separate entries."""
    pid = team_and_project["project_id"]

    today = datetime.now(timezone.utc)
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)

    await _insert_routing_log(db_session, pid, created_at=today, latency_ms=100)
    await _insert_routing_log(db_session, pid, created_at=yesterday, latency_ms=200)
    await _insert_routing_log(db_session, pid, created_at=yesterday, latency_ms=400)
    await _insert_routing_log(db_session, pid, created_at=two_days_ago, latency_ms=300)
    await db_session.commit()

    resp = await client.get("/api/analytics/by-day", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Should have 3 days (ordered chronologically)
    assert len(data) == 3
    # First entry is oldest
    assert data[0]["request_count"] == 1   # two_days_ago
    assert data[1]["request_count"] == 2   # yesterday
    assert data[2]["request_count"] == 1   # today


@pytest.mark.asyncio
async def test_by_day_respects_days_filter(
    client, auth_headers, team_and_project, db_session
):
    """By-day should only include logs within the specified time range."""
    pid = team_and_project["project_id"]

    today = datetime.now(timezone.utc)
    await _insert_routing_log(db_session, pid, created_at=today)
    await _insert_routing_log(
        db_session, pid,
        created_at=today - timedelta(days=45),
    )
    await db_session.commit()

    # days=30 should only include today
    resp = await client.get(
        "/api/analytics/by-day?days=30", headers=auth_headers
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # days=60 should include both
    resp = await client.get(
        "/api/analytics/by-day?days=60", headers=auth_headers
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


# ═══════════════════════════════════════════════════════════════
#  GET /analytics/by-model
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_by_model_requires_auth(client):
    """By-model should reject unauthenticated requests."""
    resp = await client.get("/api/analytics/by-model")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_by_model_no_data(client, auth_headers, team_and_project):
    """Empty project should return empty list."""
    resp = await client.get("/api/analytics/by-model", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_by_model_single_model(client, auth_headers, team_and_project):
    """Single model should return one entry."""
    pid = team_and_project["project_id"]
    await _log_usage(client, pid, model="gpt-4o", provider="openai")
    await _log_usage(client, pid, model="gpt-4o", provider="openai")

    resp = await client.get("/api/analytics/by-model", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["model"] == "gpt-4o"
    assert data[0]["provider"] == "openai"
    assert data[0]["request_count"] == 2


@pytest.mark.asyncio
async def test_by_model_multiple_models(client, auth_headers, team_and_project):
    """Multiple models should appear in descending order by count."""
    pid = team_and_project["project_id"]

    # 3 gpt-4o requests
    for _ in range(3):
        await _log_usage(client, pid, model="gpt-4o", provider="openai")

    # 2 claude requests
    for _ in range(2):
        await _log_usage(client, pid, model="claude-3.5-sonnet", provider="anthropic")

    # 1 gemini request
    await _log_usage(client, pid, model="gemini-1.5-pro", provider="google")

    resp = await client.get("/api/analytics/by-model", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    assert len(data) == 3
    # Ordered by request_count desc
    assert data[0]["model"] == "gpt-4o"
    assert data[0]["request_count"] == 3
    assert data[1]["model"] == "claude-3.5-sonnet"
    assert data[1]["request_count"] == 2
    assert data[2]["model"] == "gemini-1.5-pro"
    assert data[2]["request_count"] == 1


@pytest.mark.asyncio
async def test_by_model_same_model_different_providers(
    client, auth_headers, team_and_project
):
    """Same model name but different providers should be separate entries."""
    pid = team_and_project["project_id"]

    # gpt-4o via openai
    await _log_usage(client, pid, model="gpt-4o", provider="openai")

    # gpt-4o via azure (same model, different provider)
    await _log_usage(client, pid, model="gpt-4o", provider="azure")

    resp = await client.get("/api/analytics/by-model", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Should be 2 entries: (gpt-4o, openai) and (gpt-4o, azure)
    assert len(data) == 2
    providers = {d["provider"] for d in data}
    assert providers == {"openai", "azure"}


# ═══════════════════════════════════════════════════════════════
#  Cross-team isolation
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_analytics_team_isolation(
    client, auth_headers, team_and_project, db_session
):
    """User should only see analytics for their own team's projects."""
    pid = team_and_project["project_id"]

    # Log data for our project
    await _log_usage(client, pid)

    # Create a RoutingLog for a random project (simulating another team)
    await _insert_routing_log(
        db_session, str(uuid.uuid4()), provider="openai"
    )
    await db_session.commit()

    resp = await client.get("/api/analytics/overview", headers=auth_headers)
    assert resp.status_code == 200
    # Should only see 1 request (our own)
    assert resp.json()["total_requests"] == 1
