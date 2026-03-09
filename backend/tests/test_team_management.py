"""Tests for team management: members, invitations, roles.

Covers:
  - Team creation auto-adds owner as TeamMember(role="owner")
  - Invite user by email → sends invitation email
  - Accept invitation → user becomes member
  - Decline invitation → user is NOT a member
  - Cancel invitation → token becomes invalid
  - Invite already-member → 409
  - Invite duplicate pending → 409
  - Accept with invalid/expired token → 400
  - List members / invitations
  - Update member role (owner only)
  - Remove member (with permission checks)
  - Leave team (self-removal)
  - Cannot remove/change owner
  - Members can see teams and projects
  - Permission hierarchy: owner > admin > member
"""


import pytest
from unittest.mock import AsyncMock, patch


# ─── Helpers ──────────────────────────────────────────────────────────
# NOTE: Use `create_test_user` fixture from conftest.py to create users.


async def _create_team(client, headers, name="My Team"):
    """Create a team and return the team data."""
    resp = await client.post("/api/teams", json={"name": name}, headers=headers)
    assert resp.status_code == 201, f"Team creation failed: {resp.text}"
    return resp.json()


async def _invite(client, headers, team_id, email, role="member"):
    """Invite a user and return the invitation data."""
    with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock) as mock_email:
        mock_email.return_value = True
        resp = await client.post(
            f"/api/teams/{team_id}/invite",
            json={"email": email, "role": role},
            headers=headers,
        )
        token = None
        if mock_email.called:
            token = mock_email.call_args[1].get("token") or mock_email.call_args[0][1]
        return resp, token


# ─── Team creation with auto-owner ─────────────────────────────────

@pytest.mark.asyncio
async def test_create_team_adds_owner_member(client, db_session, create_test_user):
    """Creating a team should auto-add the creator as a member with owner role."""
    owner = await create_test_user(email="owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    # Check members list
    resp = await client.get(
        f"/api/teams/{team['id']}/members",
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    members = resp.json()
    assert len(members) == 1
    assert members[0]["role"] == "owner"
    assert members[0]["user_email"] == "owner@styx.dev"


@pytest.mark.asyncio
async def test_list_teams_returns_member_teams(client, db_session, create_test_user):
    """User should see all teams they are a member of (not just owned)."""
    owner = await create_test_user(email="teamowner@styx.dev")
    team = await _create_team(client, owner["headers"], name="Shared Team")

    # Invite and accept
    member = await create_test_user(email="teammember@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "teammember@styx.dev")
    assert resp.status_code == 201

    accept_resp = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=member["headers"])
    assert accept_resp.status_code == 200

    # Member should see the team
    resp = await client.get("/api/teams", headers=member["headers"])
    assert resp.status_code == 200
    team_ids = [t["id"] for t in resp.json()]
    assert team["id"] in team_ids


# ─── Invitation flow ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_sends_email(client, db_session, create_test_user):
    """Inviting a user should send an invitation email."""
    owner = await create_test_user(email="inviter@styx.dev", name="Inviter")
    team = await _create_team(client, owner["headers"], name="Email Team")

    with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock) as mock_email:
        mock_email.return_value = True
        resp = await client.post(
            f"/api/teams/{team['id']}/invite",
            json={"email": "invited@styx.dev", "role": "member"},
            headers=owner["headers"],
        )
        assert resp.status_code == 201
        mock_email.assert_called_once()
        call_kwargs = mock_email.call_args
        assert call_kwargs[1]["to_email"] == "invited@styx.dev"
        assert call_kwargs[1]["team_name"] == "Email Team"
        assert call_kwargs[1]["role"] == "member"


@pytest.mark.asyncio
async def test_full_invite_accept_flow(client, db_session, create_test_user):
    """Full flow: invite → accept → user is now a member."""
    owner = await create_test_user(email="flow_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    invitee = await create_test_user(email="flow_invitee@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "flow_invitee@styx.dev")
    assert resp.status_code == 201

    # Accept
    accept_resp = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=invitee["headers"])
    assert accept_resp.status_code == 200
    data = accept_resp.json()
    assert data["role"] == "member"
    assert data["team_id"] == team["id"]

    # Verify they appear in member list
    members_resp = await client.get(
        f"/api/teams/{team['id']}/members",
        headers=owner["headers"],
    )
    assert len(members_resp.json()) == 2  # owner + invitee


