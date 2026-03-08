"""Usage log SQLAlchemy model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.db.types import GUID


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("projects.id"), nullable=False
    )
    api_key_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("api_keys.id"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cost_cents: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    was_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    complexity: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
