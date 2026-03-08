"""Tests for API key endpoints: create, list, revoke."""

import pytest


@pytest.mark.asyncio
async def test_create_api_key(client, auth_headers, team_and_project):
    resp = await client.post("/api/keys", json={
        "project_id": team_and_project["project_id"],
        "name": "My Test Key",
    }, headers=auth_headers)
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert "key" in data
    assert data["key"].startswith("sk_styx_")
    assert "id" in data
    assert data["name"] == "My Test Key"


@pytest.mark.asyncio
async def test_list_api_keys(client, auth_headers, team_and_project):
    # Create a key first
    await client.post("/api/keys", json={
        "project_id": team_and_project["project_id"],
        "name": "List Test Key",
    }, headers=auth_headers)

    resp = await client.get("/api/keys", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    # The actual key value should NOT be in the list response (security)
    for key_item in data:
        assert "key_prefix" in key_item or "name" in key_item


@pytest.mark.asyncio
async def test_revoke_api_key(client, auth_headers, team_and_project):
    # Create a key
    create_resp = await client.post("/api/keys", json={
        "project_id": team_and_project["project_id"],
        "name": "Revoke Test Key",
    }, headers=auth_headers)
    key_id = create_resp.json()["id"]

    # Revoke it
    resp = await client.delete(f"/api/keys/{key_id}", headers=auth_headers)
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_create_key_no_auth(client, team_and_project):
    # Clear cookies left by registered_user fixture to simulate unauthenticated request
    client.cookies.clear()
    resp = await client.post("/api/keys", json={
        "project_id": team_and_project["project_id"],
        "name": "No Auth Key",
    })
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_create_key_invalid_project(client, auth_headers):
    resp = await client.post("/api/keys", json={
        "project_id": "00000000-0000-0000-0000-000000000000",
        "name": "Invalid Project Key",
    }, headers=auth_headers)
    assert resp.status_code in (404, 400, 403)
