"""Billing service — Stripe integration for Charon/Achilles billing.

Charon (BYOK): user brings own API keys, pays per quota (request count).
Achilles (Managed): user uses Styx keys, pays per token with 30% markup.

NOTE: In development mode (no STRIPE_SECRET_KEY), billing operations
return mock data so the dashboard can be developed without Stripe.
"""

import asyncio
import logging
from datetime import datetime, timezone

import stripe

from app.config import settings
from app.schemas_billing import CHARON_PLANS, ACHILLES_PLANS, get_plan

logger = logging.getLogger("billing_service")

# Configure Stripe
_stripe_enabled = bool(settings.stripe_secret_key)
if _stripe_enabled:
    stripe.api_key = settings.stripe_secret_key
    logger.info("Stripe configured")
else:
    logger.warning("Stripe not configured (STRIPE_SECRET_KEY missing). Using mock billing.")

# Meter availability: auto-disables after first "No active meter found" error
_meter_available = True


def _disable_meter() -> None:
    global _meter_available
    _meter_available = False


# ─── Plan definitions (delegated to schemas_billing) ─────────────

# Combined view of ALL plans for listing endpoints
PLANS = {
    **{f"charon_{k}": {**v, "billing_mode": "charon"} for k, v in CHARON_PLANS.items()},
    **{f"achilles_{k}": {**v, "billing_mode": "achilles"} for k, v in ACHILLES_PLANS.items()},
}


def get_plan_info(plan_name: str) -> dict:
    """Get plan details by name.

    Accepts both new-style names (e.g. 'shade', 'obol') and prefixed
    names (e.g. 'charon_shade', 'achilles_spark').  Falls back to
    Charon Shade (free tier).
    """
    # Try direct lookup in combined dict
    if plan_name in PLANS:
        return PLANS[plan_name]
    # Try as Charon plan name
    charon = CHARON_PLANS.get(plan_name)
    if charon:
        return {**charon, "billing_mode": "charon"}
    # Try as Achilles plan name
    achilles = ACHILLES_PLANS.get(plan_name)
    if achilles:
        return {**achilles, "billing_mode": "achilles"}
    # Fallback: free tier
    return {**CHARON_PLANS["shade"], "billing_mode": "charon"}


# ─── Stripe Customer ───────────────────────────────────────────


async def create_or_get_customer(email: str, name: str | None, user_id: str) -> dict:
    """Create a Stripe customer or return mock data."""
    if not _stripe_enabled:
        return {
            "id": f"cus_mock_{user_id[:8]}",
            "email": email,
            "name": name,
        }

    customer = await asyncio.to_thread(
        stripe.Customer.create,
        email=email,
        name=name or email,
        metadata={"styx_user_id": user_id},
    )
    return {
        "id": customer.id,
        "email": customer.email,
        "name": customer.name,
    }


# ─── Subscriptions ─────────────────────────────────────────────
# Stripe Price IDs are now stored inside CHARON_PLANS / ACHILLES_PLANS
# (schemas_billing.py) and loaded from STRIPE_PRICE_CHARON_* / STRIPE_PRICE_ACHILLES_* env vars.


async def create_subscription(
    customer_id: str, plan: str, billing_mode: str = "charon"
) -> dict:
    """Create a Stripe subscription for the given plan.

    Uses plan definitions from schemas_billing (Charon/Achilles).
    """
    if not _stripe_enabled:
        return {
            "id": f"sub_mock_{plan}",
            "status": "active",
            "plan": plan,
            "current_period_end": int(datetime.now(timezone.utc).timestamp()) + 30 * 86400,
        }

    plan_def = get_plan(billing_mode, plan)
    price_id = plan_def.get("stripe_price_id", "") if plan_def else ""
    if not price_id:
        return {
            "id": None,
            "status": "active",
            "plan": plan,
            "current_period_end": None,
        }

    sub = await asyncio.to_thread(
        stripe.Subscription.create,
        customer=customer_id,
        items=[{"price": price_id}],
        metadata={"styx_plan": plan, "billing_mode": billing_mode},
    )
    return {
        "id": sub.id,
        "status": sub.status,
        "plan": plan,
        "current_period_end": sub.current_period_end,
    }


