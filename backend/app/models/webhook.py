"""Webhook model — user-configured HTTP callbacks for events.

Events: budget.threshold, budget.exceeded, provider.down, provider.up,
        api_key.created, api_key.revoked
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Boolean, Text, ForeignKey

from app.db.database import Base
from app.db.types import GUID, PortableArray

from sqlalchemy.orm import relationship


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoints"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    team_id = Column(
        GUID(),
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url = Column(String(2048), nullable=False)
    secret = Column(String(255), nullable=False)  # HMAC signing secret
    events = Column(PortableArray(), nullable=False, default=list)  # subscribed event types
    is_active = Column(Boolean, server_default="true", nullable=False)
    description = Column(String(255), nullable=True)

    # Delivery tracking
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    consecutive_failures = Column(Integer, server_default="0", nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(DateTime(timezone=True), nullable=True)

    team = relationship("Team", backref="webhooks")
    deliveries = relationship("WebhookDelivery", back_populates="endpoint", cascade="all, delete-orphan")


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    endpoint_id = Column(
        GUID(),
        ForeignKey("webhook_endpoints.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type = Column(String(100), nullable=False, index=True)
    payload = Column(Text, nullable=False) # JSON encoded payload
    response_status = Column(Integer, nullable=True)
    response_body = Column(Text, nullable=True)
    success = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True
    )

    endpoint = relationship("WebhookEndpoint", back_populates="deliveries")
