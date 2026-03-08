"""Pricing service — compute Achilles cost from model_pricing table."""

import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_pricing import ModelPricing

logger = logging.getLogger("pricing_service")


async def get_all_active_pricing(db: AsyncSession) -> list[ModelPricing]:
    """Return all active model pricing rows."""
    result = await db.execute(
        select(ModelPricing)
        .where(ModelPricing.is_active.is_(True))
        .order_by(ModelPricing.provider, ModelPricing.model)
    )
    return list(result.scalars().all())


async def get_model_pricing(
    db: AsyncSession, provider: str, model: str
) -> ModelPricing | None:
    """Look up pricing for a specific provider+model."""
    result = await db.execute(
        select(ModelPricing).where(
            ModelPricing.provider == provider,
            ModelPricing.model == model,
            ModelPricing.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


def compute_achilles_cost_cents(
    pricing: ModelPricing, input_tokens: int, output_tokens: int
) -> int:
    """Compute the Achilles (client-facing) cost in cents.

    Uses the client-facing prices (which already include 30% markup).
    Formula: (input_tokens / 1M × input_price) + (output_tokens / 1M × output_price)
    Result is rounded up to the nearest cent (always >= 1 cent if tokens > 0).
    """
    million = Decimal("1000000")
    input_cost = Decimal(input_tokens) / million * Decimal(str(pricing.input_price_per_million))
    output_cost = Decimal(output_tokens) / million * Decimal(str(pricing.output_price_per_million))
    total_dollars = input_cost + output_cost
    total_cents = int((total_dollars * 100).to_integral_value())

    # Ensure at least 1 cent if any tokens were used
    if total_cents == 0 and (input_tokens > 0 or output_tokens > 0):
        total_cents = 1

    return total_cents
