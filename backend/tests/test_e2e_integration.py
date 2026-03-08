"""End-to-end integration tests — full business flows across multiple endpoints.

These tests verify complete user journeys through the Styx system,
crossing service boundaries and validating the integrity of multi-step
operations. Unlike unit tests (which test one endpoint), these tests
simulate real user behavior from registration to analytics.

Run with:  pytest tests/test_e2e_integration.py -v
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

# ─── Internal secret used across all internal endpoint calls ──────
INTERNAL_SECRET = "test-internal-secret"
INTERNAL_HEADERS = {"X-Internal-Secret": INTERNAL_SECRET}


# ═══════════════════════════════════════════════════════════════════
#  Helpers — reusable building blocks for E2E flows
# ═══════════════════════════════════════════════════════════════════
# NOTE: Use `create_test_user` fixture from conftest.py to create users.


async def _headers(user_data: dict) -> dict:
    """Build auth headers from token response."""
    return user_data.get("headers") or {"Authorization": f"Bearer {user_data['access_token']}"}


async def _create_team(client: AsyncClient, headers: dict, name: str = "E2E Team") -> dict:
    """Create a team and return its data."""
    resp = await client.post("/api/teams", json={"name": name}, headers=headers)
    assert resp.status_code in (200, 201), f"Team creation failed: {resp.text}"
    return resp.json()


async def _create_project(
    client: AsyncClient,
    headers: dict,
    team_id: str,
    name: str = "E2E Project",
    budget_cents: int | None = 10000,
) -> dict:
    """Create a project and return its data."""
    body = {"name": name, "team_id": team_id}
    if budget_cents is not None:
        body["budget_monthly_cents"] = budget_cents
    resp = await client.post("/api/projects", json=body, headers=headers)
    assert resp.status_code in (200, 201), f"Project creation failed: {resp.text}"
    return resp.json()


async def _create_key(
    client: AsyncClient,
    headers: dict,
    project_id: str,
    name: str = "e2e-key",
) -> dict:
    """Create an API key. Returns both the key metadata and the raw key."""
    resp = await client.post("/api/keys", json={
        "project_id": project_id,
        "name": name,
    }, headers=headers)
    assert resp.status_code in (200, 201), f"Key creation failed: {resp.text}"
    return resp.json()


async def _log_usage(
    client: AsyncClient,
    project_id: str,
    provider: str = "openai",
    model: str = "gpt-4o-mini",
    cost_cents: int = 5,
    **overrides,
) -> dict:
    """Log a usage entry via the internal endpoint."""
    body = {
        "project_id": project_id,
        "provider": provider,
        "model": model,
        "complexity": overrides.get("complexity", "simple"),
        "latency_ms": overrides.get("latency_ms", 150),
        "status_code": overrides.get("status_code", 200),
        "cache_hit": overrides.get("cache_hit", False),
        "was_fallback": overrides.get("was_fallback", False),
        "input_tokens": overrides.get("input_tokens", 50),
        "output_tokens": overrides.get("output_tokens", 100),
        "cost_cents": cost_cents,
    }
    resp = await client.post("/internal/log-usage", json=body, headers=INTERNAL_HEADERS)
    assert resp.status_code == 201, f"Log usage failed: {resp.text}"
    return resp.json()


async def _get_auto_team(client: AsyncClient, headers: dict) -> dict:
    """Get the auto-onboarded team created during registration."""
    resp = await client.get("/api/teams", headers=headers)
    assert resp.status_code == 200, f"List teams failed: {resp.text}"
    teams = resp.json()
    assert len(teams) >= 1, "Expected at least 1 auto-onboarded team"
    return teams[0]


async def _full_setup(client: AsyncClient, create_test_user) -> dict:
    """Complete setup: create user → use auto-onboarded team → project → key."""
    user = await create_test_user()
    headers = await _headers(user)
    team = await _get_auto_team(client, headers)
    project = await _create_project(client, headers, team["id"])
    key = await _create_key(client, headers, project["id"])

    return {
        "user": user,
        "headers": headers,
        "team": team,
        "project": project,
        "key": key,
    }


# ═══════════════════════════════════════════════════════════════════
#  1. FULL USER JOURNEY
#     Register → Team → Project → Key → Validate → Use → Analytics
# ═══════════════════════════════════════════════════════════════════

class TestFullUserJourney:
    """The complete lifecycle of a user from sign-up to seeing analytics."""

    @pytest.mark.asyncio
    async def test_complete_journey_register_to_analytics(self, client: AsyncClient, create_test_user):
        """A user registers, creates resources, uses the API, and sees analytics."""

        # Step 1: Create user (Supabase handles actual registration)
        user = await create_test_user(name="Alice Dupont")
        assert "access_token" in user
        assert "user_id" in user
        headers = await _headers(user)

        # Step 2: Verify identity
        me_resp = await client.get("/api/auth/me", headers=headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["name"] == "Alice Dupont"
        assert me_resp.json()["email"] == user["email"]
        me_resp.json()["id"]

        # Step 3: Create team
        team = await _create_team(client, headers, "Alice's Team")
        assert team["name"] == "Alice's Team"
        team_id = team["id"]

        # Step 4: Create project with budget
        project = await _create_project(
            client, headers, team_id,
            name="Production API",
            budget_cents=50000,  # $500
        )
        assert project["name"] == "Production API"
        assert project["budget_monthly_cents"] == 50000
        project_id = project["id"]

        # Step 5: Create API key
        key_data = await _create_key(client, headers, project_id, "prod-key")
        raw_key = key_data["key"]
        assert raw_key.startswith("sk_styx_")
        assert key_data["name"] == "prod-key"

        # Step 6: Validate key via internal endpoint (simulates Go router)
        validate_resp = await client.post(
            "/internal/validate-key",
            json={"key": raw_key},
            headers=INTERNAL_HEADERS,
        )
        assert validate_resp.status_code == 200
        vdata = validate_resp.json()
        assert vdata["valid"] is True
        assert vdata["project_id"] == project_id
        assert vdata["team_id"] == team_id

        # Step 7: Check budget before routing (should be allowed)
        budget_resp = await client.get(
            f"/internal/budget/{project_id}",
            headers=INTERNAL_HEADERS,
        )
        assert budget_resp.status_code == 200
        assert budget_resp.json()["allowed"] is True

        # Step 8: Log some usage (simulates successful API calls)
        for i in range(3):
            await _log_usage(
                client, project_id,
                provider="openai",
                model="gpt-4o-mini",
                cost_cents=10,
                latency_ms=100 + i * 50,
            )

        await _log_usage(
            client, project_id,
            provider="anthropic",
            model="claude-3-5-haiku",
            cost_cents=15,
            latency_ms=200,
        )

        # Step 9: Check analytics
        analytics_resp = await client.get(
            "/api/analytics/overview?days=30",
            headers=headers,
        )
        assert analytics_resp.status_code == 200
        analytics = analytics_resp.json()
        assert analytics["total_requests"] == 4
        assert analytics["period_days"] == 30

        # Step 10: Check by-provider analytics
        by_provider_resp = await client.get(
            "/api/analytics/by-provider?days=30",
            headers=headers,
        )
        assert by_provider_resp.status_code == 200
        providers = by_provider_resp.json()
        provider_names = {p["provider"] for p in providers}
        assert "openai" in provider_names
        assert "anthropic" in provider_names

        # Step 11: Check routing logs (internal endpoint requires internal headers)
        logs_resp = await client.get("/internal/routing-logs", headers=INTERNAL_HEADERS)
        assert logs_resp.status_code == 200
        logs = logs_resp.json()
        assert len(logs) == 4

        # Step 12: Verify budget spend updated
        budget_resp2 = await client.get(
            f"/internal/budget/{project_id}",
            headers=INTERNAL_HEADERS,
        )
        assert budget_resp2.status_code == 200
        bdata = budget_resp2.json()
        assert bdata["spent_cents"] == 45  # 10*3 + 15
        assert bdata["allowed"] is True  # well within $500

        # Step 13: API keys list shows our key
        keys_resp = await client.get("/api/keys", headers=headers)
        assert keys_resp.status_code == 200
        keys = keys_resp.json()
        assert len(keys) == 1
        assert keys[0]["name"] == "prod-key"
        assert keys[0]["is_active"] is True
        # last_used_at should be set (key was validated)
        assert keys[0]["last_used_at"] is not None

    @pytest.mark.asyncio
    async def test_projects_list_reflects_team_membership(self, client: AsyncClient, create_test_user):
        """Projects endpoint only shows projects from the user's teams."""

        setup = await _full_setup(client, create_test_user)
        headers = setup["headers"]

        # Create a second team + project
        team2 = await _create_team(client, headers, "Second Team")
        await _create_project(client, headers, team2["id"], "Second Project")

        # List all projects — should see all 3 (auto-onboarded + E2E + Second)
        resp = await client.get("/api/projects", headers=headers)
        assert resp.status_code == 200
        projects = resp.json()
        assert len(projects) == 3
        names = {p["name"] for p in projects}
        assert "Default Project" in names  # auto-onboarded
        assert "E2E Project" in names
        assert "Second Project" in names


