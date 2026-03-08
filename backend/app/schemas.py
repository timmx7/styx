"""Pydantic schemas for all request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, HttpUrl, field_validator


# ─── Shared validators ──────────────────────────────────────────────────

def _validate_password(v: str) -> str:
    """Enforce password complexity: uppercase, lowercase, digit, special char."""
    if not any(c.isupper() for c in v):
        raise ValueError("Password must contain at least one uppercase letter")
    if not any(c.islower() for c in v):
        raise ValueError("Password must contain at least one lowercase letter")
    if not any(c.isdigit() for c in v):
        raise ValueError("Password must contain at least one digit")
    if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?/~`" for c in v):
        raise ValueError("Password must contain at least one special character")
    return v


# ─── Auth ───────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = None

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        return _validate_password(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    message: str = "Authenticated"


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str | None
    role: str
    email_verified: bool = False
    billing_mode: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Password Reset ───────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    """Request a password reset email."""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Reset password using a token received via email."""
    token: str = Field(min_length=1, max_length=255)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        return _validate_password(v)


# ─── Email Verification ───────────────────────────────────────────────

class VerifyEmailRequest(BaseModel):
    """Verify email using a token received via email."""
    token: str = Field(min_length=1, max_length=255)


class ResendVerificationRequest(BaseModel):
    """Request a new email verification email."""
    email: EmailStr


class MessageResponse(BaseModel):
    """Generic message response for operations that don't return data."""
    message: str


# ─── Teams ──────────────────────────────────────────────────────────────

class CreateTeamRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class TeamResponse(BaseModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    plan: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Team Members ────────────────────────────────────────────────────────

class TeamMemberResponse(BaseModel):
    """A member of a team, returned by list-members and invite-accept."""
    id: uuid.UUID
    team_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    user_email: str | None = None
    user_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UpdateMemberRoleRequest(BaseModel):
    """Change a team member's role."""
    role: str = Field(..., pattern="^(admin|member)$")


# ─── Team Invitations ────────────────────────────────────────────────────

class InviteToTeamRequest(BaseModel):
    """Invite a user to a team by email."""
    email: EmailStr
    role: str = Field(default="member", pattern="^(admin|member)$")


class TeamInvitationResponse(BaseModel):
    """An invitation to join a team."""
    id: uuid.UUID
    team_id: uuid.UUID
    invited_email: str
    role: str
    status: str
    invited_by_id: uuid.UUID | None
    expires_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class AcceptInvitationRequest(BaseModel):
    """Accept a team invitation using the token from the email."""
    token: str = Field(min_length=1, max_length=255)


# ─── Projects ───────────────────────────────────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    team_id: uuid.UUID
    budget_monthly_cents: int | None = None
    allowed_providers: list[str] | None = None
    routing_strategy: str = "cost_optimized"
    semantic_cache_enabled: bool = True


class UpdateProjectRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    budget_monthly_cents: int | None = None
    budget_alert_threshold_pct: int | None = Field(None, ge=1, le=100)
    allowed_providers: list[str] | None = None
    routing_strategy: str | None = None
    pii_redaction_enabled: bool | None = None
    guardrails_config: dict | None = None
    semantic_cache_enabled: bool | None = None
    end_user_rate_limit: int | None = Field(None, ge=0)


class AddProjectMemberRequest(BaseModel):
    user_id: uuid.UUID
    role: str = "developer"


class UpdateProjectMemberRoleRequest(BaseModel):
    role: str


class ProjectMemberResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    user_email: str | None = None
    user_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectResponse(BaseModel):
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    budget_monthly_cents: int | None
    budget_alert_threshold_pct: int
    allowed_providers: list[str] | None
    routing_strategy: str
    pii_redaction_enabled: bool
    guardrails_config: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── API Keys ───────────────────────────────────────────────────────────

class CreateApiKeyRequest(BaseModel):
    project_id: uuid.UUID
    name: str | None = None
    rate_limit_per_minute: int = 60


class ApiKeyResponse(BaseModel):
    """Returned after creation — includes the plain key (shown once)."""
    id: uuid.UUID
    project_id: uuid.UUID
    key: str  # plain key, shown only at creation
    key_prefix: str
    name: str | None
    rate_limit_per_minute: int
    is_active: bool
    created_at: datetime


class ApiKeyListItem(BaseModel):
    """Returned in list endpoints — never includes the plain key."""
    id: uuid.UUID
    project_id: uuid.UUID
    key_prefix: str
    name: str | None
    rate_limit_per_minute: int
    is_active: bool
    last_used_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Internal (Go router → Backend) ────────────────────────────────────

class ValidateKeyRequest(BaseModel):
    key: str = Field(..., description="The plain API key to validate")


class ValidateKeyResponse(BaseModel):
    valid: bool
    key_id: str = ""
    project_id: str | None = None
    team_id: str | None = None
    permissions: list[str] = []
    rate_limit: int = 60
    provider_keys: dict[str, str] = {}  # BYOK: {"openai": "sk-...", "anthropic": "sk-ant-..."}
    # Billing fields (populated for Charon/Achilles users)
    billing_mode: str | None = None  # "charon" | "achilles" | None (legacy)
    owner_user_id: str | None = None
    requests_used: int | None = None   # Charon: monthly request count
    requests_limit: int | None = None  # Charon: monthly request quota
    balance_cents: int | None = None   # Achilles: credit balance in cents
    system_prompt: str | None = None
    pii_redaction_enabled: bool = False
    guardrails_config: dict | None = None
    ab_test_config: dict | None = None  # Active AB testing configuration
    semantic_cache_enabled: bool = False
    end_user_rate_limit: int = 0


# ─── Routing Logs (Go router → Backend) ─────────────────────────

class LogUsageRequest(BaseModel):
    """Request from Go router to log a completed API request.

    All string fields are strictly validated to prevent injection attacks.
    """

    project_id: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Project ID (UUID format)",
    )

    @field_validator("project_id")
    @classmethod
    def validate_project_id_is_uuid(cls, v: str) -> str:
        """Ensure project_id is a valid UUID string."""
        try:
            uuid.UUID(v)
        except ValueError:
            raise ValueError("project_id must be a valid UUID")
        return v
    provider: str = Field(
        ...,
        min_length=1,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_\-]+$",
        description="Provider name (e.g. openai, anthropic)",
    )
    model: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[a-zA-Z0-9_\-\.:/]+$",
        description="Model identifier (e.g. gpt-4o, claude-3.5-sonnet)",
    )
    complexity: str = Field(
        default="unknown",
        pattern=r"^(simple|medium|complex|unknown|cached|)$",
        description="Complexity tier from classifier",
    )
    latency_ms: int = Field(..., ge=0, le=600_000)
    status_code: int = Field(..., ge=100, le=599)
    cache_hit: bool = False
    was_fallback: bool = False
    input_tokens: int = Field(default=0, ge=0, le=10_000_000)
    output_tokens: int = Field(default=0, ge=0, le=10_000_000)
    cost_cents: int = Field(default=0, ge=0, le=100_000_00)
    end_user_id: str | None = None
    experiment_id: str | None = None
    variant_id: str | None = None

