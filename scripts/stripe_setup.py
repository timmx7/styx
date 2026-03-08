#!/usr/bin/env python3
"""One-shot Stripe setup script — creates all Styx products and prices.

Usage:
    STRIPE_SECRET_KEY=sk_test_xxx python3 scripts/stripe_setup.py

This script is IDEMPOTENT: it checks for existing products by metadata
before creating new ones.  Safe to re-run.

After running, copy the printed env vars into your .env file.
"""

import os
import sys
import json

try:
    import stripe
except ImportError:
    print("ERROR: stripe package not installed. Run: pip install stripe")
    sys.exit(1)

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
if not stripe.api_key:
    print("ERROR: Set STRIPE_SECRET_KEY environment variable first.")
    print("  export STRIPE_SECRET_KEY=sk_test_...")
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════
# Plan Definitions — match schemas_billing.py + user spec
# ═══════════════════════════════════════════════════════════════

CHARON_PLANS = [
    {
        "name": "Shade",
        "key": "shade",
        "price_cents": 0,
        "interval": "month",
        "metadata": {"tier": "shade", "billing_mode": "charon", "requests_limit": "10000"},
        "description": "Free tier — 10,000 requests/month, BYOK",
    },
    {
        "name": "Obol",
        "key": "obol",
        "price_cents": 2900,
        "interval": "month",
        "metadata": {"tier": "obol", "billing_mode": "charon", "requests_limit": "100000"},
        "description": "Starter — 100,000 requests/month, BYOK, smart routing",
    },
    {
        "name": "Ferryman",
        "key": "ferryman",
        "price_cents": 9900,
        "interval": "month",
        "metadata": {"tier": "ferryman", "billing_mode": "charon", "requests_limit": "1000000"},
        "description": "Pro — 1,000,000 requests/month, BYOK, routing + cache",
    },
    {
        "name": "Titan",
        "key": "titan",
        "price_cents": 49900,
        "interval": "month",
        "metadata": {"tier": "titan", "billing_mode": "charon", "requests_limit": "unlimited"},
        "description": "Enterprise — Unlimited requests, BYOK, full features, SLA",
    },
]

ACHILLES_PLANS = [
    {
        "name": "Spark",
        "key": "spark",
        "price_cents": 1000,
        "interval": "month",
        "metadata": {"tier": "spark", "billing_mode": "achilles", "credits": "10000"},
        "description": "Starter credits — 10,000 credits/month",
    },
    {
        "name": "Blaze",
        "key": "blaze",
        "price_cents": 5000,
        "interval": "month",
        "metadata": {"tier": "blaze", "billing_mode": "achilles", "credits": "60000"},
        "description": "Pro credits — 60,000 credits/month",
    },
    {
        "name": "Inferno",
        "key": "inferno",
        "price_cents": 20000,
        "interval": "month",
        "metadata": {"tier": "inferno", "billing_mode": "achilles", "credits": "300000"},
        "description": "Business credits — 300,000 credits/month",
    },
]


def find_existing_product(tier: str, billing_mode: str) -> str | None:
    """Check if a product with matching metadata already exists."""
    products = stripe.Product.list(limit=100, active=True)
    for p in products.auto_paging_iter():
        meta = p.get("metadata", {})
        if meta.get("tier") == tier and meta.get("billing_mode") == billing_mode:
            return p["id"]
    return None


def find_existing_price(product_id: str) -> str | None:
    """Get the active recurring price for a product."""
    prices = stripe.Price.list(product=product_id, active=True, limit=5)
    for p in prices.data:
        if p.get("recurring"):
            return p["id"]
    return None


def create_plan(plan: dict) -> tuple[str, str]:
    """Create or reuse a Stripe Product + Price.  Returns (product_id, price_id)."""
    tier = plan["key"]
    billing_mode = plan["metadata"]["billing_mode"]

    # Check for existing product
    product_id = find_existing_product(tier, billing_mode)
    if product_id:
        print(f"  [EXISTING] Product '{plan['name']}' ({billing_mode}/{tier}) → {product_id}")
        price_id = find_existing_price(product_id)
        if price_id:
            print(f"  [EXISTING] Price → {price_id}")
            return product_id, price_id

    # Create product
    if not product_id:
        product = stripe.Product.create(
            name=f"Styx {plan['name']} ({billing_mode.title()})",
            description=plan["description"],
            metadata=plan["metadata"],
        )
        product_id = product["id"]
        print(f"  [CREATED]  Product '{plan['name']}' → {product_id}")

    # Create price
    price_params = {
        "product": product_id,
        "currency": "usd",
        "recurring": {"interval": plan["interval"]},
        "metadata": plan["metadata"],
    }

    if plan["price_cents"] == 0:
        # Free tier: use $0 price
        price_params["unit_amount"] = 0
    else:
        price_params["unit_amount"] = plan["price_cents"]

    price = stripe.Price.create(**price_params)
    price_id = price["id"]
    print(f"  [CREATED]  Price → {price_id} (${plan['price_cents']/100:.2f}/mo)")

    return product_id, price_id


def main():
    print("=" * 60)
    print("  STYX — Stripe Product & Price Setup")
    print("=" * 60)
    print(f"\nUsing Stripe key: {stripe.api_key[:12]}...{stripe.api_key[-4:]}")
    print(f"Mode: {'TEST' if 'test' in stripe.api_key else 'LIVE'}\n")

    env_lines = []

    # ── Charon Plans ──────────────────────────────────────────
    print("─── Charon Plans (BYOK Gateway) ───")
    for plan in CHARON_PLANS:
        product_id, price_id = create_plan(plan)
        env_key = f"STRIPE_PRICE_CHARON_{plan['key'].upper()}"
        env_lines.append(f"{env_key}={price_id}")

    # ── Achilles Plans ────────────────────────────────────────
    print("\n─── Achilles Plans (Credit-Based) ───")
    for plan in ACHILLES_PLANS:
        product_id, price_id = create_plan(plan)
        env_key = f"STRIPE_PRICE_ACHILLES_{plan['key'].upper()}"
        env_lines.append(f"{env_key}={price_id}")

    # ── Webhook Setup ─────────────────────────────────────────
    print("\n─── Webhook Reminder ───")
    print("Create a webhook in Stripe Dashboard → Developers → Webhooks:")
    print("  URL: https://api.yourdomain.com/api/billing/webhook")
    print("  Events:")
    print("    - checkout.session.completed")
    print("    - customer.subscription.updated")
    print("    - customer.subscription.deleted")
    print("    - invoice.payment_succeeded")
    print("    - invoice.payment_failed")
    print("  Then add the signing secret to your .env:")
    print("    STRIPE_WEBHOOK_SECRET=whsec_xxx\n")

    # ── Output env vars ───────────────────────────────────────
    print("=" * 60)
    print("  Add these to your .env file:")
    print("=" * 60)
    for line in env_lines:
        print(f"  {line}")
    print()

    # Also write to a file for easy copy
    env_path = os.path.join(os.path.dirname(__file__), "..", ".stripe-ids.env")
    with open(env_path, "w") as f:
        f.write("# Auto-generated by scripts/stripe_setup.py\n")
        f.write("# Copy these into your .env file\n\n")
        for line in env_lines:
            f.write(f"{line}\n")
    print(f"  Also saved to: {env_path}")
    print(f"\n  Total: {len(CHARON_PLANS)} Charon + {len(ACHILLES_PLANS)} Achilles = {len(CHARON_PLANS) + len(ACHILLES_PLANS)} plans")
    print("  Done!")


if __name__ == "__main__":
    main()
