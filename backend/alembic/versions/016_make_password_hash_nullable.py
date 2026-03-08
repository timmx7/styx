"""make password_hash nullable

Supabase Auth manages passwords — our User model no longer needs
a NOT NULL password_hash column. Existing placeholder values
("supabase-managed") are set to NULL.

Revision ID: 016_make_password_hash_nullable
Revises: 015_add_prompts_table
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "016_make_password_hash_nullable"
down_revision: Union[str, None] = "015_add_prompts_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make password_hash nullable
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(255),
        nullable=True,
    )
    # Clear placeholder values
    op.execute("UPDATE users SET password_hash = NULL WHERE password_hash = 'supabase-managed'")


def downgrade() -> None:
    # Restore NOT NULL with placeholder for any NULLs
    op.execute("UPDATE users SET password_hash = 'supabase-managed' WHERE password_hash IS NULL")
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(255),
        nullable=False,
    )