class RoutingLogResponse(BaseModel):
    id: uuid.UUID
    project_id: str
    provider: str
    model: str
    complexity: str
    latency_ms: int
    status_code: int
    cache_hit: bool
    was_fallback: bool
    input_tokens: int = 0
    output_tokens: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Budget ──────────────────────────────────────────────────────────

class BudgetCheckResponse(BaseModel):
    allowed: bool
    budget_cents: int | None = None
    spent_cents: int
    remaining_cents: int | None = None
    pct_used: float


class BudgetStatusResponse(BaseModel):
    project_id: str
    project_name: str
    budget_cents: int | None
    spent_cents: int
    remaining_cents: int | None
    pct_used: float
    alert_threshold_pct: int


class UpdateBudgetRequest(BaseModel):
    budget_monthly_cents: int | None = None
    budget_alert_threshold_pct: int = Field(default=80, ge=1, le=100)


# ─── Alerts ──────────────────────────────────────────────────────────

class AlertResponse(BaseModel):
    id: uuid.UUID
    project_id: str
    team_id: str
    alert_type: str
    severity: str
    title: str
    message: str
    is_read: bool
    budget_cents: int | None
    spent_cents: int | None
    threshold_pct: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Billing ─────────────────────────────────────────────────────────

class PlanInfo(BaseModel):
    name: str
    price_monthly_cents: int
    features: list[str]
    billing_mode: str | None = None
    requests_limit: int | None = None          # Charon quota
    monthly_credits_cents: int | None = None   # Achilles credits


class BillingOverview(BaseModel):
    team_id: str
    team_name: str
    plan: str
    plan_info: PlanInfo
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    subscription_status: str | None
    current_period_end: int | None
    total_spend_cents: int
    invoices: list[dict]


class ChangePlanRequest(BaseModel):
    plan: str = Field(
        ...,
        pattern="^(shade|obol|ferryman|titan|spark|blaze|inferno)$",
        description="Charon: shade/obol/ferryman/titan. Achilles: spark/blaze/inferno.",
    )


# ─── Provider Keys (encrypted at-rest) ────────────────────────────────

VALID_PROVIDERS = {"openai", "anthropic", "google", "mistral", "azure"}


class SetProviderKeyRequest(BaseModel):
    """Store or rotate a provider API key (encrypted at rest)."""
    provider: str = Field(
        ...,
        pattern="^(openai|anthropic|google|mistral|azure)$",
        description="AI provider name",
    )
    api_key: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="The provider API key (e.g., sk-abc123...)",
    )


class ProviderKeyResponse(BaseModel):
    """Provider key info — NEVER includes the plaintext key."""
    id: uuid.UUID
    project_id: uuid.UUID
    provider: str
    key_hint: str  # e.g., "...abc1"
    is_active: bool
    last_used_at: datetime | None
    created_at: datetime
    rotated_at: datetime | None

    model_config = {"from_attributes": True}


