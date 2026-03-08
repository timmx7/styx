"""ClickHouse analytics service for high-performance usage logging.

Security design:
    - INSERT uses ClickHouse JSONEachRow format (data sent as JSON body,
      completely separate from the SQL statement → injection impossible)
    - SELECT uses ClickHouse query parameters ({param:Type} syntax with
      URL query params → data never embedded in SQL)
    - All string inputs are additionally validated at the Pydantic layer
      (regex-only alphanumeric) before reaching this module

See: https://clickhouse.com/docs/en/interfaces/http#cli-queries-with-parameters
"""

import json
import logging
import re
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger("clickhouse")

_client: httpx.AsyncClient | None = None

# Allowlists for defense-in-depth (even if Pydantic already validates)
_SAFE_IDENTIFIER = re.compile(r"^[a-zA-Z0-9_\-\.:/]+$")
_VALID_PERIODS = {"1d": 1, "7d": 7, "30d": 30, "90d": 90}


def _get_client() -> httpx.AsyncClient:
    """Lazy-init HTTP client for ClickHouse.

    Uses HTTP Basic Auth instead of query params so credentials
    don't leak into server access logs or URL-based diagnostics.
    """
    global _client
    if _client is None:
        auth = None
        if settings.clickhouse_user:
            auth = (settings.clickhouse_user, settings.clickhouse_password or "")
        _client = httpx.AsyncClient(
            base_url=settings.clickhouse_url,
            timeout=httpx.Timeout(10.0, connect=3.0),
            headers={"Content-Type": "application/json"},
            auth=auth,
        )
    return _client


async def ensure_schema() -> bool:
    """Create the ClickHouse database and table if they don't exist.

    Called once at application startup. Idempotent — safe to call multiple times.
    Returns True on success, False on failure.
    """
    if not settings.clickhouse_url:
        logger.info("ClickHouse URL not configured, skipping schema creation")
        return False

    create_db = "CREATE DATABASE IF NOT EXISTS styx"

    create_table = """
    CREATE TABLE IF NOT EXISTS styx.routing_logs (
        id UUID DEFAULT generateUUIDv4(),
        project_id String,
        provider String,
        model String,
        complexity String,
        latency_ms UInt32,
        status_code UInt16,
        cache_hit UInt8,
        was_fallback UInt8,
        input_tokens UInt32,
        output_tokens UInt32,
        cost_cents UInt64,
        end_user_id String,
        created_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(created_at)
    ORDER BY (project_id, created_at)
    TTL created_at + INTERVAL 365 DAY
    SETTINGS index_granularity = 8192
    """

    try:
        client = _get_client()
        # Create database
        resp = await client.post("/", params={"query": create_db})
        resp.raise_for_status()
        # Create table
        resp = await client.post("/", params={"query": create_table})
        resp.raise_for_status()
        
        for col in [
            "ALTER TABLE styx.routing_logs ADD COLUMN IF NOT EXISTS end_user_id String",
            "ALTER TABLE styx.routing_logs ADD COLUMN IF NOT EXISTS experiment_id String DEFAULT ''",
            "ALTER TABLE styx.routing_logs ADD COLUMN IF NOT EXISTS variant_id String DEFAULT ''",
        ]:
            resp = await client.post("/", params={"query": col})
            resp.raise_for_status()
        
        logger.info("ClickHouse schema ensured (database: styx, table: routing_logs)")
        return True
    except Exception as e:
        logger.warning(f"ClickHouse schema creation failed: {e}")
        return False


def _validate_identifier(value: str, field_name: str) -> str:
    """Validate that a string is a safe SQL identifier.

    Defense-in-depth: Pydantic schemas already enforce this regex,
    but we double-check here so this module is safe even if called
    from a future code path that skips Pydantic.
    """
    if not value or not _SAFE_IDENTIFIER.match(value):
        raise ValueError(
            f"Invalid {field_name}: contains disallowed characters: {value!r}"
        )
    return value


# ─── INSERT (JSONEachRow format — zero SQL interpolation) ────────