async def cancel_subscription(subscription_id: str) -> dict:
    """Cancel a Stripe subscription at period end."""
    if not _stripe_enabled:
        return {"status": "canceled", "cancel_at_period_end": True}

    sub = await asyncio.to_thread(
        stripe.Subscription.modify,
        subscription_id,
        cancel_at_period_end=True,
    )
    return {
        "status": sub.status,
        "cancel_at_period_end": sub.cancel_at_period_end,
    }


async def report_metered_usage(customer_id: str, tokens: int) -> None:
    """Send token usage to Stripe Metered Billing (V2 Meter Events).

    This is a best-effort operation — if the meter is not configured in
    Stripe Dashboard, we log a debug message and skip silently.
    Credit deduction happens in the local DB regardless.
    """
    if not _stripe_enabled or not customer_id or tokens <= 0:
        return

    # Meter events require a Stripe Billing Meter to be configured.
    # In MVP/test mode, metered billing may not be set up yet.
    # Skip entirely if we've already detected the meter is missing.
    if not _meter_available:
        return

    try:
        await asyncio.to_thread(
            stripe.billing.MeterEvent.create,
            event_name="tokens_processed",
            payload={
                "value": str(tokens),
                "stripe_customer_id": customer_id,
            }
        )
    except stripe.InvalidRequestError as e:
        if "No active meter found" in str(e):
            _disable_meter()
            logger.info(
                "Stripe meter 'tokens_processed' not configured — "
                "disabling metered usage reporting. "
                "Credit billing via local DB is unaffected."
            )
        else:
            logger.error("Stripe metered usage error for %s: %s", customer_id, e)
    except Exception as e:
        logger.error("Failed to report usage to Stripe for %s: %s", customer_id, e)


async def get_subscription(subscription_id: str) -> dict | None:
    """Get a Stripe subscription."""
    if not _stripe_enabled:
        return {
            "id": subscription_id,
            "status": "active",
            "current_period_end": int(datetime.now(timezone.utc).timestamp()) + 30 * 86400,
        }

    try:
        sub = await asyncio.to_thread(
            stripe.Subscription.retrieve, subscription_id
        )
        return {
            "id": sub.id,
            "status": sub.status,
            "current_period_end": sub.current_period_end,
        }
    except stripe.InvalidRequestError:
        return None


# ─── Invoices ──────────────────────────────────────────────────


async def get_invoices(customer_id: str, limit: int = 10) -> list[dict]:
    """Get recent invoices for a customer."""
    if not _stripe_enabled:
        return [
            {
                "id": "inv_mock_001",
                "amount_due": 4900,
                "amount_paid": 4900,
                "currency": "usd",
                "status": "paid",
                "created": int(datetime.now(timezone.utc).timestamp()) - 30 * 86400,
                "invoice_pdf": None,
            }
        ]

    invoices = await asyncio.to_thread(
        stripe.Invoice.list, customer=customer_id, limit=limit
    )
    return [
        {
            "id": inv.id,
            "amount_due": inv.amount_due,
            "amount_paid": inv.amount_paid,
            "currency": inv.currency,
            "status": inv.status,
            "created": inv.created,
            "invoice_pdf": inv.invoice_pdf,
        }
        for inv in invoices.data
    ]


# ─── Helpers for webhook DB updates ──────────────────────────────


async def get_team_by_stripe_customer_id(
    db, customer_id: str
):
    """Look up a Team by its owner's stripe_customer_id.

    Returns the Team or None.
    """
    from sqlalchemy import select
    from app.models.user import User
    from app.models.team import Team

    result = await db.execute(
        select(Team)
        .join(User, Team.owner_id == User.id)
        .where(User.stripe_customer_id == customer_id)
    )
    return result.scalar_one_or_none()
