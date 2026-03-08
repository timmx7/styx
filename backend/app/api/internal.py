"""Internal endpoints called by the Go router (not exposed publicly).

These endpoints are only accessible within the Docker network
and require X-Internal-Secret authentication.
"""

import logging
import secrets
import uuid as uuid_mod
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Query, status
from sqlalchemy import select, desc, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.database import get_db
from app.models.api_key import ApiKey
from app.models.project import Project
from app.models.routing_log import RoutingLog
from app.models.team import Team
from app.models.user import User
from app.schemas import (
    BudgetCheckResponse,
    LogUsageRequest,
    RoutingLogResponse,
    ValidateKeyRequest,
    ValidateKeyResponse,
)
from app.models.provider_key import ProviderKey
from app.models.subscription import Subscription
from app.models.credit_balance import CreditBalance
from app.services import alert_service, budget_service, credit_service, billing_service
from app.services.key_service import hash_api_key
from app.services.crypto_service import decrypt
from app.services import clickhouse_service
from app.services.pricing_service import get_model_pricing, compute_achilles_cost_cents

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


# ─── Internal authentication dependency ──────────────────────────
async def verify_internal_secret(
    x_internal_secret: str | None = Header(None, alias="X-Internal-Secret"),
) -> None:
    """Verify that the caller has the correct internal secret. Always required."""
    if settings.skip_auth:
        return  # Dev mode: skip internal auth

    if not settings.internal_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="INTERNAL_SECRET not configured on server",
        )
    if not x_internal_secret or not secrets.compare_digest(
        x_internal_secret, settings.internal_secret
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal secret",
        )


@router.post("/validate-key", response_model=ValidateKeyResponse)
async def validate_key(
    body: ValidateKeyRequest,
    _: None = Depends(verify_internal_secret),
    db: AsyncSession = Depends(get_db),
) -> ValidateKeyResponse:
    """Validate an API key sent by the Go router.

    The router sends the plain key in the POST body; we hash it and look it up.
    Returns project_id, team_id, permissions, and rate_limit.
    """
    key_hash = hash_api_key(body.key)

    result = await db.execute(
        select(ApiKey, Project, Team)
        .join(Project, ApiKey.project_id == Project.id)
        .join(Team, Project.team_id == Team.id)
        .where(ApiKey.key_hash == key_hash, ApiKey.is_active.is_(True))
    )
    row = result.first()

    if row is None:
        return ValidateKeyResponse(valid=False)

    api_key, project, team = row._tuple()

    # Update last_used_at (fire-and-forget, non-blocking)
    api_key.last_used_at = datetime.now(timezone.utc)

    # Build permissions list from allowed_providers
    permissions: list[str] = []
    if project.allowed_providers:
        permissions = project.allowed_providers

    # Load and decrypt BYOK provider keys for this project
    provider_keys_result = await db.execute(
        select(ProviderKey).where(
            ProviderKey.project_id == project.id,
            ProviderKey.is_active.is_(True),
        )
    )
    decrypted_keys: dict[str, str] = {}
    for pk in provider_keys_result.scalars().all():
        try:
            decrypted_keys[pk.provider] = decrypt(pk.key_ciphertext)
        except ValueError:
            logger.error(
                "Failed to decrypt provider key %s for project %s (possible key rotation issue)",
                pk.id,
                project.id,
            )

    # ── Load billing info from the team owner ──────────────────
    owner_result = await db.execute(
        select(User).where(User.id == team.owner_id)
    )
    owner = owner_result.scalar_one_or_none()

    billing_mode = owner.billing_mode if owner else None
    owner_user_id = str(owner.id) if owner else None
    requests_used = None
    requests_limit = None
    balance_cents = None

    if owner and billing_mode:
        if billing_mode == "charon":
            sub_result = await db.execute(
                select(Subscription).where(Subscription.user_id == owner.id)
            )
            sub = sub_result.scalar_one_or_none()
            if sub:
                requests_used = sub.requests_used
                requests_limit = sub.requests_limit
        elif billing_mode == "achilles":
            bal_result = await db.execute(
                select(CreditBalance).where(CreditBalance.user_id == owner.id)
            )
            bal = bal_result.scalar_one_or_none()
            balance_cents = bal.balance_cents if bal else 0

    # ── Load active prompt ──────────────────
    from app.models.prompt import PromptTemplate
    prompt_result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.project_id == project.id,
            PromptTemplate.is_active.is_(True)
        )
    )
    active_prompt = prompt_result.scalar_one_or_none()
    system_prompt = active_prompt.system_prompt if active_prompt else None

    # ── Load active A/B test experiment ──────
    from app.models.ab_test import ABTestExperiment
    ab_test_result = await db.execute(
        select(ABTestExperiment).where(
            ABTestExperiment.project_id == project.id,
            ABTestExperiment.is_active.is_(True)
        )
    )
    active_ab_test = ab_test_result.scalar_one_or_none()
    ab_test_config = None
    if active_ab_test:
        ab_test_config = {
            "id": str(active_ab_test.id),
            "name": active_ab_test.name,
            "variants": active_ab_test.variants,
        }

    return ValidateKeyResponse(
        valid=True,
        key_id=str(api_key.id),
        project_id=str(project.id),
        team_id=str(team.id),
        permissions=permissions,
        rate_limit=api_key.rate_limit_per_minute,
        provider_keys=decrypted_keys,
        billing_mode=billing_mode,
        owner_user_id=owner_user_id,
        requests_used=requests_used,
        requests_limit=requests_limit,
        balance_cents=balance_cents,
        system_prompt=system_prompt,
        pii_redaction_enabled=project.pii_redaction_enabled,
        guardrails_config=project.guardrails_config,
        ab_test_config=ab_test_config,
        semantic_cache_enabled=project.semantic_cache_enabled,
        end_user_rate_limit=project.end_user_rate_limit,
    )


