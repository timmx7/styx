"""Credits API — balance, purchase, transactions (Achilles mode only)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas_billing import (
    CreditBalanceResponse,
    CreditTransactionResponse,
    PurchaseCreditsRequest,
    CREDIT_PACKS,
)
from app.services import credit_service

logger = logging.getLogger("credits")

router = APIRouter(prefix="/credits", tags=["credits"])


def _require_achilles(user: User) -> None:
    """Raise 403 if the user is not in Achilles mode."""
    if user.billing_mode != "achilles":
        raise HTTPException(
            status_code=403,
            detail="Credits are only available in Achilles (managed) mode",
        )


@router.get("/balance", response_model=CreditBalanceResponse)
async def get_balance(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CreditBalanceResponse:
    """Get the current credit balance."""
    _require_achilles(current_user)
    balance = await credit_service.get_or_create_balance(db, current_user.id)
    return CreditBalanceResponse.model_validate(balance)


@router.post("/purchase")
async def purchase_credits(
    body: PurchaseCreditsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Purchase credits (creates a Stripe Checkout session or mock).

    In mock mode (no Stripe key), credits are added immediately.
    In live mode, credits are added when the checkout.session.completed
    webhook fires.
    """
    _require_achilles(current_user)

    # Validate amount matches a known pack
    valid_amounts = {pack["amount_cents"] for pack in CREDIT_PACKS}
    if body.amount_cents not in valid_amounts:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid amount. Valid packs: {sorted(valid_amounts)}",
        )

    from app.config import settings

    if not settings.stripe_secret_key:
        # Mock mode: add credits immediately
        tx = await credit_service.add_credits(
            db,
            current_user.id,
            body.amount_cents,
            tx_type="purchase",
            description=f"Mock purchase: ${body.amount_cents / 100:.2f}",
        )
        await db.commit()
        return {
            "status": "mock_completed",
            "credits_added": body.amount_cents,
            "balance_after": tx.balance_after_cents,
        }

    # Live Stripe: create Checkout Session
    from app.services.billing_service import create_or_get_customer
    import stripe

    if not current_user.stripe_customer_id:
        customer = await create_or_get_customer(
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
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {
                            "name": f"Styx Credits — ${body.amount_cents / 100:.0f}",
                        },
                        "unit_amount": body.amount_cents,
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "type": "credit_purchase",
                "user_id": str(current_user.id),
                "amount_cents": str(body.amount_cents),
            },
            success_url=f"{settings.frontend_url}/billing?credits=success",
            cancel_url=f"{settings.frontend_url}/billing?credits=cancelled",
        )
    except stripe.StripeError as e:
        logger.error("Stripe credit checkout failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Payment provider temporarily unavailable. Please try again.",
        )

    return {"url": session.url}


@router.get("/transactions", response_model=list[CreditTransactionResponse])
async def list_transactions(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CreditTransactionResponse]:
    """Get recent credit transactions."""
    _require_achilles(current_user)
    txs = await credit_service.get_transactions(db, current_user.id, limit=limit)
    return [CreditTransactionResponse.model_validate(tx) for tx in txs]
