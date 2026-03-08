"""Comprehensive tests for alerts endpoints and alert_service.

Covers:
  Endpoints:
    - GET  /alerts                (list alerts, optional unread_only filter)
    - POST /alerts/{id}/read      (mark single alert as read)
    - POST /alerts/mark-all-read  (mark all alerts as read for user's teams)

  Service:
    - alert_service.create_alert()
    - alert_service.check_and_create_budget_alerts()  (anti-spam dedup)
    - alert_service.get_alerts_for_user()
    - alert_service.mark_alert_read()
    - alert_service.mark_all_read()
"""

import uuid

import pytest

from app.models.alert import Alert
from app.services import alert_service


# ─── Helpers ────────────────────────────────────────────────────


async def _create_alert_in_db(db_session, team_id: str, project_id: str, **overrides) -> Alert:
    """Insert an alert directly in the DB."""
    alert = Alert(
        project_id=project_id,
        team_id=team_id,
        alert_type=overrides.get("alert_type", "budget_warning"),
        severity=overrides.get("severity", "warning"),
        title=overrides.get("title", "Test alert"),
        message=overrides.get("message", "This is a test alert message."),
        is_read=overrides.get("is_read", False),
        budget_cents=overrides.get("budget_cents", 10000),
        spent_cents=overrides.get("spent_cents", 8000),
        threshold_pct=overrides.get("threshold_pct", 80),
    )
    db_session.add(alert)
    await db_session.flush()
    return alert