@router.get("/budget/{project_id}", response_model=BudgetCheckResponse)
async def check_budget(
    project_id: str,
    _: None = Depends(verify_internal_secret),
    db: AsyncSession = Depends(get_db),
) -> BudgetCheckResponse:
    """Check if a project is within its budget. Called by the Go router before routing."""
    # Explicit UUID conversion — Project.id is a UUID column
    try:
        project_uuid = uuid_mod.UUID(project_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )

    result = await db.execute(
        select(Project).where(Project.id == project_uuid)
    )
    project = result.scalar_one_or_none()
    if project is None:
        # Return generic 401 — do not reveal whether the project exists
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )

    budget_info = await budget_service.check_budget(
        project_id, project.budget_monthly_cents
    )
    return BudgetCheckResponse(**budget_info)


@router.post("/log-usage", status_code=201)
async def log_usage(
    body: LogUsageRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(verify_internal_secret),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Log a routed request and update spend counters.

    Called fire-and-forget by the Go router after each request.
    """
    # Verify project exists before inserting an orphan log
    try:
        proj_check_uuid = uuid_mod.UUID(body.project_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project_id format",
        )

    project_exists = await db.execute(
        select(Project.id).where(Project.id == proj_check_uuid)
    )
    if project_exists.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    log = RoutingLog(
        project_id=body.project_id,
        provider=body.provider,
        model=body.model,
        complexity=body.complexity,
        latency_ms=body.latency_ms,
        status_code=body.status_code,
        cache_hit=body.cache_hit,
        was_fallback=body.was_fallback,
        input_tokens=body.input_tokens,
        output_tokens=body.output_tokens,
    )
    db.add(log)
    await db.flush()

    # Also log to ClickHouse for analytics (non-blocking, best-effort)
    await clickhouse_service.insert_routing_log(
        project_id=body.project_id,
        provider=body.provider,
        model=body.model,
        complexity=body.complexity,
        latency_ms=body.latency_ms,
        status_code=body.status_code,
        cache_hit=body.cache_hit,
        was_fallback=body.was_fallback,
        input_tokens=body.input_tokens,
        output_tokens=body.output_tokens,
        cost_cents=body.cost_cents,
        end_user_id=body.end_user_id,
        experiment_id=body.experiment_id,
        variant_id=body.variant_id,
    )

    # Use real cost from router if provided, otherwise estimate
    cost_cents = body.cost_cents
    if cost_cents <= 0 and not body.cache_hit:
        cost_cents = max(1, body.latency_ms // 100)  # fallback estimation

    if body.cache_hit:
        cost_cents = 0  # cache hits are free

    if cost_cents > 0:
        # Get project + team + owner for spend tracking and Stripe usage
        try:
            proj_uuid = uuid_mod.UUID(body.project_id)
        except (ValueError, AttributeError):
            logger.warning("Invalid project_id format in log_usage: %s", body.project_id)
            return {"ok": True}

        proj_result = await db.execute(
            select(Project, Team, User)
            .join(Team, Project.team_id == Team.id)
            .join(User, Team.owner_id == User.id)
            .where(Project.id == proj_uuid)
        )
        row = proj_result.first()
        if row:
            project, team, user = row._tuple()
            spend = await budget_service.increment_spend(
                body.project_id, str(team.id), cost_cents
            )

            # Check thresholds and create alerts if needed.
            # Wrapped in try/except so alert failures never roll back the routing log.
            if project.budget_monthly_cents and project.budget_monthly_cents > 0:
                try:
                    await alert_service.check_and_create_budget_alerts(
                        db,
                        project_id=body.project_id,
                        team_id=str(team.id),
                        project_name=project.name,
                        budget_cents=project.budget_monthly_cents,
                        spent_cents=spend["project_spend"],
                        threshold_pct=project.budget_alert_threshold_pct,
                    )
                except Exception:
                    logger.exception(
                        "alert_service failed (routing log preserved)"
                    )
            
            # Report token usage to Stripe if metered billing is enabled
            total_tokens = body.input_tokens + body.output_tokens
            if total_tokens > 0 and getattr(user, "stripe_customer_id", None):
                background_tasks.add_task(
                    billing_service.report_metered_usage,
                    customer_id=user.stripe_customer_id,
                    tokens=total_tokens
                )

    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════
# Billing: request counting + credit deduction (called by Go router)
# ═══════════════════════════════════════════════════════════════════


@router.post("/increment-request")
async def increment_request(
    user_id: str = Query(...),
    _: None = Depends(verify_internal_secret),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Increment the Charon user's monthly request counter.

    Called by the Go router AFTER a successful request.
    """
    try:
        user_uuid = uuid_mod.UUID(user_id)
    except (ValueError, AttributeError):
        return {"ok": False, "error": "invalid_user_id"}

    result = await db.execute(
        select(Subscription).where(
            Subscription.user_id == user_uuid,
            Subscription.status == "active",
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        return {"ok": False, "error": "no_subscription"}

    # Atomic increment to avoid race conditions with concurrent requests
    await db.execute(
        sa_update(Subscription)
        .where(Subscription.user_id == user_uuid, Subscription.status == "active")
        .values(requests_used=Subscription.requests_used + 1)
    )
    await db.flush()

    # Re-fetch to get updated value
    result = await db.execute(
        select(Subscription).where(
            Subscription.user_id == user_uuid,
            Subscription.status == "active",
        )
    )
    sub = result.scalar_one()

    # ── Quota alert at 80% ────────────────────────────────────
    try:
        # Look up team for alert association
        team_result = await db.execute(
            select(Team).where(Team.owner_id == user_uuid)
        )
        team = team_result.scalar_one_or_none()
        if team:
            await alert_service.check_quota_alert(
                db,
                user_id=user_id,
                team_id=str(team.id),
                requests_used=sub.requests_used,
                requests_limit=sub.requests_limit,
            )
    except Exception:
        logger.exception("quota alert check failed (increment preserved)")

    await db.commit()

    return {
        "ok": True,
        "requests_used": sub.requests_used,
        "requests_limit": sub.requests_limit,
    }


@router.post("/deduct-credits")
async def deduct_credits(
    user_id: str = Query(...),
    provider: str = Query(...),
    model: str = Query(...),
    input_tokens: int = Query(default=0),
    output_tokens: int = Query(default=0),
    request_id: str | None = Query(default=None),
    _: None = Depends(verify_internal_secret),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Deduct credits from an Achilles user based on actual token usage.

    Called by the Go router AFTER a successful request. Computes the cost
    using the model_pricing table (client-facing prices with 30% markup).
    """
    try:
        user_uuid = uuid_mod.UUID(user_id)
    except (ValueError, AttributeError):
        return {"ok": False, "error": "invalid_user_id"}

    pricing = await get_model_pricing(db, provider, model)
    if pricing is None:
        logger.warning(
            "No pricing for %s/%s — using minimum 1 cent", provider, model
        )
        cost_cents = max(1, (input_tokens + output_tokens) // 10000)
    else:
        cost_cents = compute_achilles_cost_cents(pricing, input_tokens, output_tokens)

    req_uuid = uuid_mod.UUID(request_id) if request_id else None

    tx = await credit_service.deduct_credits(
        db,
        user_uuid,
        cost_cents,
        request_id=req_uuid,
        description=f"{provider}/{model}: {input_tokens}in + {output_tokens}out",
    )

    if tx is None:
        return {"ok": False, "error": "insufficient_credits", "cost_cents": cost_cents}

    # ── Low-credits alert when balance < $2 ───────────────────
    try:
        team_result = await db.execute(
            select(Team).where(Team.owner_id == user_uuid)
        )
        team = team_result.scalar_one_or_none()
        if team and tx.balance_after_cents < 200:
            await alert_service.check_credits_low_alert(
                db,
                user_id=user_id,
                team_id=str(team.id),
                balance_cents=tx.balance_after_cents,
            )
    except Exception:
        logger.exception("credits_low alert check failed (deduction preserved)")

    await db.commit()

    return {
        "ok": True,
        "cost_cents": cost_cents,
        "balance_after": tx.balance_after_cents,
    }


@router.get("/routing-logs", response_model=list[RoutingLogResponse])
async def get_routing_logs(
    limit: int = Query(50, le=200),
    project_id: str | None = None,
    _: None = Depends(verify_internal_secret),
    db: AsyncSession = Depends(get_db),
) -> list[RoutingLog]:
    """Get recent routing logs. Requires internal secret auth.

    If project_id is provided, returns logs for that project only.
    Otherwise returns all recent logs (used by the Go router for monitoring).
    """
    query = (
        select(RoutingLog)
        .order_by(desc(RoutingLog.created_at))
        .limit(limit)
    )

    if project_id:
        # Validate UUID format even though RoutingLog.project_id is String
        try:
            uuid_mod.UUID(project_id)
        except (ValueError, AttributeError):
            return []
        query = query.where(RoutingLog.project_id == project_id)

    result = await db.execute(query)
    return list(result.scalars().all())
