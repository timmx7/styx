"""Credit service -- Achilles (managed) mode credit balance + ledger.

Uses SELECT ... FOR UPDATE for atomic balance checks in PostgreSQL
to prevent race conditions on concurrent deductions.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credit_balance import CreditBalance
from app.models.credit_transaction import CreditTransaction

logger = logging.getLogger("credit_service")


async def get_or_create_balance(
    db: AsyncSession, user_id: uuid.UUID, *, for_update: bool = False
) -> CreditBalance:
    """Get or create a credit balance record for a user.

    Args:
        db: Database session.
        user_id: The user's UUID.
        for_update: If True, acquire a row-level lock (SELECT ... FOR UPDATE)
            to prevent concurrent modifications. Use this when the caller
            intends to modify the balance.
    """
    stmt = select(CreditBalance).where(CreditBalance.user_id == user_id)
    if for_update:
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    balance = result.scalar_one_or_none()
    if balance is None:
        balance = CreditBalance(user_id=user_id, balance_cents=0)
        db.add(balance)
        await db.flush()
    return balance


async def add_credits(
    db: AsyncSession,
    user_id: uuid.UUID,
    amount_cents: int,
    tx_type: str = "purchase",
    description: Optional[str] = None,
    stripe_payment_id: Optional[str] = None,
) -> CreditTransaction:
    """Add credits to a user's balance and record the transaction.

    Uses SELECT ... FOR UPDATE to prevent race conditions on concurrent
    additions (e.g. duplicate webhook deliveries).

    Used for purchases, monthly credits, bonuses, and refunds.
    """
    balance = await get_or_create_balance(db, user_id, for_update=True)
    balance.balance_cents += amount_cents
    balance.total_purchased_cents += amount_cents
    balance.updated_at = datetime.now(timezone.utc)

    tx = CreditTransaction(
        user_id=user_id,
        type=tx_type,
        amount_cents=amount_cents,
        balance_after_cents=balance.balance_cents,
        description=description or f"Credit {tx_type}: +${amount_cents / 100:.2f}",
        stripe_payment_id=stripe_payment_id,
    )
    db.add(tx)
    await db.flush()

    logger.info(
        "credits added",
        extra={
            "user_id": str(user_id),
            "amount_cents": amount_cents,
            "type": tx_type,
            "balance_after": balance.balance_cents,
        },
    )
    return tx


async def deduct_credits(
    db: AsyncSession,
    user_id: uuid.UUID,
    amount_cents: int,
    request_id: Optional[uuid.UUID] = None,
    description: Optional[str] = None,
) -> Optional[CreditTransaction]:
    """Deduct credits from a user's balance (for API usage).

    Uses SELECT ... FOR UPDATE to acquire a row-level lock on the
    CreditBalance row, preventing race conditions where two concurrent
    requests could both read the same balance and double-spend.

    Returns the transaction on success, or None if insufficient balance.
    """
    balance = await get_or_create_balance(db, user_id, for_update=True)

    if balance.balance_cents < amount_cents:
        logger.warning(
            "insufficient credits",
            extra={
                "user_id": str(user_id),
                "required": amount_cents,
                "available": balance.balance_cents,
            },
        )
        return None

    balance.balance_cents -= amount_cents
    balance.total_consumed_cents += amount_cents
    balance.updated_at = datetime.now(timezone.utc)

    tx = CreditTransaction(
        user_id=user_id,
        type="consumption",
        amount_cents=-amount_cents,
        balance_after_cents=balance.balance_cents,
        description=description or f"API usage: -${amount_cents / 100:.2f}",
        request_id=request_id,
    )
    db.add(tx)
    await db.flush()

    logger.info(
        "credits deducted",
        extra={
            "user_id": str(user_id),
            "amount_cents": amount_cents,
            "balance_after": balance.balance_cents,
        },
    )
    return tx


async def get_transactions(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 50
) -> list[CreditTransaction]:
    """Get recent credit transactions for a user."""
    result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(CreditTransaction.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
