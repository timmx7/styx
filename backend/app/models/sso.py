"""SSO Identity Provider SQLAlchemy model."""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID


class IdentityProvider(Base):
    """
    SAML/OIDC Identity Provider configuration for a Team.
    Used to implement Enterprise SSO (Single Sign-On).
    """
    __tablename__ = "identity_providers"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("teams.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    provider_type: Mapped[str] = mapped_column(
        String(50), default="saml", doc="e.g., 'saml', 'oidc'"
    )
    domain: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True,
        doc="The email domain associated with this IDP, e.g., 'acme.com'"
    )
    config: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict,
        doc="Provider-specific configuration (e.g., SAML metadata URL, X.509 cert, issuer)"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationship
    team = relationship("Team", back_populates="identity_provider", lazy="selectin")
