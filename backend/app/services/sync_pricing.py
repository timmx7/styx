"""Background service to sync LLM pricing from LiteLLM and calculate Achilles markup.

Only models actually supported by the Go router are tracked.  The SUPPORTED_MODELS
dict is the single source of truth — anything not listed here is ignored even if
present in the external LiteLLM JSON.
"""

import asyncio
import logging
import httpx
from decimal import Decimal

from sqlalchemy import select, delete
from app.db.database import async_session
from app.models.model_pricing import ModelPricing

logger = logging.getLogger("sync_pricing")

# ── External pricing source ──────────────────────────────────────────
LITELLM_PRICING_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)

# ── Achilles markup (30% over provider cost) ─────────────────────────
MARKUP_MULTIPLIER = Decimal("1.30")

# ── Only these providers are supported by the Go router ──────────────
SUPPORTED_PROVIDERS = {"openai", "anthropic", "google", "mistral"}

# ── Whitelist of models we actually route (updated March 2026) ────────
# Keys = LiteLLM lookup key, values = (provider, display_name, fallback $/M)
# Fallback seed prices ($/M tokens) are used when LiteLLM is unreachable.
# Must stay in sync with router/config/config.yaml
SUPPORTED_MODELS: dict[str, dict] = {
    # ── OpenAI — GPT-4.1 family ───────────────────────────────────────
    "gpt-4.1": {
        "provider": "openai",
        "display_name": "GPT-4.1",
        "fallback_input": Decimal("2.00"),
        "fallback_output": Decimal("8.00"),
    },
    "gpt-4.1-mini": {
        "provider": "openai",
        "display_name": "GPT-4.1 Mini",
        "fallback_input": Decimal("0.40"),
        "fallback_output": Decimal("1.60"),
    },
    # ── OpenAI — Reasoning models (o-series) ──────────────────────────
    "o3": {
        "provider": "openai",
        "display_name": "O3",
        "fallback_input": Decimal("10.00"),
        "fallback_output": Decimal("40.00"),
    },
    "o4-mini": {
        "provider": "openai",
        "display_name": "O4 Mini",
        "fallback_input": Decimal("1.10"),
        "fallback_output": Decimal("4.40"),
    },
    # ── OpenAI — GPT-4o family (GA) ───────────────────────────────────
    "gpt-4o": {
        "provider": "openai",
        "display_name": "GPT-4o",
        "fallback_input": Decimal("2.50"),
        "fallback_output": Decimal("10.00"),
    },
    "gpt-4o-mini": {
        "provider": "openai",
        "display_name": "GPT-4o Mini",
        "fallback_input": Decimal("0.15"),
        "fallback_output": Decimal("0.60"),
    },
    # ── Anthropic — Claude 4 ──────────────────────────────────────────
    "claude-sonnet-4-20250514": {
        "provider": "anthropic",
        "display_name": "Claude Sonnet 4",
        "fallback_input": Decimal("3.00"),
        "fallback_output": Decimal("15.00"),
    },
    # ── Anthropic — Claude 3.5 ────────────────────────────────────────
    "claude-3-5-sonnet-20241022": {
        "provider": "anthropic",
        "display_name": "Claude 3.5 Sonnet",
        "fallback_input": Decimal("3.00"),
        "fallback_output": Decimal("15.00"),
    },
    "claude-3-5-haiku-20241022": {
        "provider": "anthropic",
        "display_name": "Claude 3.5 Haiku",
        "fallback_input": Decimal("0.80"),
        "fallback_output": Decimal("4.00"),
    },
    # ── Anthropic — Claude 3 (legacy) ────────────────────────────────
    "claude-3-haiku-20240307": {
        "provider": "anthropic",
        "display_name": "Claude 3 Haiku",
        "fallback_input": Decimal("0.25"),
        "fallback_output": Decimal("1.25"),
    },
    # ── Google — Gemini 2.5 (March 2026) ─────────────────────────────
    "gemini-2.5-pro": {
        "provider": "google",
        "display_name": "Gemini 2.5 Pro",
        "fallback_input": Decimal("1.25"),
        "fallback_output": Decimal("10.00"),
    },
    "gemini-2.5-flash": {
        "provider": "google",
        "display_name": "Gemini 2.5 Flash",
        "fallback_input": Decimal("0.30"),
        "fallback_output": Decimal("2.50"),
    },
    "gemini-2.5-flash-lite": {
        "provider": "google",
        "display_name": "Gemini 2.5 Flash Lite",
        "fallback_input": Decimal("0.10"),
        "fallback_output": Decimal("0.40"),
    },
    # ── Google — Gemini 2.0 (retiring June 2026) ─────────────────────
    "gemini-2.0-flash": {
        "provider": "google",
        "display_name": "Gemini 2.0 Flash",
        "fallback_input": Decimal("0.10"),
        "fallback_output": Decimal("0.40"),
    },
    # ── Mistral ───────────────────────────────────────────────────────
    "mistral-large-latest": {
        "provider": "mistral",
        "display_name": "Mistral Large",
        "fallback_input": Decimal("2.00"),
        "fallback_output": Decimal("6.00"),
    },
    "mistral-medium-3": {
        "provider": "mistral",
        "display_name": "Mistral Medium 3",
        "fallback_input": Decimal("0.40"),
        "fallback_output": Decimal("2.00"),
    },
    "mistral-small-latest": {
        "provider": "mistral",
        "display_name": "Mistral Small",
        "fallback_input": Decimal("0.10"),
        "fallback_output": Decimal("0.30"),
    },
    "codestral-latest": {
        "provider": "mistral",
        "display_name": "Codestral",
        "fallback_input": Decimal("0.30"),
        "fallback_output": Decimal("0.90"),
    },
}