@pytest.mark.asyncio
async def test_invite_as_admin(client, db_session, create_test_user):
    """Invite with admin role → accepted user becomes admin."""
    owner = await create_test_user(email="admin_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    invitee = await create_test_user(email="admin_invitee@styx.dev")
    resp, token = await _invite(
        client, owner["headers"], team["id"],
        "admin_invitee@styx.dev", role="admin"
    )
    assert resp.status_code == 201

    accept_resp = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=invitee["headers"])
    assert accept_resp.status_code == 200
    assert accept_resp.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_decline_invitation(client, db_session, create_test_user):
    """Declining an invitation should not create a membership."""
    owner = await create_test_user(email="decline_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    invitee = await create_test_user(email="decline_invitee@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "decline_invitee@styx.dev")
    assert resp.status_code == 201

    decline_resp = await client.post("/api/teams/decline-invite", json={
        "token": token,
    }, headers=invitee["headers"])
    assert decline_resp.status_code == 200

    # Member list should still have only the owner
    members_resp = await client.get(
        f"/api/teams/{team['id']}/members",
        headers=owner["headers"],
    )
    assert len(members_resp.json()) == 1


@pytest.mark.asyncio
async def test_cancel_invitation(client, db_session, create_test_user):
    """Owner can cancel a pending invitation."""
    owner = await create_test_user(email="cancel_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    resp, token = await _invite(client, owner["headers"], team["id"], "cancelled@styx.dev")
    assert resp.status_code == 201
    invitation_id = resp.json()["id"]

    # Cancel
    cancel_resp = await client.delete(
        f"/api/teams/{team['id']}/invitations/{invitation_id}",
        headers=owner["headers"],
    )
    assert cancel_resp.status_code == 200

    # Token should no longer work
    invitee = await create_test_user(email="cancelled@styx.dev")
    accept_resp = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=invitee["headers"])
    assert accept_resp.status_code == 400


# ─── Invitation edge cases ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_already_member_409(client, db_session, create_test_user):
    """Inviting someone who is already a member returns 409."""
    owner = await create_test_user(email="dup_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    # Invite and accept
    member = await create_test_user(email="dup_member@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "dup_member@styx.dev")
    assert resp.status_code == 201

    await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=member["headers"])

    # Try to invite again
    resp2, _ = await _invite(client, owner["headers"], team["id"], "dup_member@styx.dev")
    assert resp2.status_code == 409
    assert "already a member" in resp2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_invite_duplicate_pending_409(client, db_session, create_test_user):
    """Sending a second invitation to the same email while one is pending → 409."""
    owner = await create_test_user(email="dup_inv_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    resp1, _ = await _invite(client, owner["headers"], team["id"], "dup_pending@styx.dev")
    assert resp1.status_code == 201

    resp2, _ = await _invite(client, owner["headers"], team["id"], "dup_pending@styx.dev")
    assert resp2.status_code == 409
    assert "pending invitation" in resp2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_accept_invalid_token_400(client, db_session, create_test_user):
    """Accepting with a wrong token returns 400."""
    user = await create_test_user(email="bad_token@styx.dev")
    resp = await client.post("/api/teams/accept-invite", json={
        "token": "totally-invalid-token",
    }, headers=user["headers"])
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_accept_already_accepted_idempotent(client, db_session, create_test_user):
    """Accepting an already-used token is idempotent (returns existing member)."""
    owner = await create_test_user(email="idempotent_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    invitee = await create_test_user(email="idempotent_invitee@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "idempotent_invitee@styx.dev")
    assert resp.status_code == 201

    # First accept
    resp1 = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=invitee["headers"])
    assert resp1.status_code == 200

    # Second accept with same token should fail (token already consumed)
    resp2 = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=invitee["headers"])
    assert resp2.status_code == 400


