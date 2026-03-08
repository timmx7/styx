"""008 – Add unique constraint on api_keys.key_hash.

Revision ID: 008
Create Date: 2026-02-16
"""

from alembic import op

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the existing non-unique index first, then create a unique one.
    # The index name follows SQLAlchemy's auto-naming: ix_api_keys_key_hash.
    op.drop_index("ix_api_keys_key_hash", table_name="api_keys")
    op.create_index(
        "ix_api_keys_key_hash",
        "api_keys",
        ["key_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_api_keys_key_hash", table_name="api_keys")
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"], unique=False)
