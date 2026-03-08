import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import patch

from app.models.webhook import WebhookEndpoint
from app.services.webhook_service import fire_event, _MAX_CONSECUTIVE_FAILURES

# ─── API Endpoint Tests ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_webhook(client: AsyncClient, auth_headers: dict, team_and_project: dict):
    team_id = team_and_project["team_id"]
    payload = {
        "team_id": str(team_id),
        "url": "https://example.com/webhook",
        "events": ["budget.exceeded", "api_key.created"],
        "description": "My first webhook"
    }

    resp = await client.post("/api/webhooks", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()

    assert data["url"] == "https://example.com/webhook"
    assert "budget.exceeded" in data["events"]
    assert "api_key.created" in data["events"]
    assert data["description"] == "My first webhook"
    assert data["is_active"] is True
    assert "secret" in data  # returned only once

@pytest.mark.asyncio
async def test_list_webhooks(client: AsyncClient, auth_headers: dict, team_and_project: dict):
    team_id = team_and_project["team_id"]
    # Create two webhooks
    for i in range(2):
        await client.post(
            "/api/webhooks",
            json={
                "team_id": str(team_id),
                "url": f"https://example.com/wh{i}",
                "events": ["budget.exceeded"]
            },
            headers=auth_headers
        )

    resp = await client.get("/api/webhooks", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert "secret" not in data[0]

@pytest.mark.asyncio
async def test_update_webhook(client: AsyncClient, auth_headers: dict, team_and_project: dict):
    team_id = team_and_project["team_id"]
    # Create
    resp = await client.post(
        "/api/webhooks",
        json={
            "team_id": str(team_id),
            "url": "https://example.com/start",
            "events": ["budget.exceeded"]
        },
        headers=auth_headers
    )
    wh_id = resp.json()["id"]

    # Update
    resp2 = await client.put(
        f"/api/webhooks/{wh_id}",
        json={
            "url": "https://example.com/updated",
            "events": ["api_key.created"],
            "is_active": False
        },
        headers=auth_headers
    )
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["url"] == "https://example.com/updated"
    assert data["events"] == ["api_key.created"]
    assert data["is_active"] is False

# ─── Service Tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fire_event_success(db_session: AsyncSession, team_and_project: dict):
    team_id = team_and_project["team_id"]
    
    # Insert an active webhook manually
    wh = WebhookEndpoint(
        team_id=team_id,
        url="https://valid.example.com/webhook",
        secret="testsecret",
        events=["budget.exceeded"],
        is_active=True
    )
    db_session.add(wh)
    await db_session.flush()

    # Mock httpx.AsyncClient.post to return 200 OK
    class MockResponse:
        status_code = 200
        text = "OK"

    # Also mock _is_safe_url so it doesn't block "valid.example.com"
    with patch("httpx.AsyncClient.post", return_value=MockResponse()), \
         patch("app.services.webhook_service._is_safe_url", return_value=True):
        delivered = await fire_event(
            db=db_session,
            team_id=str(team_id),
            event="budget.exceeded",
            data={"project_id": "test"}
        )

    assert delivered == 1
    # Check that consecutive failures was reset and last_triggered_at set
    from sqlalchemy import select
    res = await db_session.execute(select(WebhookEndpoint).where(WebhookEndpoint.id == wh.id))
    wh_refreshed = res.scalar_one()
    assert wh_refreshed.consecutive_failures == 0
    assert wh_refreshed.last_triggered_at is not None

@pytest.mark.asyncio
async def test_fire_event_failure_threshold(db_session: AsyncSession, team_and_project: dict):
    team_id = team_and_project["team_id"]
    
    wh = WebhookEndpoint(
        team_id=team_id,
        url="https://failing.example.com/",
        secret="testsecret",
        events=["budget.exceeded"],
        is_active=True,
        consecutive_failures=_MAX_CONSECUTIVE_FAILURES - 1  # 1 failure away from being disabled
    )
    db_session.add(wh)
    await db_session.flush()

    class MockErrorResponse:
        status_code = 500
        text = "Internal Server Error"

    with patch("httpx.AsyncClient.post", return_value=MockErrorResponse()), \
         patch("app.services.webhook_service._is_safe_url", return_value=True):
        delivered = await fire_event(
            db=db_session,
            team_id=str(team_id),
            event="budget.exceeded",
            data={"project_id": "test"}
        )

    assert delivered == 0
    from sqlalchemy import select
    res = await db_session.execute(select(WebhookEndpoint).where(WebhookEndpoint.id == wh.id))
    wh_refreshed = res.scalar_one()
    # The webhook should now be disabled because it reached the threshold
    assert wh_refreshed.consecutive_failures == _MAX_CONSECUTIVE_FAILURES
    assert wh_refreshed.is_active is False