async def fetch_litellm_pricing() -> dict:
    """Fetch the latest pricing map from LiteLLM's GitHub repository."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(LITELLM_PRICING_URL)
        response.raise_for_status()
        return response.json()


async def sync_pricing_now():
    """Sync model_pricing table with latest prices.

    1. Fetch external prices from LiteLLM (best-effort).
    2. For each model in SUPPORTED_MODELS, upsert a row.
    3. Delete any row NOT in SUPPORTED_MODELS (cleanup legacy pollution).
    """
    logger.info("Starting pricing sync (supported models only)...")

    # Best-effort fetch — if it fails we use fallback prices
    external_prices: dict = {}
    try:
        external_prices = await fetch_litellm_pricing()
        logger.info(f"Fetched {len(external_prices)} entries from LiteLLM")
    except Exception as e:
        logger.warning(f"Could not fetch LiteLLM pricing, using fallback prices: {e}")

    updated = 0
    added = 0

    async with async_session() as session:
        # Load existing rows
        result = await session.execute(select(ModelPricing))
        existing = {
            f"{m.provider}/{m.model}": m for m in result.scalars().all()
        }

        for model_key, spec in SUPPORTED_MODELS.items():
            provider = spec["provider"]
            display_name = spec["display_name"]

            # Try to get live prices from LiteLLM
            ext = external_prices.get(model_key, {})
            input_cost_token = ext.get("input_cost_per_token") if isinstance(ext, dict) else None
            output_cost_token = ext.get("output_cost_per_token") if isinstance(ext, dict) else None

            if input_cost_token is not None and output_cost_token is not None:
                try:
                    cost_input = Decimal(str(input_cost_token)) * Decimal("1000000")
                    cost_output = Decimal(str(output_cost_token)) * Decimal("1000000")
                except Exception:
                    cost_input = spec["fallback_input"]
                    cost_output = spec["fallback_output"]
            else:
                # Use hardcoded fallback prices
                cost_input = spec["fallback_input"]
                cost_output = spec["fallback_output"]

            price_input = cost_input * MARKUP_MULTIPLIER
            price_output = cost_output * MARKUP_MULTIPLIER

            db_key = f"{provider}/{model_key}"
            row = existing.get(db_key)

            if row:
                # Update if changed
                if (
                    Decimal(str(row.cost_input_per_million)) != cost_input
                    or Decimal(str(row.cost_output_per_million)) != cost_output
                ):
                    row.cost_input_per_million = cost_input
                    row.cost_output_per_million = cost_output
                    row.input_price_per_million = price_input
                    row.output_price_per_million = price_output
                    updated += 1
            else:
                # Create new
                new_row = ModelPricing(
                    provider=provider,
                    model=model_key,
                    display_name=display_name,
                    cost_input_per_million=cost_input,
                    cost_output_per_million=cost_output,
                    input_price_per_million=price_input,
                    output_price_per_million=price_output,
                    is_active=True,
                )
                session.add(new_row)
                added += 1

        # ── Cleanup: delete any model NOT in our whitelist ────────────
        supported_keys = {
            f"{spec['provider']}/{key}" for key, spec in SUPPORTED_MODELS.items()
        }
        orphan_keys = set(existing.keys()) - supported_keys
        if orphan_keys:
            for orphan_key in orphan_keys:
                orphan_row = existing[orphan_key]
                await session.delete(orphan_row)
            logger.info(f"Removed {len(orphan_keys)} unsupported model pricing rows")

        await session.commit()
        logger.info(
            f"Pricing sync complete: {added} added, {updated} updated, "
            f"{len(orphan_keys)} removed. Total: {len(SUPPORTED_MODELS)} models."
        )


async def start_periodic_sync(interval_hours: int = 24):
    """Background task to sync pricing periodically."""
    logger.info(f"Starting periodic pricing sync (every {interval_hours}h)")
    while True:
        try:
            await sync_pricing_now()
        except Exception as e:
            logger.error(f"Error in periodic pricing sync: {e}")

        await asyncio.sleep(interval_hours * 3600)
