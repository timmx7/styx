"""Billing API endpoints — plans, subscriptions, invoices, Stripe webhooks."""

import logging
import uuid as uuid_mod
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.database import get_db
from app.deps import get_current_user
from app.models.team import Team
from app.models.team_member import TeamMember
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas import BillingOverview, ChangePlanRequest, PlanInfo
from app.schemas_billing import (
    ACHILLES_PLANS,
    CreateCheckoutRequest,
    SubscriptionResponse,
    get_plan,
)
from app.services import billing_service, budget_service, credit_service

# Redis client for webhook idempotency deduplication
_redis_client = None


async def _get_webhook_redis():
    """Lazy-init Redis client for webhook dedup."""
    global _redis_client
    if _redis_client is None:
        try:
            import redis.asyncio as aioredis
            _redis_client = aioredis.from_url(
                settings.redis_url, decode_responses=True
            )
        except Exception:
            pass
    return _redis_client

logger = logging.getLogger("billing")

router = APIRouter(prefix="/billing", tags=["billing"])


async def _get_user_team(
    db: AsyncSession, user_id, *, team_id: str | None = None
) -> Team | None:
    """Get a team the user is an owner of (billing is owner-only).

    If team_id is provided, returns that specific team (verifying ownership).
    If team_id is omitted, returns the user's team only if they own exactly one.
    Raises HTTPException(409) if the user owns multiple teams and no team_id is given.
    """
    query = (
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(
            TeamMember.user_id == user_id,
            TeamMember.role == "owner",
        )
    )

    if team_id is not None:
        query = query.where(Team.id == team_id)
        result = await db.execute(query.limit(1))
        return result.scalar_one_or_none()

    # No team_id specified — fetch all owned teams
    result = await db.execute(query)
    teams = list(result.scalars().all())

    if len(teams) == 0:
        return None
    if len(teams) == 1:
        return teams[0]

    # User owns multiple teams — require explicit team_id
    raise HTTPException(
        status_code=409,
        detail=(
            "You own multiple teams. Please specify team_id as a query parameter "
            "to select which team to use for billing."
        ),
    )


@router.get("/plans", response_model=list[PlanInfo])
async def list_plans() -> list[PlanInfo]:
    """List all available plans."""
    return [
        PlanInfo(**plan_data)
        for plan_data in billing_service.PLANS.values()
    ]


