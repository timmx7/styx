"""Unit tests for the dynamic pricing sync service."""

import pytest
from decimal import Decimal
from unittest.mock import patch
from app.services.sync_pricing import sync_pricing_now, SUPPORTED_MODELS
from app.models.model_pricing import ModelPricing


# Mock the external LiteLLM response — only includes a subset of our supported models.
# The sync should still create ALL 13 supported models (using fallback prices for the rest).
MOCK_LITELLM_RESPONSE = {
    "gpt-4o": {
        "max_tokens": 4096,
        "max_input_tokens": 128000,
        "input_cost_per_token": 0.0000025,
        "output_cost_per_token": 0.00001,
        "litellm_provider": "openai",
        "mode": "gpt-4o",
    },
    "claude-3-5-sonnet-20241022": {
        "max_tokens": 8192,
        "max_input_tokens": 200000,
        "input_cost_per_token": 0.000003,
        "output_cost_per_token": 0.000015,
        "litellm_provider": "anthropic",
    },
    "unknown-provider/model": {
        # Not in SUPPORTED_MODELS — should be ignored
        "input_cost_per_token": 0.001,
    },
}


@pytest.mark.asyncio
@patch("app.services.sync_pricing.fetch_litellm_pricing")
async def test_sync_pricing_creates_all_supported(mock_fetch, db_session):
    """sync_pricing_now creates exactly len(SUPPORTED_MODELS) rows."""
    mock_fetch.return_value = MOCK_LITELLM_RESPONSE

    await sync_pricing_now()

    from sqlalchemy import select
    result = await db_session.execute(
        select(ModelPricing).order_by(ModelPricing.provider, ModelPricing.model)
    )
    models = result.scalars().all()

    # All 13 supported models should exist
    assert len(models) == len(SUPPORTED_MODELS)

    # Verify providers present
    providers = {m.provider for m in models}
    assert providers == {"openai", "anthropic", "google", "mistral"}


@pytest.mark.asyncio
@patch("app.services.sync_pricing.fetch_litellm_pricing")
async def test_sync_pricing_uses_litellm_when_available(mock_fetch, db_session):
    """Models with LiteLLM data should use live prices, not fallback."""
    mock_fetch.return_value = MOCK_LITELLM_RESPONSE

    await sync_pricing_now()

    from sqlalchemy import select
    result = await db_session.execute(
        select(ModelPricing).where(
            ModelPricing.provider == "openai",
            ModelPricing.model == "gpt-4o",
        )
    )
    gpt4o = result.scalar_one()

    # GPT-4o input: 0.0000025 * 1M = 2.5
    assert float(gpt4o.cost_input_per_million) == 2.5
    # GPT-4o output: 0.00001 * 1M = 10.0
    assert float(gpt4o.cost_output_per_million) == 10.0
    # Achilles price = cost * 1.30
    assert float(gpt4o.input_price_per_million) == 3.25
    assert float(gpt4o.output_price_per_million) == 13.0


@pytest.mark.asyncio
@patch("app.services.sync_pricing.fetch_litellm_pricing")
async def test_sync_pricing_uses_fallback_when_missing(mock_fetch, db_session):
    """Models NOT in LiteLLM response should use hardcoded fallback prices."""
    mock_fetch.return_value = {}  # Empty response — all models use fallback

    await sync_pricing_now()

    from sqlalchemy import select
    result = await db_session.execute(
        select(ModelPricing).where(
            ModelPricing.provider == "openai",
            ModelPricing.model == "gpt-4o",
        )
    )
    gpt4o = result.scalar_one()

    # Should match fallback prices from SUPPORTED_MODELS
    fallback = SUPPORTED_MODELS["gpt-4o"]
    assert Decimal(str(gpt4o.cost_input_per_million)) == fallback["fallback_input"]
    assert Decimal(str(gpt4o.cost_output_per_million)) == fallback["fallback_output"]


@pytest.mark.asyncio
@patch("app.services.sync_pricing.fetch_litellm_pricing")
async def test_sync_pricing_cleanup_unsupported(mock_fetch, db_session):
    """Rows not in SUPPORTED_MODELS should be deleted during sync."""
    # Manually insert an unsupported model
    orphan = ModelPricing(
        provider="bedrock",
        model="amazon-titan",
        display_name="Amazon Titan",
        cost_input_per_million=1.0,
        cost_output_per_million=2.0,
        input_price_per_million=1.3,
        output_price_per_million=2.6,
        is_active=True,
    )
    db_session.add(orphan)
    await db_session.flush()

    mock_fetch.return_value = {}

    await sync_pricing_now()

    from sqlalchemy import select, func
    count = await db_session.execute(
        select(func.count()).select_from(ModelPricing)
    )
    total = count.scalar()

    # Only the supported models should remain, orphan deleted
    assert total == len(SUPPORTED_MODELS)

    # Verify the orphan is gone
    result = await db_session.execute(
        select(ModelPricing).where(ModelPricing.provider == "bedrock")
    )
    assert result.scalar_one_or_none() is None
