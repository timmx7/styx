"""add guardrails configuration to project

Revision ID: 012_add_guardrails
Revises: 011_add_identity_providers
Create Date: 2026-02-24 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '012_add_guardrails'
down_revision: Union[str, None] = '011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # We add a generic JSON column for guardrails configuration
    op.add_column('projects', sa.Column('guardrails_config', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'guardrails_config')
