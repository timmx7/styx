"""Project SQLAlchemy model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Integer, DateTime, ForeignKey, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID, PortableArray


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("teams.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    budget_monthly_cents: Mapped[int | None] = mapped_column(Integer)
    budget_alert_threshold_pct: Mapped[int] = mapped_column(Integer, default=80)
    allowed_providers: Mapped[list[str] | None] = mapped_column(PortableArray())
    routing_strategy: Mapped[str] = mapped_column(String(50), default="cost_optimized")
    pii_redaction_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    guardrails_config: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)
    semantic_cache_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    end_user_rate_limit: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    team = relationship("Team", back_populates="projects", lazy="selectin")
    api_keys = relationship("ApiKey", back_populates="project", lazy="selectin")
    provider_keys = relationship("ProviderKey", back_populates="project", lazy="selectin", cascade="all, delete-orphan")
    members = relationship("ProjectMember", back_populates="project", lazy="selectin", cascade="all, delete-orphan")
    ab_tests = relationship("ABTestExperiment", back_populates="project", lazy="selectin", cascade="all, delete-orphan")