# ─── List invitations ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_pending_invitations(client, db_session, create_test_user):
    """Admin+ can list pending invitations."""
    owner = await create_test_user(email="list_inv_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    # Send 2 invitations
    await _invite(client, owner["headers"], team["id"], "pending1@styx.dev")
    await _invite(client, owner["headers"], team["id"], "pending2@styx.dev")

    resp = await client.get(
        f"/api/teams/{team['id']}/invitations",
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


# ─── Member role management ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_member_role(client, db_session, create_test_user):
    """Owner can change a member's role."""
    owner = await create_test_user(email="role_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    member = await create_test_user(email="role_member@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "role_member@styx.dev")
    accept_resp = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=member["headers"])
    member_id = accept_resp.json()["id"]

    # Promote to admin
    resp = await client.put(
        f"/api/teams/{team['id']}/members/{member_id}",
        json={"role": "admin"},
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_cannot_change_owner_role(client, db_session, create_test_user):
    """Cannot change the owner's role."""
    owner = await create_test_user(email="nochange_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    # Get owner member ID
    members_resp = await client.get(
        f"/api/teams/{team['id']}/members",
        headers=owner["headers"],
    )
    owner_member_id = members_resp.json()[0]["id"]

    resp = await client.put(
        f"/api/teams/{team['id']}/members/{owner_member_id}",
        json={"role": "member"},
        headers=owner["headers"],
    )
    assert resp.status_code == 400
    assert "owner" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_non_owner_cannot_change_roles(client, db_session, create_test_user):
    """Admin cannot change roles (owner-only operation)."""
    owner = await create_test_user(email="perm_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    admin = await create_test_user(email="perm_admin@styx.dev")
    resp, token = await _invite(
        client, owner["headers"], team["id"],
        "perm_admin@styx.dev", role="admin"
    )
    await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=admin["headers"])

    # Add a member
    member = await create_test_user(email="perm_member@styx.dev")
    resp, token = await _invite(
        client, owner["headers"], team["id"],
        "perm_member@styx.dev"
    )
    accept_resp2 = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=member["headers"])
    member_id = accept_resp2.json()["id"]

    # Admin tries to change role → 404 (not owner)
    resp = await client.put(
        f"/api/teams/{team['id']}/members/{member_id}",
        json={"role": "admin"},
        headers=admin["headers"],
    )
    assert resp.status_code == 403


# ─── Remove member / leave team ─────────────────────────────────────

@pytest.mark.asyncio
async def test_owner_can_remove_member(client, db_session, create_test_user):
    """Owner can remove a member."""
    owner = await create_test_user(email="remove_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    member = await create_test_user(email="remove_member@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "remove_member@styx.dev")
    accept_resp = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=member["headers"])
    member_id = accept_resp.json()["id"]

    # Remove
    resp = await client.delete(
        f"/api/teams/{team['id']}/members/{member_id}",
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    assert "removed" in resp.json()["message"].lower()

    # Verify member list has only owner
    members_resp = await client.get(
        f"/api/teams/{team['id']}/members",
        headers=owner["headers"],
    )
    assert len(members_resp.json()) == 1


@pytest.mark.asyncio
async def test_member_can_leave_team(client, db_session, create_test_user):
    """A member can remove themselves (leave the team)."""
    owner = await create_test_user(email="leave_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    member = await create_test_user(email="leave_member@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "leave_member@styx.dev")
    accept_resp = await client.post("/api/teams/accept-invite", json={
        "token": token,
    }, headers=member["headers"])
    member_id = accept_resp.json()["id"]

    # Leave
    resp = await client.delete(
        f"/api/teams/{team['id']}/members/{member_id}",
        headers=member["headers"],
    )
    assert resp.status_code == 200
    assert "left" in resp.json()["message"].lower()


@pytest.mark.asyncio
async def test_cannot_remove_owner(client, db_session, create_test_user):
    """Cannot remove the team owner."""
    owner = await create_test_user(email="nodelete_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    # Get owner member ID
    members_resp = await client.get(
        f"/api/teams/{team['id']}/members",
        headers=owner["headers"],
    )
    owner_member_id = members_resp.json()[0]["id"]

    resp = await client.delete(
        f"/api/teams/{team['id']}/members/{owner_member_id}",
        headers=owner["headers"],
    )
    assert resp.status_code == 400
    assert "owner" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_member_cannot_remove_other_member(client, db_session, create_test_user):
    """A regular member cannot remove another member."""
    owner = await create_test_user(email="noperm_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    member1 = await create_test_user(email="noperm_m1@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "noperm_m1@styx.dev")
    await client.post("/api/teams/accept-invite", json={"token": token}, headers=member1["headers"])

    member2 = await create_test_user(email="noperm_m2@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "noperm_m2@styx.dev")
    accept_resp = await client.post("/api/teams/accept-invite", json={"token": token}, headers=member2["headers"])
    m2_id = accept_resp.json()["id"]

    # member1 tries to remove member2
    resp = await client.delete(
        f"/api/teams/{team['id']}/members/{m2_id}",
        headers=member1["headers"],
    )
    assert resp.status_code == 403


# ─── Member access to projects ──────────────────────────────────────

@pytest.mark.asyncio
async def test_member_can_see_team_projects(client, db_session, create_test_user):
    """A team member can see projects in their team."""
    owner = await create_test_user(email="proj_owner@styx.dev")
    team = await _create_team(client, owner["headers"], name="Project Team")

    # Create a project
    proj_resp = await client.post("/api/projects", json={
        "name": "Shared Project",
        "team_id": team["id"],
    }, headers=owner["headers"])
    assert proj_resp.status_code == 201
    project_id = proj_resp.json()["id"]

    # Invite a member
    member = await create_test_user(email="proj_member@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "proj_member@styx.dev")
    await client.post("/api/teams/accept-invite", json={"token": token}, headers=member["headers"])

    # Member can list projects
    resp = await client.get("/api/projects", headers=member["headers"])
    assert resp.status_code == 200
    project_ids = [p["id"] for p in resp.json()]
    assert project_id in project_ids

    # Member can get specific project
    resp = await client.get(f"/api/projects/{project_id}", headers=member["headers"])
    assert resp.status_code == 200
    assert resp.json()["name"] == "Shared Project"


@pytest.mark.asyncio
async def test_non_member_cannot_see_projects(client, db_session, create_test_user):
    """A user who is not a member cannot see team projects."""
    owner = await create_test_user(email="noaccess_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    proj_resp = await client.post("/api/projects", json={
        "name": "Secret Project",
        "team_id": team["id"],
    }, headers=owner["headers"])
    project_id = proj_resp.json()["id"]

    # Different user
    stranger = await create_test_user(email="stranger@styx.dev")
    resp = await client.get(f"/api/projects/{project_id}", headers=stranger["headers"])
    assert resp.status_code == 404


# ─── Admin can invite ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_can_invite(client, db_session, create_test_user):
    """An admin member can invite new users."""
    owner = await create_test_user(email="admin_inv_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    # Add an admin
    admin = await create_test_user(email="admin_inv_admin@styx.dev")
    resp, token = await _invite(
        client, owner["headers"], team["id"],
        "admin_inv_admin@styx.dev", role="admin"
    )
    await client.post("/api/teams/accept-invite", json={"token": token}, headers=admin["headers"])

    # Admin invites someone
    resp, _ = await _invite(
        client, admin["headers"], team["id"],
        "admin_invited@styx.dev"
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_member_cannot_invite(client, db_session, create_test_user):
    """A regular member cannot invite new users."""
    owner = await create_test_user(email="noinv_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    member = await create_test_user(email="noinv_member@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "noinv_member@styx.dev")
    await client.post("/api/teams/accept-invite", json={"token": token}, headers=member["headers"])

    # Member tries to invite
    resp, _ = await _invite(client, member["headers"], team["id"], "noinv_target@styx.dev")
    assert resp.status_code == 403


# ─── Admin can create projects ──────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_can_create_project(client, db_session, create_test_user):
    """An admin can create projects in the team."""
    owner = await create_test_user(email="adminproj_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    admin = await create_test_user(email="adminproj_admin@styx.dev")
    resp, token = await _invite(
        client, owner["headers"], team["id"],
        "adminproj_admin@styx.dev", role="admin"
    )
    await client.post("/api/teams/accept-invite", json={"token": token}, headers=admin["headers"])

    # Admin creates a project
    resp = await client.post("/api/projects", json={
        "name": "Admin Project",
        "team_id": team["id"],
    }, headers=admin["headers"])
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_member_cannot_create_project(client, db_session, create_test_user):
    """A regular member cannot create projects."""
    owner = await create_test_user(email="noproj_owner@styx.dev")
    team = await _create_team(client, owner["headers"])

    member = await create_test_user(email="noproj_member@styx.dev")
    resp, token = await _invite(client, owner["headers"], team["id"], "noproj_member@styx.dev")
    await client.post("/api/teams/accept-invite", json={"token": token}, headers=member["headers"])

    # Member tries to create project
    resp = await client.post("/api/projects", json={
        "name": "Unauthorized Project",
        "team_id": team["id"],
    }, headers=member["headers"])
    assert resp.status_code == 403  # Member lacks admin role for project creation
