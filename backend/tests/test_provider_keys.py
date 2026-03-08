"""Tests for provider key encryption, storage, and API endpoints.

Covers:
  1. Crypto service: encrypt/decrypt, key rotation, edge cases
  2. Provider key CRUD endpoints: create, list, delete, rotate
  3. Access control: admin vs member permissions
  4. Internal endpoint: validate-key returns decrypted BYOK keys
  5. Security: plaintext never leaked, ciphertext stored correctly
"""

import os
import uuid

import pytest
from httpx import AsyncClient

# ─── Constants ─────────────────────────────────────────────────────
INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "test-internal-secret")
INTERNAL_HEADERS = {"X-Internal-Secret": INTERNAL_SECRET}


# ─── Helpers ───────────────────────────────────────────────────────

async def _headers(user_data: dict) -> dict:
    return user_data.get("headers") or {"Authorization": f"Bearer {user_data['access_token']}"}


async def _setup_project(client: AsyncClient, headers: dict) -> dict:
    """Create team + project, return both IDs."""
    team_resp = await client.post("/api/teams", json={"name": "PK Team"}, headers=headers)
    assert team_resp.status_code in (200, 201)
    team_id = team_resp.json()["id"]

    proj_resp = await client.post("/api/projects", json={
        "name": "PK Project", "team_id": team_id,
    }, headers=headers)
    assert proj_resp.status_code in (200, 201)
    project_id = proj_resp.json()["id"]

    return {"team_id": team_id, "project_id": project_id}


# ═══════════════════════════════════════════════════════════════════
# 1. CRYPTO SERVICE UNIT TESTS
# ═══════════════════════════════════════════════════════════════════

class TestCryptoService:
    """Test the low-level encryption/decryption service."""

    def test_encrypt_decrypt_roundtrip(self):
        from app.services.crypto_service import encrypt, decrypt

        plaintext = "sk-abc123def456ghi789"
        ciphertext = encrypt(plaintext)
        result = decrypt(ciphertext)

        assert result == plaintext
        assert ciphertext != plaintext
        assert ciphertext.startswith("v1:")

    def test_encrypt_produces_different_ciphertexts(self):
        """Same plaintext should produce different ciphertexts (Fernet uses random IV)."""
        from app.services.crypto_service import encrypt

        ct1 = encrypt("sk-same-key")
        ct2 = encrypt("sk-same-key")

        assert ct1 != ct2  # Random IV ensures different output

    def test_decrypt_wrong_data_raises(self):
        from app.services.crypto_service import decrypt

        with pytest.raises(ValueError, match="Failed to decrypt"):
            decrypt("v1:totally-invalid-ciphertext")

    def test_encrypt_empty_string_raises(self):
        from app.services.crypto_service import encrypt

        with pytest.raises(ValueError, match="Cannot encrypt empty"):
            encrypt("")

    def test_decrypt_empty_string_raises(self):
        from app.services.crypto_service import decrypt

        with pytest.raises(ValueError, match="Cannot decrypt empty"):
            decrypt("")

    def test_version_prefix(self):
        from app.services.crypto_service import encrypt

        ct = encrypt("sk-test")
        assert ct.startswith("v1:")
        # The Fernet token part should be URL-safe base64
        token_part = ct[3:]
        assert len(token_part) > 50

    def test_is_encrypted(self):
        from app.services.crypto_service import is_encrypted, encrypt

        assert not is_encrypted("")
        assert not is_encrypted("sk-plain-key")
        assert not is_encrypted("v1:short")

        ct = encrypt("sk-test-key-12345")
        assert is_encrypted(ct)

    def test_generate_encryption_key(self):
        from app.services.crypto_service import generate_encryption_key
        from cryptography.fernet import Fernet

        key = generate_encryption_key()
        # Should be a valid Fernet key
        f = Fernet(key.encode())
        token = f.encrypt(b"test")
        assert f.decrypt(token) == b"test"

    def test_encrypt_long_key(self):
        """Provider keys can be quite long (especially Azure)."""
        from app.services.crypto_service import encrypt, decrypt

        long_key = "sk-" + "a" * 200
        ct = encrypt(long_key)
        assert decrypt(ct) == long_key

    def test_encrypt_special_characters(self):
        """Keys may contain special characters."""
        from app.services.crypto_service import encrypt, decrypt

        special_key = "sk-ant-api03-Héllo+World/Base64=="
        ct = encrypt(special_key)
        assert decrypt(ct) == special_key


# ═══════════════════════════════════════════════════════════════════
# 2. PROVIDER KEY API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