# ═══════════════════════════════════════════════════════════════════
#  2. MULTI-USER COLLABORATION
#     User A invites B → B accepts → B sees shared resources
# ═══════════════════════════════════════════════════════════════════

class TestMultiUserCollaboration:
    """Test team invitation flows and shared resource visibility."""

    @pytest.mark.asyncio
    async def test_invite_accept_and_share_resources(self, client: AsyncClient, create_test_user):
        """User A invites B to team. After B accepts, B can see team projects."""

        # User A: full setup
        user_a = await create_test_user(name="Alice")
        headers_a = await _headers(user_a)
        team = await _create_team(client, headers_a, "Shared Team")
        await _create_project(client, headers_a, team["id"], "Shared Project")

        # User B: register
        user_b = await create_test_user(name="Bob")
        headers_b = await _headers(user_b)

        # B can only see their own auto-onboarded project (not A's)
        b_projects = await client.get("/api/projects", headers=headers_b)
        assert b_projects.status_code == 200
        b_initial_count = len(b_projects.json())
        assert b_initial_count == 1  # auto-onboarded "Default Project"

        # A invites B — capture the plain token from the email mock
        with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock) as mock_email:
            mock_email.return_value = True
            invite_resp = await client.post(
                f"/api/teams/{team['id']}/invite",
                json={"email": user_b["email"], "role": "member"},
                headers=headers_a,
            )
            assert invite_resp.status_code in (200, 201), f"Invite failed: {invite_resp.text}"
            # Token is NOT in the API response — it's passed to the email function
            mock_email.assert_called_once()
            call_kw = mock_email.call_args.kwargs if mock_email.call_args.kwargs else {}
            plain_token = call_kw.get("token")
            if plain_token is None and mock_email.call_args.args:
                plain_token = mock_email.call_args.args[1]  # positional arg
            assert plain_token is not None, "Token not captured from email mock"

        # B accepts invitation using the token from the email
        accept_resp = await client.post(
            "/api/teams/accept-invite",
            json={"token": plain_token},
            headers=headers_b,
        )
        assert accept_resp.status_code == 200

        # Now B can see A's team projects + their own auto-onboarded project
        b_projects2 = await client.get("/api/projects", headers=headers_b)
        assert b_projects2.status_code == 200
        projects = b_projects2.json()
        assert len(projects) == b_initial_count + 1  # +1 from shared team
        project_names = {p["name"] for p in projects}
        assert "Shared Project" in project_names

        # B can see team members
        members_resp = await client.get(
            f"/api/teams/{team['id']}/members",
            headers=headers_b,
        )
        assert members_resp.status_code == 200
        members = members_resp.json()
        assert len(members) == 2
        roles = {m["role"] for m in members}
        assert "owner" in roles
        assert "member" in roles

    @pytest.mark.asyncio
    async def test_member_cannot_perform_owner_actions(self, client: AsyncClient, create_test_user):
        """A team member cannot perform owner-only actions like inviting others."""

        user_a = await create_test_user(name="Alice")
        headers_a = await _headers(user_a)
        team = await _create_team(client, headers_a, "Owner Team")

        user_b = await create_test_user(name="Bob")
        headers_b = await _headers(user_b)

        # A invites B as member — capture token from email mock
        with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock) as mock_email:
            mock_email.return_value = True
            await client.post(
                f"/api/teams/{team['id']}/invite",
                json={"email": user_b["email"], "role": "member"},
                headers=headers_a,
            )
            call_kw = mock_email.call_args.kwargs if mock_email.call_args.kwargs else {}
            plain_token = call_kw.get("token")
            if plain_token is None and mock_email.call_args.args:
                plain_token = mock_email.call_args.args[1]

        # B accepts
        await client.post(
            "/api/teams/accept-invite",
            json={"token": plain_token},
            headers=headers_b,
        )

        # B tries to invite someone → should be forbidden (member role)
        user_c = await create_test_user(name="Charlie")
        with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock):
            bad_invite = await client.post(
                f"/api/teams/{team['id']}/invite",
                json={"email": user_c["email"], "role": "member"},
                headers=headers_b,
            )
            assert bad_invite.status_code == 403

    @pytest.mark.asyncio
    async def test_decline_invitation(self, client: AsyncClient, create_test_user):
        """User B can decline an invitation from User A."""

        user_a = await create_test_user(name="Alice")
        headers_a = await _headers(user_a)
        team = await _create_team(client, headers_a, "Decline Team")

        user_b = await create_test_user(name="Bob")
        headers_b = await _headers(user_b)

        with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock) as mock_email:
            mock_email.return_value = True
            await client.post(
                f"/api/teams/{team['id']}/invite",
                json={"email": user_b["email"], "role": "member"},
                headers=headers_a,
            )
            call_kw = mock_email.call_args.kwargs if mock_email.call_args.kwargs else {}
            plain_token = call_kw.get("token")
            if plain_token is None and mock_email.call_args.args:
                plain_token = mock_email.call_args.args[1]

        # B declines
        decline_resp = await client.post(
            "/api/teams/decline-invite",
            json={"token": plain_token},
            headers=headers_b,
        )
        assert decline_resp.status_code == 200

        # B still cannot see A's projects (only their own auto-onboarded project)
        b_projects = await client.get("/api/projects", headers=headers_b)
        assert b_projects.status_code == 200
        assert len(b_projects.json()) == 1  # only auto-onboarded "Default Project"
        assert b_projects.json()[0]["name"] == "Default Project"