@router.get("/overview", response_model=BillingOverview)
async def billing_overview(
    team_id: str | None = Query(None, description="Team ID (required if you own multiple teams)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillingOverview:
    """Get billing overview for the user's team."""
    team = await _get_user_team(db, current_user.id, team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="No team found")

    plan_info = billing_service.get_plan_info(team.plan)

    # Get total spend from Redis
    total_spend = await budget_service.get_team_spend(str(team.id))

    # Get invoices
    invoices = []
    if current_user.stripe_customer_id:
        invoices = await billing_service.get_invoices(current_user.stripe_customer_id)

    # Get subscription status
    sub_status = None
    period_end = None
    if team.stripe_subscription_id:
        sub = await billing_service.get_subscription(team.stripe_subscription_id)
        if sub:
            sub_status = sub.get("status")
            period_end = sub.get("current_period_end")

    return BillingOverview(
        team_id=str(team.id),
        team_name=team.name,
        plan=team.plan,
        plan_info=PlanInfo(**plan_info),
        stripe_customer_id=current_user.stripe_customer_id,
        stripe_subscription_id=team.stripe_subscription_id,
        subscription_status=sub_status or ("active" if team.plan != "shade" else "free"),
        current_period_end=period_end,
        total_spend_cents=total_spend,
        invoices=invoices,
    )


@router.post("/change-plan")
async def change_plan(
    body: ChangePlanRequest,
    team_id: str | None = Query(None, description="Team ID (required if you own multiple teams)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Change the team's plan (creates/updates Stripe subscription)."""
    team = await _get_user_team(db, current_user.id, team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="No team found")

    if team.plan == body.plan:
        return {"status": "no_change", "plan": body.plan}

    # Ensure customer exists
    if not current_user.stripe_customer_id:
        customer = await billing_service.create_or_get_customer(
            email=current_user.email,
            name=current_user.name,
            user_id=str(current_user.id),
        )
        current_user.stripe_customer_id = customer["id"]

    old_sub_id = team.stripe_subscription_id
    new_sub_id = None

    # Create new subscription FIRST (unless downgrading to free tier).
    # This prevents a race where cancelling the old sub succeeds but
    # creating the new one fails, leaving the team with no subscription.
    if body.plan == "shade":
        team.stripe_subscription_id = None
    else:
        sub = await billing_service.create_subscription(
            current_user.stripe_customer_id, body.plan
        )
        new_sub_id = sub.get("id")
        team.stripe_subscription_id = new_sub_id

    # Cancel old subscription AFTER new one is confirmed
    if old_sub_id:
        await billing_service.cancel_subscription(old_sub_id)

    team.plan = body.plan
    try:
        await db.flush()
        await db.commit()
    except Exception:
        # DB failed — cancel the orphan Stripe subscription we just created
        if new_sub_id:
            try:
                await billing_service.cancel_subscription(new_sub_id)
                logger.warning("cancelled orphan stripe subscription %s after DB failure", new_sub_id)
            except Exception:
                logger.error("failed to cancel orphan stripe subscription %s", new_sub_id)
        raise

    return {
        "status": "changed",
        "plan": body.plan,
        "subscription_id": team.stripe_subscription_id,
    }


# ═══════════════════════════════════════════════════════════════════
# New Charon/Achilles billing endpoints
# ═══════════════════════════════════════════════════════════════════


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionResponse:
    """Get the current user's subscription."""
    result = await db.execute(
        select(Subscription).where(Subscription.user_id == current_user.id)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="No subscription found")
    return SubscriptionResponse.model_validate(sub)


@router.post("/create-checkout")
async def create_checkout(
    body: CreateCheckoutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a Stripe Checkout Session for a subscription plan.

    In mock mode (no Stripe key): creates subscription directly and
    returns a redirect to the billing page.
    """
    plan_def = get_plan(body.billing_mode, body.plan)
    if plan_def is None:
        raise HTTPException(status_code=400, detail="Invalid plan")

    if plan_def.get("price_monthly_cents", 0) == 0:
        raise HTTPException(status_code=400, detail="Free plans don't need checkout")

    if not settings.stripe_secret_key:
        # Mock mode: create subscription directly
        result = await db.execute(
            select(Subscription).where(Subscription.user_id == current_user.id)
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.plan = body.plan
            sub.billing_mode = body.billing_mode
            sub.requests_limit = plan_def.get("requests_limit", -1)
            sub.status = "active"
        else:
            sub = Subscription(
                user_id=current_user.id,
                billing_mode=body.billing_mode,
                plan=body.plan,
                status="active",
                requests_used=0,
                requests_limit=plan_def.get("requests_limit", -1),
            )
            db.add(sub)
        await db.flush()
        await db.commit()

        return {"url": f"{settings.frontend_url}/billing?checkout=mock_success"}

    # Live Stripe Checkout
    if not current_user.stripe_customer_id:
        customer = await billing_service.create_or_get_customer(
            email=current_user.email,
            name=current_user.name,
            user_id=str(current_user.id),
        )
        current_user.stripe_customer_id = customer["id"]
        await db.flush()
        await db.commit()

    try:
        session = stripe.checkout.Session.create(
            customer=current_user.stripe_customer_id,
            mode="subscription",
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {
                            "name": f"Styx {plan_def['name']} ({body.billing_mode.title()})",
                        },
                        "unit_amount": plan_def["price_monthly_cents"],
                        "recurring": {"interval": "month"},
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "type": "subscription",
                "billing_mode": body.billing_mode,
                "plan": body.plan,
                "user_id": str(current_user.id),
            },
            success_url=f"{settings.frontend_url}/billing?checkout=success",
            cancel_url=f"{settings.frontend_url}/billing?checkout=cancelled",
        )
    except stripe.StripeError as e:
        logger.error("Stripe checkout session creation failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Payment provider temporarily unavailable. Please try again.",
        )

    return {"url": session.url}


@router.post("/create-portal")
async def create_portal(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Create a Stripe Customer Portal session for self-service management."""
    if not settings.stripe_secret_key:
        return {"url": f"{settings.frontend_url}/billing?portal=mock"}

    if not current_user.stripe_customer_id:
        raise HTTPException(
            status_code=400,
            detail="No Stripe customer ID found. Purchase a plan first.",
        )

    try:
        session = stripe.billing_portal.Session.create(
            customer=current_user.stripe_customer_id,
            return_url=f"{settings.frontend_url}/billing",
        )
    except stripe.StripeError as e:
        logger.error("Stripe portal session creation failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Payment provider temporarily unavailable. Please try again.",
        )
    return {"url": session.url}


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Handle Stripe webhook events with signature verification.

    Handles the full subscription lifecycle:
    - checkout.session.completed     -> fulfil subscription or credit purchase
    - invoice.paid                   -> renew quota (Charon) / add monthly credits (Achilles)
    - invoice.payment_failed         -> mark subscription as past_due
    - customer.subscription.updated  -> sync subscription status
    - customer.subscription.deleted  -> cancel subscription, revert to free tier
    """
    if not settings.stripe_webhook_secret:
        if not settings.debug:
            raise HTTPException(
                status_code=503,
                detail="Webhook not configured — STRIPE_WEBHOOK_SECRET is required in production",
            )
        return {"received": True, "mock": True}

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.get("type", "")
    event_id = event.get("id", "")
    logger.info("stripe webhook received", extra={"type": event_type, "event_id": event_id})

    # ── Idempotency: skip duplicate webhook deliveries ─────────
    redis = await _get_webhook_redis()
    if redis and event_id:
        dedup_key = f"webhook:{event_id}"
        try:
            already_processed = await redis.set(dedup_key, "1", ex=86400, nx=True)
            if not already_processed:
                logger.info("duplicate webhook skipped", extra={"event_id": event_id})
                return {"received": True, "duplicate": True}
        except Exception:
            pass  # Redis failure shouldn't block webhook processing

    # ── Update database state based on event type ──────────────
    data_object = event.get("data", {}).get("object", {})
    customer_id = data_object.get("customer")
    metadata = data_object.get("metadata", {})

    # ─── checkout.session.completed ───────────────────────────
    # Fires when a user completes Stripe Checkout. Two types:
    #   1. Subscription checkout → create/update Subscription in DB
    #   2. Credit purchase → add credits to CreditBalance
    if event_type == "checkout.session.completed":
        checkout_type = metadata.get("type", "")
        user_id_str = metadata.get("user_id", "")
        logger.info(
            "checkout completed",
            extra={"checkout_type": checkout_type, "user_id": user_id_str},
        )

        if not user_id_str:
            logger.warning("checkout.session.completed missing user_id in metadata")
            return {"received": True}

        try:
            user_uuid = uuid_mod.UUID(user_id_str)
        except ValueError:
            logger.warning("checkout.session.completed invalid user_id: %s", user_id_str)
            return {"received": True}

        # Look up the user and update stripe_customer_id if needed
        user_result = await db.execute(select(User).where(User.id == user_uuid))
        user = user_result.scalar_one_or_none()
        if user is None:
            logger.warning("checkout.session.completed user not found: %s", user_id_str)
            return {"received": True}

        if customer_id and not user.stripe_customer_id:
            user.stripe_customer_id = customer_id
        elif user.stripe_customer_id and user.stripe_customer_id != customer_id:
            logger.warning(
                "webhook customer_id mismatch user=%s got=%s expected=%s",
                user_id_str, customer_id, user.stripe_customer_id,
            )
            return {"received": True}

        if checkout_type == "subscription":
            billing_mode = metadata.get("billing_mode", "charon")
            plan_name = metadata.get("plan", "shade")
            stripe_sub_id = data_object.get("subscription")

            plan_def = get_plan(billing_mode, plan_name)
            requests_limit = plan_def.get("requests_limit", -1) if plan_def else -1

            # Update or create Subscription
            sub_result = await db.execute(
                select(Subscription).where(Subscription.user_id == user_uuid)
            )
            sub = sub_result.scalar_one_or_none()
            if sub:
                sub.billing_mode = billing_mode
                sub.plan = plan_name
                sub.stripe_customer_id = customer_id
                sub.stripe_subscription_id = stripe_sub_id
                sub.status = "active"
                sub.requests_limit = requests_limit
                sub.requests_used = 0
            else:
                sub = Subscription(
                    user_id=user_uuid,
                    billing_mode=billing_mode,
                    plan=plan_name,
                    stripe_customer_id=customer_id,
                    stripe_subscription_id=stripe_sub_id,
                    status="active",
                    requests_used=0,
                    requests_limit=requests_limit,
                )
                db.add(sub)

            # Set billing_mode on user if not already set
            if not user.billing_mode:
                user.billing_mode = billing_mode

            # For Achilles subscriptions, add monthly credits
            if billing_mode == "achilles" and plan_def:
                monthly_credits = plan_def.get("monthly_credits_cents", 0)
                if monthly_credits > 0:
                    await credit_service.add_credits(
                        db, user_uuid, monthly_credits,
                        tx_type="monthly",
                        description=f"Monthly credits: {plan_name.title()} plan",
                    )

            await db.flush()
            await db.commit()
            logger.info(
                "subscription created from checkout",
                extra={"user_id": user_id_str, "plan": plan_name, "mode": billing_mode},
            )

        elif checkout_type == "credit_purchase":
            amount_str = metadata.get("amount_cents", "0")
            amount_cents = int(amount_str) if amount_str.isdigit() else 0
            payment_intent_id = data_object.get("payment_intent")

            if amount_cents > 0:
                await credit_service.add_credits(
                    db, user_uuid, amount_cents,
                    tx_type="purchase",
                    description=f"Credit purchase: ${amount_cents / 100:.2f}",
                    stripe_payment_id=payment_intent_id,
                )
                await db.flush()
                await db.commit()
                logger.info(
                    "credits added from checkout",
                    extra={"user_id": user_id_str, "amount_cents": amount_cents},
                )

    # ─── invoice.paid ──────────────────────────────────────────
    # Fires on successful payment for recurring subscriptions.
    # For first invoice: already handled by checkout.session.completed.
    # For subsequent invoices: reset Charon quota or add Achilles monthly credits.
    elif event_type == "invoice.paid" and customer_id:
        billing_reason = data_object.get("billing_reason", "")
        # Skip the first subscription invoice — checkout.session.completed handles that
        if billing_reason == "subscription_cycle":
            stripe_sub_id = data_object.get("subscription")
            logger.info("invoice paid (renewal)", extra={"subscription": stripe_sub_id})

            if stripe_sub_id:
                sub_result = await db.execute(
                    select(Subscription).where(
                        Subscription.stripe_subscription_id == stripe_sub_id
                    )
                )
                sub = sub_result.scalar_one_or_none()
                if sub:
                    if sub.billing_mode == "charon":
                        # Reset monthly request counter
                        sub.requests_used = 0
                        sub.current_period_start = datetime.now(timezone.utc)
                        logger.info(
                            "charon quota reset",
                            extra={"user_id": str(sub.user_id), "plan": sub.plan},
                        )

                    elif sub.billing_mode == "achilles":
                        # Add monthly credits
                        plan_def = ACHILLES_PLANS.get(sub.plan)
                        if plan_def:
                            monthly_credits = plan_def.get("monthly_credits_cents", 0)
                            if monthly_credits > 0:
                                await credit_service.add_credits(
                                    db, sub.user_id, monthly_credits,
                                    tx_type="monthly",
                                    description=f"Monthly credits: {sub.plan.title()} plan renewal",
                                )
                                logger.info(
                                    "achilles monthly credits added",
                                    extra={
                                        "user_id": str(sub.user_id),
                                        "amount_cents": monthly_credits,
                                    },
                                )

                    sub.status = "active"
                    await db.flush()
                    await db.commit()

    # ─── invoice.payment_failed ────────────────────────────────
    elif event_type == "invoice.payment_failed" and customer_id:
        logger.warning("payment failed", extra={"event_id": event_id})

        # Update subscription status
        stripe_sub_id = data_object.get("subscription")
        if stripe_sub_id:
            sub_result = await db.execute(
                select(Subscription).where(
                    Subscription.stripe_subscription_id == stripe_sub_id
                )
            )
            sub = sub_result.scalar_one_or_none()
            if sub:
                sub.status = "past_due"
                await db.flush()
                await db.commit()

        # Also update legacy team status
        team = await billing_service.get_team_by_stripe_customer_id(db, customer_id)
        if team:
            team.subscription_status = "past_due"
            await db.flush()
            await db.commit()

    # ─── customer.subscription.updated ─────────────────────────
    elif event_type == "customer.subscription.updated" and customer_id:
        logger.info("subscription updated", extra={"event_id": event_id})
        team = await billing_service.get_team_by_stripe_customer_id(db, customer_id)
        if team:
            sub_status = data_object.get("status")
            period_end = data_object.get("current_period_end")
            if sub_status:
                team.subscription_status = sub_status
            if period_end:
                team.current_period_end = datetime.fromtimestamp(
                    period_end, tz=timezone.utc
                )
            await db.flush()
            await db.commit()

    # ─── customer.subscription.deleted ─────────────────────────
    elif event_type == "customer.subscription.deleted" and customer_id:
        logger.info("subscription deleted", extra={"event_id": event_id})

        # Cancel the Charon/Achilles subscription
        stripe_sub_id = data_object.get("id")
        if stripe_sub_id:
            sub_result = await db.execute(
                select(Subscription).where(
                    Subscription.stripe_subscription_id == stripe_sub_id
                )
            )
            sub = sub_result.scalar_one_or_none()
            if sub:
                sub.status = "cancelled"
                sub.stripe_subscription_id = None
                await db.flush()
                await db.commit()

        # Also update legacy team
        team = await billing_service.get_team_by_stripe_customer_id(db, customer_id)
        if team:
            team.plan = "shade"
            team.stripe_subscription_id = None
            await db.flush()
            await db.commit()

    return {"received": True}