class ProviderKeyListResponse(BaseModel):
    """List of provider keys with their status."""
    keys: list[ProviderKeyResponse]
    providers_configured: list[str]  # e.g., ["openai", "anthropic"]
    providers_available: list[str]  # All valid providers


class DecryptedProviderKeysResponse(BaseModel):
    """Internal-only: decrypted provider keys for the Go router.

    This is NEVER exposed to the public API — only to internal endpoints
    behind X-Internal-Secret authentication.
    """
    project_id: str
    provider_keys: dict[str, str]  # {"openai": "sk-abc...", "anthropic": "sk-ant-..."}


class RotateProviderKeyRequest(BaseModel):
    """Rotate a provider key — replaces the encrypted value."""
    new_api_key: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="The new provider API key",
    )


# ─── Webhooks ──────────────────────────────────────────────────────────

VALID_WEBHOOK_EVENTS = {
    "budget.threshold",
    "budget.exceeded",
    "provider.down",
    "provider.up",
    "api_key.created",
    "api_key.revoked",
}


class CreateWebhookEndpointRequest(BaseModel):
    """Create a new webhook endpoint for a team."""
    team_id: uuid.UUID
    url: str = Field(
        ...,
        min_length=10,
        max_length=2048,
        pattern=r"^https://",
        description="The HTTPS URL to receive webhook events (HTTPS required)",
    )
    events: list[str] = Field(
        ...,
        min_length=1,
        description="List of event types to subscribe to",
    )
    description: str | None = Field(
        default=None, max_length=255, description="Optional human-readable description"
    )

    @field_validator("events")
    @classmethod
    def validate_events(cls, v: list[str]) -> list[str]:
        invalid = set(v) - VALID_WEBHOOK_EVENTS
        if invalid:
            raise ValueError(
                f"Invalid event types: {', '.join(sorted(invalid))}. "
                f"Valid types: {', '.join(sorted(VALID_WEBHOOK_EVENTS))}"
            )
        return list(set(v))  # deduplicate


class UpdateWebhookEndpointRequest(BaseModel):
    """Update an existing webhook's settings."""
    url: str | None = Field(
        default=None,
        min_length=10,
        max_length=2048,
        pattern=r"^https://",
    )
    events: list[str] | None = None
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None

    @field_validator("events")
    @classmethod
    def validate_events(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return list(set(v))


class WebhookEndpointResponse(BaseModel):
    id: uuid.UUID
    team_id: uuid.UUID
    url: HttpUrl
    events: list[str]
    is_active: bool
    description: str | None
    last_triggered_at: datetime | None
    consecutive_failures: int
    created_at: datetime

    model_config = {"from_attributes": True}


class WebhookEndpointCreatedResponse(WebhookEndpointResponse):
    secret: str  # Only returned once on creation


class WebhookDeliveryResponse(BaseModel):
    id: uuid.UUID
    endpoint_id: uuid.UUID
    event_type: str
    payload: dict
    response_status: int | None
    response_body: str | None
    success: bool
    created_at: datetime

    model_config = {"from_attributes": True}

# ─── Prompt Playground ──────────────────────────────────────────

class PromptBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    system_prompt: str = Field(..., min_length=1)
    is_active: bool = False

class PromptCreate(PromptBase):
    pass

class PromptUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    system_prompt: str | None = Field(None, min_length=1)
    is_active: bool | None = None

class PromptResponse(PromptBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

# ─── SSO (Single Sign-On) ──────────────────────────────────────────

class IdentityProviderBase(BaseModel):
    provider_type: str = Field("saml", pattern="^(saml|oidc)$")
    domain: str = Field(..., max_length=255)
    config: dict = Field(default_factory=dict)
    is_active: bool = True

class IdentityProviderCreate(IdentityProviderBase):
    pass

class IdentityProviderUpdate(BaseModel):
    provider_type: str | None = Field(None, pattern="^(saml|oidc)$")
    domain: str | None = Field(None, max_length=255)
    config: dict | None = None
    is_active: bool | None = None

class IdentityProviderResponse(IdentityProviderBase):
    id: uuid.UUID
    team_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class SSOCallbackRequest(BaseModel):
    """Schema for SAML callback (usually Form Data, but defined here if needed)."""
    SAMLResponse: str
    RelayState: str | None = None


# ─── A/B Testing Evals ──────────────────────────────────────────

class ABTestVariant(BaseModel):
    id: str  # e.g. "a", "b", "control", "test"
    provider: str
    model: str
    system_prompt: str | None = None
    weight: int = Field(..., ge=1, le=100)  # e.g. 50, 50

class ABTestExperimentBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    is_active: bool = False
    variants: list[ABTestVariant] = Field(default_factory=list)

class ABTestExperimentCreate(ABTestExperimentBase):
    pass

class ABTestExperimentUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    is_active: bool | None = None
    variants: list[ABTestVariant] | None = None

class ABTestExperimentResponse(ABTestExperimentBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
