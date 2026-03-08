"""Model pricing — per-model pricing with provider cost and client markup."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Numeric, String, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.db.types import GUID


class ModelPricing(Base):
    __tablename__ = "model_pricing"
    __table_args__ = (
        UniqueConstraint("provider", "model", name="uq_model_pricing_provider_model"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Client-facing prices (includes 30% Achilles markup)
    input_price_per_million: Mapped[float] = mapped_column(
        Numeric(10, 4), nullable=False
    )
    output_price_per_million: Mapped[float] = mapped_column(
        Numeric(10, 4), nullable=False
    )
    # Actual provider costs
    cost_input_per_million: Mapped[float] = mapped_column(
        Numeric(10, 4), nullable=False
    )
    cost_output_per_million: Mapped[float] = mapped_column(
        Numeric(10, 4), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