class TestProviderKeyCreate:
    """Test POST /api/provider-keys/{project_id} — store a provider key."""

    @pytest.mark.asyncio
    async def test_create_provider_key(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        resp = await client.post(
            f"/api/provider-keys/{setup['project_id']}",
            json={"provider": "openai", "api_key": "sk-test-openai-key-12345"},
            headers=headers,
        )
        assert resp.status_code == 201
        data = resp.json()

        assert data["provider"] == "openai"
        assert data["key_hint"] == "...2345"
        assert data["is_active"] is True
        assert data["rotated_at"] is None
        # CRITICAL: plaintext key must NEVER appear in response
        assert "sk-test-openai-key" not in str(data)

    @pytest.mark.asyncio
    async def test_create_multiple_providers(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)
        pid = setup["project_id"]

        for provider, key in [
            ("openai", "sk-openai-abc123"),
            ("anthropic", "sk-ant-xyz789"),
            ("google", "AIza-google-key-000"),
        ]:
            resp = await client.post(
                f"/api/provider-keys/{pid}",
                json={"provider": provider, "api_key": key},
                headers=headers,
            )
            assert resp.status_code == 201

        # List should show 3 keys
        list_resp = await client.get(f"/api/provider-keys/{pid}", headers=headers)
        assert list_resp.status_code == 200
        data = list_resp.json()
        assert len(data["keys"]) == 3
        assert set(data["providers_configured"]) == {"openai", "anthropic", "google"}

    @pytest.mark.asyncio
    async def test_create_replaces_existing_key(self, client: AsyncClient, create_test_user):
        """Posting for the same provider should rotate (update), not duplicate."""
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)
        pid = setup["project_id"]

        # First key
        resp1 = await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-old-key-1111"},
            headers=headers,
        )
        assert resp1.status_code == 201
        assert resp1.json()["key_hint"] == "...1111"

        # Second key for same provider → should rotate
        resp2 = await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-new-key-2222"},
            headers=headers,
        )
        assert resp2.status_code == 201
        data = resp2.json()
        assert data["key_hint"] == "...2222"
        assert data["rotated_at"] is not None

        # List should still show only 1 key
        list_resp = await client.get(f"/api/provider-keys/{pid}", headers=headers)
        assert len(list_resp.json()["keys"]) == 1

    @pytest.mark.asyncio
    async def test_invalid_provider_rejected(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        resp = await client.post(
            f"/api/provider-keys/{setup['project_id']}",
            json={"provider": "invalid_provider", "api_key": "sk-test"},
            headers=headers,
        )
        assert resp.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async def test_short_key_rejected(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        resp = await client.post(
            f"/api/provider-keys/{setup['project_id']}",
            json={"provider": "openai", "api_key": "sk"},
            headers=headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_nonexistent_project_returns_404(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)

        fake_id = str(uuid.uuid4())
        resp = await client.post(
            f"/api/provider-keys/{fake_id}",
            json={"provider": "openai", "api_key": "sk-test-12345"},
            headers=headers,
        )
        assert resp.status_code == 404


class TestProviderKeyList:
    """Test GET /api/provider-keys/{project_id} — list provider keys."""

    @pytest.mark.asyncio
    async def test_list_empty_project(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        resp = await client.get(
            f"/api/provider-keys/{setup['project_id']}",
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["keys"] == []
        assert data["providers_configured"] == []
        assert "openai" in data["providers_available"]

    @pytest.mark.asyncio
    async def test_list_never_returns_plaintext(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)
        pid = setup["project_id"]

        await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-supersecret-key-99999"},
            headers=headers,
        )

        resp = await client.get(f"/api/provider-keys/{pid}", headers=headers)
        response_text = resp.text

        # The full key must NEVER appear anywhere in the response
        assert "sk-supersecret-key" not in response_text
        assert "9999" in response_text  # Only the hint (last 4 chars: "...9999")


class TestProviderKeyDelete:
    """Test DELETE /api/provider-keys/{project_id}/{provider}."""

    @pytest.mark.asyncio
    async def test_delete_provider_key(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)
        pid = setup["project_id"]

        # Create
        await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-to-delete-1234"},
            headers=headers,
        )

        # Delete
        resp = await client.delete(
            f"/api/provider-keys/{pid}/openai",
            headers=headers,
        )
        assert resp.status_code == 204

        # Verify gone
        list_resp = await client.get(f"/api/provider-keys/{pid}", headers=headers)
        assert list_resp.json()["providers_configured"] == []

    @pytest.mark.asyncio
    async def test_delete_nonexistent_returns_404(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        resp = await client.delete(
            f"/api/provider-keys/{setup['project_id']}/openai",
            headers=headers,
        )
        assert resp.status_code == 404


class TestProviderKeyRotate:
    """Test PUT /api/provider-keys/{project_id}/{provider}/rotate."""

    @pytest.mark.asyncio
    async def test_rotate_key(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)
        pid = setup["project_id"]

        # Create initial key
        await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "anthropic", "api_key": "sk-ant-old-key-aaaa"},
            headers=headers,
        )

        # Rotate
        resp = await client.put(
            f"/api/provider-keys/{pid}/anthropic/rotate",
            json={"new_api_key": "sk-ant-new-key-bbbb"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["key_hint"] == "...bbbb"
        assert data["rotated_at"] is not None

    @pytest.mark.asyncio
    async def test_rotate_nonexistent_returns_404(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        resp = await client.put(
            f"/api/provider-keys/{setup['project_id']}/openai/rotate",
            json={"new_api_key": "sk-new-12345"},
            headers=headers,
        )
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════
# 3. ACCESS CONTROL
# ═══════════════════════════════════════════════════════════════════

class TestProviderKeyAccessControl:
    """Verify role-based access control for provider key operations."""

    @pytest.mark.asyncio
    async def test_member_cannot_create_key(self, client: AsyncClient, create_test_user):
        """Members (non-admin) cannot store provider keys."""
        from unittest.mock import AsyncMock, patch

        owner = await create_test_user()
        owner_headers = await _headers(owner)
        setup = await _setup_project(client, owner_headers)
        pid = setup["project_id"]
        tid = setup["team_id"]

        # Register a second user
        member = await create_test_user()
        member_headers = await _headers(member)

        # Invite as member
        with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock) as mock_email:
            mock_email.return_value = True
            invite_resp = await client.post(
                f"/api/teams/{tid}/invite",
                json={"email": member["email"], "role": "member"},
                headers=owner_headers,
            )
            assert invite_resp.status_code == 201
            token = mock_email.call_args.kwargs.get("token")
            if token is None and mock_email.call_args.args:
                token = mock_email.call_args.args[1]

        # Accept invitation
        await client.post(
            "/api/teams/accept-invite",
            json={"token": token},
            headers=member_headers,
        )

        # Member tries to create a provider key → 403
        resp = await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-member-attempt"},
            headers=member_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_member_can_list_keys(self, client: AsyncClient, create_test_user):
        """Members CAN list provider keys (read access)."""
        from unittest.mock import AsyncMock, patch

        owner = await create_test_user()
        owner_headers = await _headers(owner)
        setup = await _setup_project(client, owner_headers)
        pid = setup["project_id"]
        tid = setup["team_id"]

        # Owner creates a key
        await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-owner-key-1234"},
            headers=owner_headers,
        )

        # Register a second user
        member = await create_test_user()
        member_headers = await _headers(member)

        # Invite and accept
        with patch("app.api.teams.send_team_invitation_email", new_callable=AsyncMock) as mock_email:
            mock_email.return_value = True
            await client.post(
                f"/api/teams/{tid}/invite",
                json={"email": member["email"], "role": "member"},
                headers=owner_headers,
            )
            token = mock_email.call_args.kwargs.get("token")
            if token is None and mock_email.call_args.args:
                token = mock_email.call_args.args[1]

        await client.post(
            "/api/teams/accept-invite",
            json={"token": token},
            headers=member_headers,
        )

        # Member can list keys
        resp = await client.get(
            f"/api/provider-keys/{pid}",
            headers=member_headers,
        )
        assert resp.status_code == 200
        assert len(resp.json()["keys"]) == 1


# ═══════════════════════════════════════════════════════════════════
# 4. INTERNAL ENDPOINT — BYOK INTEGRATION
# ═══════════════════════════════════════════════════════════════════

class TestValidateKeyWithProviderKeys:
    """Test that validate-key returns decrypted BYOK provider keys."""

    @pytest.mark.asyncio
    async def test_validate_key_returns_provider_keys(self, client: AsyncClient, create_test_user):
        """When a project has BYOK keys, validate-key should return them decrypted."""
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)
        pid = setup["project_id"]

        # Store provider keys
        await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-openai-byok-12345"},
            headers=headers,
        )
        await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "anthropic", "api_key": "sk-ant-byok-67890"},
            headers=headers,
        )

        # Create an API key for the project
        key_resp = await client.post(
            "/api/keys",
            json={"project_id": pid},
            headers=headers,
        )
        assert key_resp.status_code == 201
        plain_key = key_resp.json()["key"]

        # Validate the key (as the Go router would)
        validate_resp = await client.post(
            "/internal/validate-key",
            json={"key": plain_key},
            headers=INTERNAL_HEADERS,
        )
        assert validate_resp.status_code == 200
        data = validate_resp.json()

        assert data["valid"] is True
        assert data["project_id"] == pid
        assert "provider_keys" in data
        assert data["provider_keys"]["openai"] == "sk-openai-byok-12345"
        assert data["provider_keys"]["anthropic"] == "sk-ant-byok-67890"

    @pytest.mark.asyncio
    async def test_validate_key_empty_when_no_byok(self, client: AsyncClient, create_test_user):
        """If no BYOK keys are configured, provider_keys should be empty."""
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        key_resp = await client.post(
            "/api/keys",
            json={"project_id": setup["project_id"]},
            headers=headers,
        )
        plain_key = key_resp.json()["key"]

        validate_resp = await client.post(
            "/internal/validate-key",
            json={"key": plain_key},
            headers=INTERNAL_HEADERS,
        )
        assert validate_resp.status_code == 200
        data = validate_resp.json()

        assert data["valid"] is True
        assert data["provider_keys"] == {}

    @pytest.mark.asyncio
    async def test_validate_key_excludes_inactive_keys(self, client: AsyncClient, create_test_user):
        """Deleted/deactivated provider keys should not be returned."""
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)
        pid = setup["project_id"]

        # Create key then delete it
        await client.post(
            f"/api/provider-keys/{pid}",
            json={"provider": "openai", "api_key": "sk-to-be-deleted"},
            headers=headers,
        )
        await client.delete(f"/api/provider-keys/{pid}/openai", headers=headers)

        # Create API key and validate
        key_resp = await client.post(
            "/api/keys", json={"project_id": pid}, headers=headers,
        )
        plain_key = key_resp.json()["key"]

        validate_resp = await client.post(
            "/internal/validate-key",
            json={"key": plain_key},
            headers=INTERNAL_HEADERS,
        )
        assert validate_resp.json()["provider_keys"] == {}


