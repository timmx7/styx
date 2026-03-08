"""011 – Add identity_providers table for SSO.

Revision ID: 011
Create Date: 2026-02-24
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None

PG_UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "identity_providers",
        sa.Column("id", PG_UUID, primary_key=True),
        sa.Column(
            "team_id",
            PG_UUID,
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("provider_type", sa.String(50), server_default="saml", nullable=False),
        sa.Column("domain", sa.String(255), nullable=False, index=True, unique=True),
        sa.Column("config", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("identity_providers")