# ═══════════════════════════════════════════════════════════════════
#  3. BUDGET ENFORCEMENT CHAIN
#     Set budget → Spend → Threshold alert → Exceed → Block
# ═══════════════════════════════════════════════════════════════════

class TestBudgetEnforcementChain:
    """End-to-end budget lifecycle from spending to alerts to blocking."""

    @pytest.mark.asyncio
    async def test_spend_triggers_warning_then_exceeded_alert(self, client: AsyncClient, create_test_user):
        """Spending that crosses threshold creates warning; exceeding creates critical."""

        # Setup with $100 budget (10000 cents), 80% threshold
        user = await create_test_user()
        headers = await _headers(user)
        team = await _create_team(client, headers)
        project = await _create_project(
            client, headers, team["id"],
            budget_cents=10000,
        )
        pid = project["id"]

        # Step 1: Spend under threshold (70%) — no alerts expected
        await _log_usage(client, pid, cost_cents=7000, latency_ms=100)

        alerts_resp = await client.get("/api/alerts", headers=headers)
        assert alerts_resp.status_code == 200
        alerts = alerts_resp.json()
        # Should have no alerts (70% < 80% threshold)
        budget_alerts = [a for a in alerts if "budget" in a.get("alert_type", "")]
        assert len(budget_alerts) == 0

        # Step 2: Push past threshold (85%) — should trigger warning
        await _log_usage(client, pid, cost_cents=1500, latency_ms=100)

        alerts_resp2 = await client.get("/api/alerts", headers=headers)
        alerts2 = alerts_resp2.json()
        warnings = [a for a in alerts2 if a.get("alert_type") == "budget_warning"]
        assert len(warnings) == 1
        assert warnings[0]["severity"] == "warning"
        assert warnings[0]["is_read"] is False

        # Step 3: Exceed budget (105%) — should trigger critical
        await _log_usage(client, pid, cost_cents=2000, latency_ms=100)

        alerts_resp3 = await client.get("/api/alerts", headers=headers)
        alerts3 = alerts_resp3.json()
        critical = [a for a in alerts3 if a.get("alert_type") == "budget_exceeded"]
        assert len(critical) == 1
        assert critical[0]["severity"] == "critical"

        # Step 4: Budget check should now block
        budget_check = await client.get(
            f"/internal/budget/{pid}",
            headers=INTERNAL_HEADERS,
        )
        assert budget_check.status_code == 200
        bdata = budget_check.json()
        assert bdata["allowed"] is False
        assert bdata["spent_cents"] == 10500
        assert bdata["pct_used"] == 105.0

    @pytest.mark.asyncio
    async def test_no_budget_means_unlimited(self, client: AsyncClient, create_test_user):
        """A project with no budget should always be allowed, no alerts."""

        user = await create_test_user()
        headers = await _headers(user)
        team = await _create_team(client, headers)
        project = await _create_project(
            client, headers, team["id"],
            budget_cents=None,  # no budget
        )
        pid = project["id"]

        # Log heavy usage
        for _ in range(5):
            await _log_usage(client, pid, cost_cents=99999, latency_ms=100)

        # Still allowed
        budget_check = await client.get(
            f"/internal/budget/{pid}",
            headers=INTERNAL_HEADERS,
        )
        assert budget_check.status_code == 200
        assert budget_check.json()["allowed"] is True

        # No alerts created
        alerts_resp = await client.get("/api/alerts", headers=headers)
        alerts = alerts_resp.json()
        assert len(alerts) == 0

    @pytest.mark.asyncio
    async def test_budget_update_changes_enforcement(self, client: AsyncClient, create_test_user):
        """Updating budget affects future enforcement."""

        user = await create_test_user()
        headers = await _headers(user)
        team = await _create_team(client, headers)
        project = await _create_project(client, headers, team["id"], budget_cents=1000)
        pid = project["id"]

        # Spend 900 (near limit)
        await _log_usage(client, pid, cost_cents=900, latency_ms=100)

        # Budget check: allowed (900 < 1000)
        check1 = await client.get(f"/internal/budget/{pid}", headers=INTERNAL_HEADERS)
        assert check1.json()["allowed"] is True

        # Spend 200 more → exceed
        await _log_usage(client, pid, cost_cents=200, latency_ms=100)

        check2 = await client.get(f"/internal/budget/{pid}", headers=INTERNAL_HEADERS)
        assert check2.json()["allowed"] is False

        # Update budget to $50 (5000 cents) — now 1100 < 5000 → allowed again
        update_resp = await client.put(
            f"/api/budget/{pid}",
            json={"budget_monthly_cents": 5000},
            headers=headers,
        )
        assert update_resp.status_code == 200

        check3 = await client.get(f"/internal/budget/{pid}", headers=INTERNAL_HEADERS)
        assert check3.json()["allowed"] is True

    @pytest.mark.asyncio
    async def test_cache_hit_is_free(self, client: AsyncClient, create_test_user):
        """Cache hits should not increment spend."""

        user = await create_test_user()
        headers = await _headers(user)
        team = await _create_team(client, headers)
        project = await _create_project(client, headers, team["id"], budget_cents=100)
        pid = project["id"]

        # Log a cache hit — cost_cents should be zeroed
        await _log_usage(client, pid, cost_cents=50, cache_hit=True, latency_ms=5)

        budget_check = await client.get(
            f"/internal/budget/{pid}",
            headers=INTERNAL_HEADERS,
        )
        assert budget_check.json()["spent_cents"] == 0