# ═══════════════════════════════════════════════════════════════════
# 5. SECURITY — PLAINTEXT NEVER LEAKED
# ═══════════════════════════════════════════════════════════════════

class TestProviderKeySecurity:
    """Verify that plaintext provider keys are never stored or leaked."""

    @pytest.mark.asyncio
    async def test_ciphertext_stored_in_db(self, client: AsyncClient, db_session, create_test_user):
        """Verify the database contains encrypted ciphertext, not plaintext."""
        from sqlalchemy import select
        from app.models.provider_key import ProviderKey

        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        plaintext_key = "sk-absolutely-secret-key-xyz"
        await client.post(
            f"/api/provider-keys/{setup['project_id']}",
            json={"provider": "openai", "api_key": plaintext_key},
            headers=headers,
        )

        # Query the database directly
        result = await db_session.execute(
            select(ProviderKey).where(ProviderKey.project_id == setup["project_id"])
        )
        pk = result.scalar_one()

        # The stored value must be encrypted
        assert pk.key_ciphertext.startswith("v1:")
        assert plaintext_key not in pk.key_ciphertext
        assert len(pk.key_ciphertext) > len(plaintext_key) * 2

        # But we can still decrypt it
        from app.services.crypto_service import decrypt
        assert decrypt(pk.key_ciphertext) == plaintext_key

    @pytest.mark.asyncio
    async def test_key_hint_is_only_last_4_chars(self, client: AsyncClient, create_test_user):
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        await client.post(
            f"/api/provider-keys/{setup['project_id']}",
            json={"provider": "openai", "api_key": "sk-long-secret-key-WXYZ"},
            headers=headers,
        )

        resp = await client.get(
            f"/api/provider-keys/{setup['project_id']}",
            headers=headers,
        )
        key_data = resp.json()["keys"][0]
        assert key_data["key_hint"] == "...WXYZ"
        assert "sk-long" not in key_data["key_hint"]

    @pytest.mark.asyncio
    async def test_create_response_excludes_ciphertext(self, client: AsyncClient, create_test_user):
        """The create response must not include ciphertext or plaintext."""
        user = await create_test_user()
        headers = await _headers(user)
        setup = await _setup_project(client, headers)

        resp = await client.post(
            f"/api/provider-keys/{setup['project_id']}",
            json={"provider": "openai", "api_key": "sk-secret-value-1234"},
            headers=headers,
        )
        response_text = resp.text

        assert "sk-secret-value" not in response_text
        assert "key_ciphertext" not in response_text
        assert "v1:" not in response_text
