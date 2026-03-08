"""Billing schemas — plan definitions, Pydantic models for Charon / Achilles.

Charon (BYOK): client brings own API keys, pays per quota (request count).
Achilles (Managed): client uses Styx keys, pays per token with 30% markup.
"""

import os
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ═══════════════════════════════════════════════════════════════════════
# PLAN DEFINITIONS (constants, not stored in DB)
# Stripe price IDs loaded from env vars.  Run scripts/stripe_setup.py
# to create them in your Stripe account.
# ═══════════════════════════════════════════════════════════════════════

CHARON_PLANS: dict[str, dict] = {
    "shade": {
        "name": "Shade",
        "price_monthly_cents": 0,
        "requests_limit": 10_000,
        "stripe_price_id": os.getenv("STRIPE_PRICE_CHARON_SHADE", ""),
        "features": [
            "10,000 requests/month",
            "Bring your own keys",
            "Community support",
        ],
    },
    "obol": {
        "name": "Obol",
        "price_monthly_cents": 2_500,
        "requests_limit": 100_000,
        "stripe_price_id": os.getenv("STRIPE_PRICE_CHARON_OBOL", ""),
        "features": [
            "100,000 requests/month",
            "Bring your own keys",
            "Smart routing",
            "Email support",
        ],
    },
    "ferryman": {
        "name": "Ferryman",
        "price_monthly_cents": 14_900,
        "requests_limit": 1_000_000,
        "stripe_price_id": os.getenv("STRIPE_PRICE_CHARON_FERRYMAN", ""),
        "features": [
            "1,000,000 requests/month",
            "Bring your own keys",
            "Smart routing + Semantic cache",
            "Priority support",
        ],
    },
    "titan": {
        "name": "Titan",
        "price_monthly_cents": 49_900,
        "requests_limit": -1,  # unlimited
        "stripe_price_id": os.getenv("STRIPE_PRICE_CHARON_TITAN", ""),
        "features": [
            "Unlimited requests",
            "Bring your own keys",
            "Full feature set",
            "Dedicated support",
            "SLA guarantee",
        ],
    },
}

ACHILLES_PLANS: dict[str, dict] = {
    "spark": {
        "name": "Spark",
        "price_monthly_cents": 2_000,
        "monthly_credits_cents": 2_000,
        "stripe_price_id": os.getenv("STRIPE_PRICE_ACHILLES_SPARK", ""),
        "features": [
            "$20 credits/month",
            "Managed API keys",
            "Smart routing",
            "Email support",
        ],
    },
    "blaze": {
        "name": "Blaze",
        "price_monthly_cents": 10_000,
        "monthly_credits_cents": 10_000,
        "stripe_price_id": os.getenv("STRIPE_PRICE_ACHILLES_BLAZE", ""),
        "features": [
            "$100 credits/month",
            "Managed API keys",
            "Smart routing + Semantic cache",
            "Priority support",
        ],
    },
    "inferno": {
        "name": "Inferno",
        "price_monthly_cents": 50_000,
        "monthly_credits_cents": 50_000,
        "stripe_price_id": os.getenv("STRIPE_PRICE_ACHILLES_INFERNO", ""),
        "features": [
            "$500 credits/month",
            "Managed API keys",
            "Full feature set",
            "Dedicated support",
            "SLA guarantee",
        ],
    },
}

CREDIT_PACKS: list[dict] = [
    {"amount_cents": 2_000, "label": "$20", "stripe_price_id": ""},
    {"amount_cents": 10_000, "label": "$100", "stripe_price_id": ""},
    {"amount_cents": 50_000, "label": "$500", "stripe_price_id": ""},
]


def get_plan(billing_mode: str, plan_name: str) -> dict | None:
    """Look up a plan by billing mode and plan name."""
    if billing_mode == "charon":
        return CHARON_PLANS.get(plan_name)
    elif billing_mode == "achilles":
        return ACHILLES_PLANS.get(plan_name)
    return None


# ═══════════════════════════════════════════════════════════════════════
# PYDANTIC RESPONSE SCHEMAS
# ═══════════════════════════════════════════════════════════════════════

# ─── Subscription ─────────────────────────────────────────────────────

class SubscriptionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    billing_mode: str
    plan: str
    status: str
    requests_used: int
    requests_limit: int
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Credits ──────────────────────────────────────────────────────────

class CreditBalanceResponse(BaseModel):
    balance_cents: int
    total_purchased_cents: int
    total_consumed_cents: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreditTransactionResponse(BaseModel):
    id: uuid.UUID
    type: str
    amount_cents: int
    balance_after_cents: int
    description: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Model Pricing ────────────────────────────────────────────────────

class ModelPricingResponse(BaseModel):
    provider: str
    model: str
    display_name: str
    input_price_per_million: float
    output_price_per_million: float
    is_active: bool

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════════════════
# REQUEST SCHEMAS
# ═══════════════════════════════════════════════════════════════════════

class SetBillingModeRequest(BaseModel):
    """One-shot: choose Charon or Achilles (null → value, no switching)."""
    billing_mode: str = Field(
        ..., pattern="^(charon|achilles)$",
        description="'charon' for BYOK or 'achilles' for managed",
    )


class CreateCheckoutRequest(BaseModel):
    """Create a Stripe Checkout Session for a subscription or credit pack."""
    billing_mode: str = Field(..., pattern="^(charon|achilles)$")
    plan: str = Field(
        ..., max_length=20,
        description="Plan name (shade/obol/ferryman/titan)",
    )


class PurchaseCreditsRequest(BaseModel):
    """Purchase a credit pack (Achilles only)."""
    amount_cents: int = Field(
        ..., gt=0,
        description="Credit amount in cents (1000, 5000, or 20000)",
    )


class CreatePortalRequest(BaseModel):
    """Create a Stripe Customer Portal session for self-service management."""
    pass  # No fields needed, uses authenticated user's Stripe customer ID
