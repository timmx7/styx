"""009 – Add subscription_status and current_period_end to teams.

These columns store Stripe subscription state synced via webhooks,
enabling the backend to track subscription lifecycle without querying
Stripe on every request.

Revision ID: 009
Create Date: 2026-02-16
"""

import sqlalchemy as sa
from alembic import op

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "teams",
        sa.Column("subscription_status", sa.String(50), nullable=True),
    )
    op.add_column(
        "teams",
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("teams", "current_period_end")
    op.drop_column("teams", "subscription_status")
