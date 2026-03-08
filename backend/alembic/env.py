"""Alembic environment configuration for async SQLAlchemy.

Uses the async engine pattern so that migrations work with asyncpg /
any other async dialect configured in ``app.config.settings.database_url``.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings
from app.db.database import Base

# ---------------------------------------------------------------------------
# Import ALL models so that Base.metadata is fully populated before Alembic
# inspects it.  Every model file must be imported here; otherwise autogenerate
# will not detect the corresponding table.
# ---------------------------------------------------------------------------
from app.models import user  # noqa: F401
from app.models import team  # noqa: F401
from app.models import team_member  # noqa: F401
from app.models import team_invitation  # noqa: F401
from app.models import project  # noqa: F401
from app.models import api_key  # noqa: F401
from app.models import provider_key  # noqa: F401
from app.models import usage_log  # noqa: F401
from app.models import routing_log  # noqa: F401
from app.models import alert  # noqa: F401
from app.models import audit_log  # noqa: F401
from app.models import webhook  # noqa: F401
from app.models import sso  # noqa: F401
from app.models import ab_test  # noqa: F401
from app.models import subscription  # noqa: F401
from app.models import credit_balance  # noqa: F401
from app.models import credit_transaction  # noqa: F401
from app.models import model_pricing  # noqa: F401
from app.models import project_member  # noqa: F401
from app.models import prompt  # noqa: F401

# ---------------------------------------------------------------------------
# Alembic Config object — provides access to values in alembic.ini.
# ---------------------------------------------------------------------------
config = context.config

# Interpret the config file for Python logging (if present).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The metadata object that Alembic uses for autogenerate diff detection.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Configures the context with just a URL (no Engine needed).  Calls to
    ``context.execute()`` emit the given SQL string to the script output.
    """
    url = settings.database_url
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """Helper executed inside ``connection.run_sync`` to run migrations."""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode using an async engine.

    Creates an ``AsyncEngine`` from ``settings.database_url``, obtains a
    connection, then delegates to ``do_run_migrations`` via ``run_sync``.
    """
    connectable = create_async_engine(settings.database_url)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
