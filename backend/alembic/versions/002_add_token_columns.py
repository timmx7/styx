"""002 – Add token columns to routing_logs.

Revision ID: 002
Create Date: 2026-02-12
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("routing_logs", sa.Column("input_tokens", sa.Integer, server_default="0"))
    op.add_column("routing_logs", sa.Column("output_tokens", sa.Integer, server_default="0"))


def downgrade() -> None:
    op.drop_column("routing_logs", "output_tokens")
    op.drop_column("routing_logs", "input_tokens")