# ═══════════════════════════════════════════════════════════════════
#  4. AUTH TOKEN LIFECYCLE
#     Login → Refresh (rotation) → Logout → Revoked token rejected
# ═══════════════════════════════════════════════════════════════════

class TestAuthTokenValidation:
    """Verify that invalid/missing tokens are properly rejected."""

    @pytest.mark.asyncio
    async def test_invalid_token_rejected(self, client: AsyncClient):
        """A crafted/invalid token is rejected."""

        resp = await client.get("/api/auth/me", headers={
            "Authorization": "Bearer totally.invalid.token",
        })
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_no_auth_header_rejected(self, client: AsyncClient):
        """Endpoints requiring auth reject requests without Authorization."""

        resp = await client.get("/api/auth/me")
        assert resp.status_code in (401, 403)


# ═══════════════════════════════════════════════════════════════════
#  5. API KEY SECURITY
#     Create → Validate → Revoke → Reject revoked → Reject invalid
# ═══════════════════════════════════════════════════════════════════

class TestApiKeySecurity:
    """API key lifecycle and security validations."""

    @pytest.mark.asyncio
    async def test_key_lifecycle_create_validate_revoke(self, client: AsyncClient, create_test_user):
        """Create key → validate → revoke → validate returns invalid."""

        setup = await _full_setup(client, create_test_user)
        raw_key = setup["key"]["key"]
        key_id = setup["key"]["id"]

        # Key is valid
        v1 = await client.post(
            "/internal/validate-key",
            json={"key": raw_key},
            headers=INTERNAL_HEADERS,
        )
        assert v1.json()["valid"] is True

        # Revoke the key
        del_resp = await client.delete(
            f"/api/keys/{key_id}",
            headers=setup["headers"],
        )
        assert del_resp.status_code in (200, 204)

        # Key is now invalid
        v2 = await client.post(
            "/internal/validate-key",
            json={"key": raw_key},
            headers=INTERNAL_HEADERS,
        )
        assert v2.json()["valid"] is False

    @pytest.mark.asyncio
    async def test_invalid_key_rejected(self, client: AsyncClient):
        """A totally fake key should return valid=False."""

        resp = await client.post(
            "/internal/validate-key",
            json={"key": "sk_styx_totally_fake_key_123456"},
            headers=INTERNAL_HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["valid"] is False

    @pytest.mark.asyncio
    async def test_internal_endpoints_require_secret(self, client: AsyncClient):
        """Internal endpoints without X-Internal-Secret return 403."""

        resp = await client.post("/internal/validate-key", json={"key": "test"})
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_internal_endpoints_reject_wrong_secret(self, client: AsyncClient):
        """Internal endpoints with wrong secret return 403."""

        resp = await client.post(
            "/internal/validate-key",
            json={"key": "test"},
            headers={"X-Internal-Secret": "wrong-secret"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_multiple_keys_per_project(self, client: AsyncClient, create_test_user):
        """Can create multiple keys for the same project, all independently valid."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]
        headers = setup["headers"]

        key2 = await _create_key(client, headers, pid, "second-key")
        key3 = await _create_key(client, headers, pid, "third-key")

        # All keys are valid
        for k in [setup["key"]["key"], key2["key"], key3["key"]]:
            v = await client.post(
                "/internal/validate-key",
                json={"key": k},
                headers=INTERNAL_HEADERS,
            )
            assert v.json()["valid"] is True

        # Keys list shows all 3
        keys_resp = await client.get("/api/keys", headers=headers)
        assert len(keys_resp.json()) == 3

    @pytest.mark.asyncio
    async def test_key_prefix_matches_creation(self, client: AsyncClient, create_test_user):
        """The key prefix stored in DB matches the beginning of the raw key."""

        setup = await _full_setup(client, create_test_user)
        raw_key = setup["key"]["key"]
        key_prefix = setup["key"]["key_prefix"]

        assert raw_key.startswith(key_prefix)


# ═══════════════════════════════════════════════════════════════════
#  6. ANALYTICS DATA INTEGRITY
#     Log usage → Query analytics → Verify correct aggregation
# ═══════════════════════════════════════════════════════════════════

class TestAnalyticsDataIntegrity:
    """Verify analytics endpoints return correctly aggregated data."""

    @pytest.mark.asyncio
    async def test_analytics_reflect_logged_usage(self, client: AsyncClient, create_test_user):
        """Analytics overview matches exact log entries."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]
        headers = setup["headers"]

        # Log varied usage
        await _log_usage(client, pid, provider="openai", model="gpt-4o", latency_ms=200, cost_cents=20)
        await _log_usage(client, pid, provider="openai", model="gpt-4o-mini", latency_ms=100, cost_cents=5)
        await _log_usage(client, pid, provider="anthropic", model="claude-3-5-haiku", latency_ms=150, cost_cents=10)
        await _log_usage(client, pid, provider="openai", model="gpt-4o", latency_ms=300, cost_cents=25, cache_hit=True)
        await _log_usage(client, pid, provider="google", model="gemini-1.5-flash", latency_ms=80, cost_cents=3, was_fallback=True)

        # Overview
        overview = await client.get("/api/analytics/overview?days=30", headers=headers)
        assert overview.status_code == 200
        data = overview.json()
        assert data["total_requests"] == 5
        # 1 cache hit out of 5
        assert data["cache_hits"] == 1
        # 1 fallback out of 5
        assert data["fallback_rate"] > 0

        # By provider
        by_prov = await client.get("/api/analytics/by-provider?days=30", headers=headers)
        assert by_prov.status_code == 200
        providers = {p["provider"]: p for p in by_prov.json()}
        assert providers["openai"]["request_count"] == 3
        assert providers["anthropic"]["request_count"] == 1
        assert providers["google"]["request_count"] == 1

        # By model
        by_model = await client.get("/api/analytics/by-model?days=30", headers=headers)
        assert by_model.status_code == 200
        models = {m["model"]: m for m in by_model.json()}
        assert models["gpt-4o"]["request_count"] == 2
        assert models["gpt-4o-mini"]["request_count"] == 1

    @pytest.mark.asyncio
    async def test_analytics_by_day_returns_chronological_data(self, client: AsyncClient, create_test_user):
        """By-day analytics returns data sorted chronologically."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]
        headers = setup["headers"]

        # All logged today
        await _log_usage(client, pid, cost_cents=5)
        await _log_usage(client, pid, cost_cents=10)

        by_day = await client.get("/api/analytics/by-day?days=30", headers=headers)
        assert by_day.status_code == 200
        days = by_day.json()
        assert len(days) >= 1  # at least today
        assert days[0]["request_count"] == 2

    @pytest.mark.asyncio
    async def test_analytics_empty_when_no_usage(self, client: AsyncClient, create_test_user):
        """Analytics return zeros when there's no logged usage."""

        setup = await _full_setup(client, create_test_user)
        headers = setup["headers"]

        overview = await client.get("/api/analytics/overview?days=30", headers=headers)
        assert overview.status_code == 200
        data = overview.json()
        assert data["total_requests"] == 0
        assert data["avg_latency_ms"] == 0

    @pytest.mark.asyncio
    async def test_analytics_isolated_between_users(self, client: AsyncClient, create_test_user):
        """User A's analytics don't leak into User B's results."""

        # User A with usage
        setup_a = await _full_setup(client, create_test_user)
        await _log_usage(client, setup_a["project"]["id"], cost_cents=100)

        # User B with their own setup
        user_b = await create_test_user(name="User B")
        headers_b = await _headers(user_b)
        team_b = await _create_team(client, headers_b, "Team B")
        await _create_project(client, headers_b, team_b["id"], "Project B")

        # B's analytics should be empty (no usage logged for B's project)
        overview_b = await client.get("/api/analytics/overview?days=30", headers=headers_b)
        assert overview_b.status_code == 200
        assert overview_b.json()["total_requests"] == 0


# ═══════════════════════════════════════════════════════════════════
#  7. ALERT MANAGEMENT E2E
#     Create alerts → List → Filter → Mark read → Mark all read
# ═══════════════════════════════════════════════════════════════════

class TestAlertManagementE2E:
    """End-to-end alert creation and management flows."""

    @pytest.mark.asyncio
    async def test_alert_anti_spam_deduplication(self, client: AsyncClient, create_test_user):
        """Multiple spend events past threshold only create one alert per type."""

        user = await create_test_user()
        headers = await _headers(user)
        team = await _create_team(client, headers)
        project = await _create_project(client, headers, team["id"], budget_cents=1000)
        pid = project["id"]

        # Push past warning threshold multiple times
        await _log_usage(client, pid, cost_cents=850)  # 85% → warning
        await _log_usage(client, pid, cost_cents=50)   # 90% → still warning zone
        await _log_usage(client, pid, cost_cents=50)   # 95% → still warning zone

        alerts_resp = await client.get("/api/alerts", headers=headers)
        warnings = [a for a in alerts_resp.json() if a["alert_type"] == "budget_warning"]
        # Anti-spam: only ONE warning alert, not three
        assert len(warnings) == 1

    @pytest.mark.asyncio
    async def test_mark_all_read_then_filter_unread(self, client: AsyncClient, create_test_user):
        """Mark all read → filter unread returns empty."""

        user = await create_test_user()
        headers = await _headers(user)
        team = await _create_team(client, headers)
        project = await _create_project(client, headers, team["id"], budget_cents=1000)
        pid = project["id"]

        # Trigger warning alert
        await _log_usage(client, pid, cost_cents=850)

        # Confirm alert exists
        alerts = await client.get("/api/alerts", headers=headers)
        assert len(alerts.json()) >= 1
        assert any(not a["is_read"] for a in alerts.json())

        # Mark all read
        mark_resp = await client.post("/api/alerts/mark-all-read", headers=headers)
        assert mark_resp.status_code == 200
        assert mark_resp.json()["marked_read"] >= 1

        # Filter unread → empty
        unread = await client.get("/api/alerts?unread_only=true", headers=headers)
        assert unread.status_code == 200
        assert len(unread.json()) == 0


# ═══════════════════════════════════════════════════════════════════
#  8. BILLING PLANS E2E
#     Get plans → Check overview → Change plan
# ═══════════════════════════════════════════════════════════════════

class TestBillingE2E:
    """Billing flow tests (using mock Stripe mode)."""

    @pytest.mark.asyncio
    async def test_plans_list_is_public(self, client: AsyncClient):
        """Plans endpoint is accessible without authentication."""

        resp = await client.get("/api/billing/plans")
        assert resp.status_code == 200
        plans = resp.json()
        assert len(plans) >= 1
        plan_names = {p["name"] for p in plans}
        assert "Shade" in plan_names

    @pytest.mark.asyncio
    async def test_billing_overview_requires_team_owner(self, client: AsyncClient, create_test_user):
        """Only team owners can see billing overview (auto-onboarded users are owners)."""

        # Setup — auto-onboarded team is used (no need to create another)
        user = await create_test_user()
        headers = await _headers(user)

        overview = await client.get("/api/billing/overview", headers=headers)
        assert overview.status_code == 200
        data = overview.json()
        assert "plan" in data
        assert data["plan"] == "shade"

    @pytest.mark.asyncio
    async def test_change_plan_flow(self, client: AsyncClient, create_test_user):
        """Can change from shade to obol plan using auto-onboarded team."""

        user = await create_test_user()
        headers = await _headers(user)

        # Check current plan (auto-onboarded team)
        overview1 = await client.get("/api/billing/overview", headers=headers)
        assert overview1.json()["plan"] == "shade"

        # Upgrade to obol
        change = await client.post(
            "/api/billing/change-plan",
            json={"plan": "obol"},
            headers=headers,
        )
        assert change.status_code == 200
        assert change.json()["plan"] == "obol"

        # Verify plan changed
        overview2 = await client.get("/api/billing/overview", headers=headers)
        assert overview2.json()["plan"] == "obol"


# ═══════════════════════════════════════════════════════════════════
#  9. CROSS-SERVICE DATA CONSISTENCY
#     Verify data integrity across endpoints
# ═══════════════════════════════════════════════════════════════════

class TestCrossServiceConsistency:
    """Verify data consistency across different service boundaries."""

    @pytest.mark.asyncio
    async def test_budget_api_reflects_internal_spend(self, client: AsyncClient, create_test_user):
        """The public /api/budget endpoint shows spend from internal /log-usage."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]
        headers = setup["headers"]

        # Log usage through internal endpoint
        await _log_usage(client, pid, cost_cents=1234)

        # Public budget API should reflect spend
        budget_resp = await client.get("/api/budget", headers=headers)
        assert budget_resp.status_code == 200
        budgets = budget_resp.json()
        project_budget = next(b for b in budgets if b["project_id"] == pid)
        assert project_budget["spent_cents"] == 1234

    @pytest.mark.asyncio
    async def test_routing_logs_match_log_usage_calls(self, client: AsyncClient, create_test_user):
        """Each /internal/log-usage call creates exactly one routing log entry."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]
        setup["headers"]

        # Log 3 unique entries
        await _log_usage(client, pid, provider="openai", model="gpt-4o")
        await _log_usage(client, pid, provider="anthropic", model="claude-3-5-haiku")
        await _log_usage(client, pid, provider="google", model="gemini-1.5-flash")

        # Routing logs should have exactly 3 entries (internal endpoint)
        logs_resp = await client.get("/internal/routing-logs", headers=INTERNAL_HEADERS)
        assert logs_resp.status_code == 200
        logs = logs_resp.json()
        assert len(logs) == 3

        # Each provider should appear once
        providers = {log["provider"] for log in logs}
        assert providers == {"openai", "anthropic", "google"}

    @pytest.mark.asyncio
    async def test_routing_logs_scoped_by_project_id(self, client: AsyncClient, create_test_user):
        """Routing logs can be filtered by project_id (internal endpoint)."""

        # User A logs usage
        setup_a = await _full_setup(client, create_test_user)
        await _log_usage(client, setup_a["project"]["id"], provider="openai")

        # User B logs usage
        user_b = await create_test_user(name="Bob")
        headers_b = await _headers(user_b)
        team_b = await _create_team(client, headers_b, "Bob Team")
        proj_b = await _create_project(client, headers_b, team_b["id"], "Bob Project")
        await _log_usage(client, proj_b["id"], provider="anthropic")

        # Filter by project A — sees only openai
        logs_a = await client.get(
            f"/internal/routing-logs?project_id={setup_a['project']['id']}",
            headers=INTERNAL_HEADERS,
        )
        assert logs_a.status_code == 200
        assert len(logs_a.json()) == 1
        assert logs_a.json()[0]["provider"] == "openai"

        # Filter by project B — sees only anthropic
        logs_b = await client.get(
            f"/internal/routing-logs?project_id={proj_b['id']}",
            headers=INTERNAL_HEADERS,
        )
        assert logs_b.status_code == 200
        assert len(logs_b.json()) == 1
        assert logs_b.json()[0]["provider"] == "anthropic"

    @pytest.mark.asyncio
    async def test_validate_key_returns_correct_project_and_team(self, client: AsyncClient, create_test_user):
        """Validate-key returns the exact project and team IDs from setup."""

        setup = await _full_setup(client, create_test_user)

        resp = await client.post(
            "/internal/validate-key",
            json={"key": setup["key"]["key"]},
            headers=INTERNAL_HEADERS,
        )
        data = resp.json()
        assert data["project_id"] == setup["project"]["id"]
        assert data["team_id"] == setup["team"]["id"]

    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """The /health endpoint returns ok."""

        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


# ═══════════════════════════════════════════════════════════════════
#  10. PROJECT LIFECYCLE — DELETE
#      Create → Use → Delete → Verify cleanup
# ═══════════════════════════════════════════════════════════════════

class TestProjectDeletion:
    """DELETE /projects/{id} endpoint tests."""

    @pytest.mark.asyncio
    async def test_delete_project_success(self, client: AsyncClient, create_test_user):
        """Admin can delete a project and it disappears from listings."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]
        headers = setup["headers"]

        # Confirm project exists
        resp = await client.get(f"/api/projects/{pid}", headers=headers)
        assert resp.status_code == 200

        # Delete the project
        del_resp = await client.delete(f"/api/projects/{pid}", headers=headers)
        assert del_resp.status_code == 204

        # Project is gone
        get_resp = await client.get(f"/api/projects/{pid}", headers=headers)
        assert get_resp.status_code == 404

        # Not in project list
        list_resp = await client.get("/api/projects", headers=headers)
        project_ids = [p["id"] for p in list_resp.json()]
        assert pid not in project_ids

    @pytest.mark.asyncio
    async def test_delete_project_cascades_api_keys(self, client: AsyncClient, create_test_user):
        """Deleting a project also invalidates its API keys."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]
        raw_key = setup["key"]["key"]
        headers = setup["headers"]

        # Key is valid before delete
        v1 = await client.post(
            "/internal/validate-key",
            json={"key": raw_key},
            headers=INTERNAL_HEADERS,
        )
        assert v1.json()["valid"] is True

        # Delete the project
        del_resp = await client.delete(f"/api/projects/{pid}", headers=headers)
        assert del_resp.status_code == 204

        # Key is now invalid (project gone)
        v2 = await client.post(
            "/internal/validate-key",
            json={"key": raw_key},
            headers=INTERNAL_HEADERS,
        )
        assert v2.json()["valid"] is False

    @pytest.mark.asyncio
    async def test_delete_project_requires_admin(self, client: AsyncClient, create_test_user):
        """A viewer/member cannot delete a project."""

        setup = await _full_setup(client, create_test_user)
        pid = setup["project"]["id"]

        # Register a second user
        user_b = await create_test_user(name="Viewer")
        headers_b = await _headers(user_b)

        # Viewer cannot delete
        del_resp = await client.delete(f"/api/projects/{pid}", headers=headers_b)
        assert del_resp.status_code in (403, 404)

    @pytest.mark.asyncio
    async def test_delete_nonexistent_project(self, client: AsyncClient, create_test_user):
        """Deleting a project that doesn't exist returns 404."""

        user = await create_test_user()
        headers = await _headers(user)
        await _create_team(client, headers)

        fake_id = str(uuid.uuid4())
        del_resp = await client.delete(f"/api/projects/{fake_id}", headers=headers)
        assert del_resp.status_code == 404


# NOTE: TestAccountLockout removed — login endpoint deleted (Supabase Auth handles lockout).