async def insert_routing_log(
    project_id: str,
    provider: str,
    model: str,
    complexity: str,
    latency_ms: int,
    status_code: int,
    cache_hit: bool,
    was_fallback: bool,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_cents: int = 0,
    end_user_id: str | None = None,
    experiment_id: str | None = None,
    variant_id: str | None = None,
) -> bool:
    """Insert a routing log entry into ClickHouse.

    Uses JSONEachRow format: the SQL statement is static (no user data),
    and the actual values are sent as a JSON body. This makes SQL injection
    structurally impossible — data never touches the query string.

    Returns True on success, False on failure (non-blocking).
    """
    if not settings.clickhouse_url:
        return False

    # Defense-in-depth: validate string fields even though Pydantic already did
    try:
        project_id = _validate_identifier(project_id, "project_id")
        provider = _validate_identifier(provider, "provider")
        model = _validate_identifier(model, "model")
        complexity = _validate_identifier(complexity, "complexity")
    except ValueError as e:
        logger.warning(f"ClickHouse insert rejected — invalid field: {e}")
        return False

    # Static SQL — no user data interpolated
    insert_sql = (
        "INSERT INTO styx.routing_logs "
        "(project_id, provider, model, complexity, latency_ms, status_code, "
        "cache_hit, was_fallback, input_tokens, output_tokens, cost_cents, "
        "end_user_id, experiment_id, variant_id) "
        "FORMAT JSONEachRow"
    )

    # Data as a separate JSON payload (never part of the SQL)
    row = json.dumps(
        {
            "project_id": project_id,
            "provider": provider,
            "model": model,
            "complexity": complexity,
            "latency_ms": int(latency_ms),
            "status_code": int(status_code),
            "cache_hit": 1 if cache_hit else 0,
            "was_fallback": 1 if was_fallback else 0,
            "input_tokens": int(input_tokens),
            "output_tokens": int(output_tokens),
            "cost_cents": int(cost_cents),
            "end_user_id": end_user_id or "",
            "experiment_id": experiment_id or "",
            "variant_id": variant_id or "",
        },
        separators=(",", ":"),
    )

    try:
        client = _get_client()
        resp = await client.post(
            "/",
            params={"query": insert_sql},
            content=row,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return True
    except httpx.TimeoutException:
        logger.warning("ClickHouse insert timed out")
        return False
    except Exception as e:
        logger.warning(f"ClickHouse insert failed: {e}")
        return False


# ─── SELECT (parameterized queries — zero SQL interpolation) ─────


async def query_analytics(
    project_id: str,
    period: str = "7d",
) -> list[dict[str, Any]]:
    """Query analytics from ClickHouse for a project.

    Uses ClickHouse parameterized queries: user data is passed as
    URL query parameters (param_name=value), referenced in SQL as
    {name:Type}. ClickHouse handles escaping server-side.

    See: https://clickhouse.com/docs/en/interfaces/http#cli-queries-with-parameters
    """
    if not settings.clickhouse_url:
        return []

    # Validate period against strict allowlist (not user-controlled SQL)
    days = _VALID_PERIODS.get(period)
    if days is None:
        logger.warning(f"Invalid analytics period: {period!r}, defaulting to 7d")
        days = 7

    # Defense-in-depth: validate project_id
    try:
        project_id = _validate_identifier(project_id, "project_id")
    except ValueError as e:
        logger.warning(f"ClickHouse query rejected — invalid field: {e}")
        return []

    # Parameterized SQL — {project_id:String} and {days:UInt32} are
    # replaced server-side by ClickHouse using the URL params below.
    # NO user data is ever embedded in this string.
    query = """
    SELECT
        toDate(created_at) as date,
        count() as requests,
        avg(latency_ms) as avg_latency,
        sum(cost_cents) as total_cost,
        sum(cache_hit) as cache_hits,
        countIf(status_code >= 400) as errors
    FROM styx.routing_logs
    WHERE project_id = {project_id:String}
      AND created_at >= now() - INTERVAL {days:UInt32} DAY
    GROUP BY date
    ORDER BY date
    FORMAT JSON
    """

    try:
        client = _get_client()
        resp = await client.post(
            "/",
            params={
                "query": query,
                "param_project_id": project_id,
                "param_days": str(days),
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])
    except httpx.TimeoutException:
        logger.warning("ClickHouse analytics query timed out")
        return []
    except Exception as e:
        logger.warning(f"ClickHouse analytics query failed: {e}")
        return []


async def query_traces(
    project_id: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Query detailed traces from ClickHouse for a project (includes payloads)."""
    if not settings.clickhouse_url:
        return []

    try:
        project_id = _validate_identifier(project_id, "project_id")
    except ValueError as e:
        logger.warning(f"ClickHouse query rejected — invalid field: {e}")
        return []

    limit = min(max(1, limit), 200)

    query = """
    SELECT
        id, project_id, provider, model, complexity, latency_ms, status_code,
        cache_hit, was_fallback, input_tokens, output_tokens, cost_cents,
        created_at
    FROM styx.routing_logs
    WHERE project_id = {project_id:String}
    ORDER BY created_at DESC
    LIMIT {limit:UInt32}
    FORMAT JSON
    """

    try:
        client = _get_client()
        resp = await client.post(
            "/",
            params={
                "query": query,
                "param_project_id": project_id,
                "param_limit": str(limit),
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])
    except Exception as e:
        logger.warning(f"ClickHouse traces query failed: {e}")
        return []


async def query_end_user_analytics(
    project_id: str,
    period: str = "30d",
) -> list[dict[str, Any]]:
    """Query analytics grouped by End-User from ClickHouse for a project."""
    if not settings.clickhouse_url:
        return []

    days = _VALID_PERIODS.get(period)
    if days is None:
        logger.warning(f"Invalid analytics period: {period!r}, defaulting to 30d")
        days = 30

    try:
        project_id = _validate_identifier(project_id, "project_id")
    except ValueError as e:
        logger.warning(f"ClickHouse query rejected — invalid field: {e}")
        return []

    query = """
    SELECT
        end_user_id as user_id,
        count() as total_requests,
        sum(cost_cents) as total_cost,
        sum(input_tokens + output_tokens) as total_tokens,
        avg(latency_ms) as avg_latency,
        max(created_at) as last_seen
    FROM styx.routing_logs
    WHERE project_id = {project_id:String}
      AND created_at >= now() - INTERVAL {days:UInt32} DAY
      AND end_user_id != ''
    GROUP BY end_user_id
    ORDER BY total_cost DESC
    LIMIT 100
    FORMAT JSON
    """

    try:
        client = _get_client()
        resp = await client.post(
            "/",
            params={
                "query": query,
                "param_project_id": project_id,
                "param_days": str(days),
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])
    except Exception as e:
        logger.warning(f"ClickHouse end-user analytics query failed: {e}")
        return []