# ═══════════════════════════════════════════════════════════════
#  GET /alerts
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_list_alerts_requires_auth(client):
    """Alerts listing should reject unauthenticated requests."""
    resp = await client.get("/api/alerts")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_alerts_empty(client, auth_headers, team_and_project):
    """User with no alerts should get empty list."""
    resp = await client.get("/api/alerts", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_alerts_no_team(client, auth_headers):
    """User with no team should get empty list."""
    resp = await client.get("/api/alerts", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_alerts_returns_team_alerts(
    client, auth_headers, team_and_project, db_session
):
    """User should see alerts for their team."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    await _create_alert_in_db(db_session, tid, pid, title="Budget warning 80%")
    await _create_alert_in_db(
        db_session, tid, pid,
        alert_type="budget_exceeded",
        severity="critical",
        title="Budget exceeded!",
    )
    await db_session.commit()

    resp = await client.get("/api/alerts", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2

    # Check structure of first alert
    alert = data[0]
    assert "id" in alert
    assert "project_id" in alert
    assert "team_id" in alert
    assert "alert_type" in alert
    assert "severity" in alert
    assert "title" in alert
    assert "message" in alert
    assert "is_read" in alert
    assert "created_at" in alert


@pytest.mark.asyncio
async def test_list_alerts_ordered_by_newest_first(
    client, auth_headers, team_and_project, db_session
):
    """Alerts should be ordered newest first."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    await _create_alert_in_db(db_session, tid, pid, title="First alert")
    await _create_alert_in_db(db_session, tid, pid, title="Second alert")
    await db_session.commit()

    resp = await client.get("/api/alerts", headers=auth_headers)
    data = resp.json()
    assert len(data) == 2
    # Newest first (second alert was created last)
    assert data[0]["title"] == "Second alert"
    assert data[1]["title"] == "First alert"


@pytest.mark.asyncio
async def test_list_alerts_unread_only_filter(
    client, auth_headers, team_and_project, db_session
):
    """unread_only=true should only return unread alerts."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    await _create_alert_in_db(db_session, tid, pid, title="Unread alert", is_read=False)
    await _create_alert_in_db(db_session, tid, pid, title="Read alert", is_read=True)
    await db_session.commit()

    # All alerts
    resp = await client.get("/api/alerts", headers=auth_headers)
    assert len(resp.json()) == 2

    # Unread only
    resp = await client.get(
        "/api/alerts?unread_only=true", headers=auth_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["title"] == "Unread alert"
    assert data[0]["is_read"] is False


@pytest.mark.asyncio
async def test_list_alerts_limit_parameter(
    client, auth_headers, team_and_project, db_session
):
    """Limit parameter should restrict the number of alerts returned."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    for i in range(5):
        await _create_alert_in_db(db_session, tid, pid, title=f"Alert {i}")
    await db_session.commit()

    # Default limit is 50, but we can set it to 2
    resp = await client.get("/api/alerts?limit=2", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_list_alerts_team_isolation(
    client, auth_headers, team_and_project, db_session
):
    """User should NOT see alerts for other teams."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    # Alert for the user's team
    await _create_alert_in_db(db_session, tid, pid, title="My alert")

    # Alert for a different team
    other_team_id = str(uuid.uuid4())
    await _create_alert_in_db(db_session, other_team_id, str(uuid.uuid4()), title="Other team alert")
    await db_session.commit()

    resp = await client.get("/api/alerts", headers=auth_headers)
    data = resp.json()
    assert len(data) == 1
    assert data[0]["title"] == "My alert"


# ═══════════════════════════════════════════════════════════════
#  POST /alerts/{alert_id}/read
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_mark_read_requires_auth(client):
    """Mark-read should reject unauthenticated requests."""
    fake_id = str(uuid.uuid4())
    resp = await client.post(f"/api/alerts/{fake_id}/read")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_mark_read_success(
    client, auth_headers, team_and_project, db_session
):
    """Should mark a single alert as read."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alert = await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await db_session.commit()

    resp = await client.post(
        f"/api/alerts/{alert.id}/read", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify the alert is now read
    unread = await client.get(
        "/api/alerts?unread_only=true", headers=auth_headers
    )
    assert len(unread.json()) == 0


@pytest.mark.asyncio
async def test_mark_read_nonexistent_alert(client, auth_headers, team_and_project):
    """Marking a nonexistent alert should return 404."""
    fake_id = str(uuid.uuid4())
    resp = await client.post(
        f"/api/alerts/{fake_id}/read", headers=auth_headers
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_mark_read_idempotent(
    client, auth_headers, team_and_project, db_session
):
    """Marking an already-read alert should still succeed."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alert = await _create_alert_in_db(db_session, tid, pid, is_read=True)
    await db_session.commit()

    resp = await client.post(
        f"/api/alerts/{alert.id}/read", headers=auth_headers
    )
    # Should succeed even if already read (update sets is_read=True again)
    assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════
#  POST /alerts/mark-all-read
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_mark_all_read_requires_auth(client):
    """Mark-all-read should reject unauthenticated requests."""
    resp = await client.post("/api/alerts/mark-all-read")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_mark_all_read_success(
    client, auth_headers, team_and_project, db_session
):
    """Should mark all unread alerts as read."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await _create_alert_in_db(db_session, tid, pid, is_read=True)
    await db_session.commit()

    resp = await client.post("/api/alerts/mark-all-read", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["marked_read"] == 2  # only 2 were unread

    # Verify all are now read
    unread = await client.get(
        "/api/alerts?unread_only=true", headers=auth_headers
    )
    assert len(unread.json()) == 0


@pytest.mark.asyncio
async def test_mark_all_read_no_alerts(client, auth_headers, team_and_project):
    """Mark-all-read with no alerts should return 0."""
    resp = await client.post("/api/alerts/mark-all-read", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["marked_read"] == 0


@pytest.mark.asyncio
async def test_mark_all_read_only_own_teams(
    client, auth_headers, team_and_project, db_session
):
    """Mark-all-read should only affect the user's teams."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    # User's alert
    await _create_alert_in_db(db_session, tid, pid, is_read=False)

    # Another team's alert
    other_tid = str(uuid.uuid4())
    await _create_alert_in_db(db_session, other_tid, str(uuid.uuid4()), is_read=False)
    await db_session.commit()

    resp = await client.post("/api/alerts/mark-all-read", headers=auth_headers)
    assert resp.json()["marked_read"] == 1  # only our own


# ═══════════════════════════════════════════════════════════════
#  alert_service unit tests
# ═══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_service_create_alert(db_session, team_and_project):
    """create_alert should persist an alert to the database."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alert = await alert_service.create_alert(
        db_session,
        project_id=pid,
        team_id=tid,
        alert_type="budget_warning",
        severity="warning",
        title="Test budget warning",
        message="You are approaching 80% of your budget.",
        budget_cents=10000,
        spent_cents=8000,
        threshold_pct=80,
    )
    await db_session.commit()

    assert alert.id is not None
    assert alert.project_id == pid
    assert alert.team_id == tid
    assert alert.alert_type == "budget_warning"
    assert alert.severity == "warning"
    assert alert.is_read is False
    assert alert.budget_cents == 10000
    assert alert.spent_cents == 8000


@pytest.mark.asyncio
async def test_service_check_budget_below_threshold(db_session, team_and_project):
    """No alert should be created if spend is below threshold."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alerts = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=5000,  # 50% — below 80% threshold
        threshold_pct=80,
    )
    assert alerts == []


@pytest.mark.asyncio
async def test_service_check_budget_at_warning(db_session, team_and_project):
    """Alert should be created at 80% threshold."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alerts = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=8500,  # 85% — above 80% threshold
        threshold_pct=80,
    )
    await db_session.commit()

    assert len(alerts) == 1
    assert alerts[0].alert_type == "budget_warning"
    assert alerts[0].severity == "warning"
    assert "85%" in alerts[0].title


@pytest.mark.asyncio
async def test_service_check_budget_at_exceeded(db_session, team_and_project):
    """Critical alert should be created when budget is exceeded (100%+)."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alerts = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=10500,  # 105% — exceeded
        threshold_pct=80,
    )
    await db_session.commit()

    assert len(alerts) == 1
    assert alerts[0].alert_type == "budget_exceeded"
    assert alerts[0].severity == "critical"
    assert "exceeded" in alerts[0].title.lower()


@pytest.mark.asyncio
async def test_service_check_budget_dedup_warning(db_session, team_and_project):
    """Should NOT create a duplicate warning if one already exists (anti-spam)."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    # First call — creates warning
    alerts1 = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=8500,
    )
    await db_session.commit()
    assert len(alerts1) == 1

    # Second call — should NOT create duplicate
    alerts2 = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=9000,
    )
    assert len(alerts2) == 0


@pytest.mark.asyncio
async def test_service_check_budget_dedup_exceeded(db_session, team_and_project):
    """Should NOT create a duplicate exceeded alert if one already exists."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    # First exceeded alert
    alerts1 = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=11000,
    )
    await db_session.commit()
    assert len(alerts1) == 1

    # Second call — should NOT create duplicate
    alerts2 = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=12000,
    )
    assert len(alerts2) == 0


@pytest.mark.asyncio
async def test_service_check_budget_zero_budget(db_session, team_and_project):
    """Zero or negative budget should never trigger alerts."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alerts = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=0,
        spent_cents=5000,
    )
    assert alerts == []


@pytest.mark.asyncio
async def test_service_check_budget_custom_threshold(db_session, team_and_project):
    """Custom threshold should be respected."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    # 60% spend with 50% threshold → should trigger warning
    alerts = await alert_service.check_and_create_budget_alerts(
        db_session,
        project_id=pid,
        team_id=tid,
        project_name="Test Project",
        budget_cents=10000,
        spent_cents=6000,  # 60%
        threshold_pct=50,  # custom low threshold
    )
    await db_session.commit()

    assert len(alerts) == 1
    assert alerts[0].alert_type == "budget_warning"


@pytest.mark.asyncio
async def test_service_get_alerts_empty_teams(db_session):
    """get_alerts_for_user with no teams should return empty list."""
    result = await alert_service.get_alerts_for_user(db_session, [])
    assert result == []


@pytest.mark.asyncio
async def test_service_get_alerts_with_limit(db_session, team_and_project):
    """get_alerts_for_user should respect the limit parameter."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    for i in range(5):
        await _create_alert_in_db(db_session, tid, pid, title=f"Alert {i}")
    await db_session.commit()

    result = await alert_service.get_alerts_for_user(
        db_session, [tid], limit=3
    )
    assert len(result) == 3


@pytest.mark.asyncio
async def test_service_get_alerts_unread_only(db_session, team_and_project):
    """get_alerts_for_user with unread_only should filter correctly."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await _create_alert_in_db(db_session, tid, pid, is_read=True)
    await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await db_session.commit()

    result = await alert_service.get_alerts_for_user(
        db_session, [tid], unread_only=True
    )
    assert len(result) == 2
    for alert in result:
        assert alert.is_read is False


@pytest.mark.asyncio
async def test_service_mark_alert_read(db_session, team_and_project):
    """mark_alert_read should set is_read to True."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    alert = await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await db_session.commit()

    success = await alert_service.mark_alert_read(db_session, str(alert.id))
    assert success is True


@pytest.mark.asyncio
async def test_service_mark_alert_read_nonexistent(db_session):
    """mark_alert_read with nonexistent ID should return False."""
    success = await alert_service.mark_alert_read(db_session, str(uuid.uuid4()))
    assert success is False


@pytest.mark.asyncio
async def test_service_mark_all_read(db_session, team_and_project):
    """mark_all_read should mark all unread alerts as read for given teams."""
    tid = team_and_project["team_id"]
    pid = team_and_project["project_id"]

    await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await _create_alert_in_db(db_session, tid, pid, is_read=False)
    await _create_alert_in_db(db_session, tid, pid, is_read=True)
    await db_session.commit()

    count = await alert_service.mark_all_read(db_session, [tid])
    assert count == 2


@pytest.mark.asyncio
async def test_service_mark_all_read_empty_teams(db_session):
    """mark_all_read with no teams should return 0."""
    count = await alert_service.mark_all_read(db_session, [])
    assert count == 0
