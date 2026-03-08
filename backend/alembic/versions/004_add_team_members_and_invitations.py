"""004 – Add team_members and team_invitations tables.

Revision ID: 004
Create Date: 2026-02-14
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Create team_members table ──────────────────────────────────
    op.create_table(
        "team_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "team_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("team_id", "user_id", name="uq_team_members_team_user"),
    )

    # ── Create team_invitations table ──────────────────────────────
    op.create_table(
        "team_invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "team_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("invited_email", sa.String(255), nullable=False, index=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("token_hash", sa.String(255), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "invited_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("team_invitations")
    op.drop_table("team_members")
