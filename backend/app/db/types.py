"""Portable column types that work with both PostgreSQL and SQLite.

These types automatically use the optimal dialect-specific type:
- PostgreSQL: UUID, JSONB, ARRAY
- SQLite: VARCHAR(36), JSON, JSON
"""

import json
import uuid

from sqlalchemy import String, JSON, TypeDecorator
from sqlalchemy.dialects import postgresql


class GUID(TypeDecorator):
    """Platform-independent UUID type.

    Uses PostgreSQL's UUID type when available, otherwise uses VARCHAR(36).
    """

    impl = String(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.UUID(as_uuid=True))
        return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect):
        if value is not None:
            if dialect.name == "postgresql":
                return value if isinstance(value, uuid.UUID) else uuid.UUID(value)
            return str(value)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            if not isinstance(value, uuid.UUID):
                return uuid.UUID(value)
        return value


class PortableJSON(TypeDecorator):
    """Uses JSONB on PostgreSQL, JSON elsewhere."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.JSONB)
        return dialect.type_descriptor(JSON)


class PortableArray(TypeDecorator):
    """Stores arrays as PostgreSQL ARRAY on PG, JSON elsewhere."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.ARRAY(String))
        return dialect.type_descriptor(JSON)

    def process_bind_param(self, value, dialect):
        if value is not None and dialect.name != "postgresql":
            return json.dumps(value) if isinstance(value, str) else value
        return value

    def process_result_value(self, value, dialect):
        if value is not None and isinstance(value, str):
            return json.loads(value)
        return value
