"""Async database engine and session factory."""

import logging
import sys

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

_log = logging.getLogger("database")

# ─── Safety: block SQLite in production ─────────────────────────────
if not settings.debug and "sqlite" in settings.database_url:
    _log.critical(
        "SQLite is not supported in production. "
        "Set DATABASE_URL to a PostgreSQL connection string "
        "(e.g. postgresql+asyncpg://user:pass@host:5432/styx) "
        "or enable DEBUG mode for development."
    )
    sys.exit(1)

_engine_kwargs: dict = {"echo": settings.debug}
if "sqlite" not in settings.database_url:
    _engine_kwargs["pool_size"] = 20
    _engine_kwargs["max_overflow"] = 10

engine = create_async_engine(settings.database_url, **_engine_kwargs)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields a database session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
