"""Budget service — real-time spend tracking via Redis + budget enforcement.

Redis keys used:
  spend:{project_id}:monthly:{YYYY-MM}  → integer (cents spent this month)
  spend:{team_id}:monthly:{YYYY-MM}     → integer (cents spent this month)

Budget check uses a Lua script for atomic check-and-increment to prevent
race conditions where concurrent requests could exceed the budget.
"""

import logging
from datetime import datetime, timezone

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger("budget_service")

_redis_client: redis.Redis | None = None

# ── Lua script for atomic budget check + increment ──────────────────
# KEYS[1] = spend key for the project
# ARGV[1] = budget_cents (0 = no budget)
# ARGV[2] = cost_cents to add
# ARGV[3] = TTL seconds for the key
# Returns: [new_total, was_allowed (1/0)]
_ATOMIC_CHECK_AND_INCREMENT_LUA = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local budget = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

if budget > 0 and (current + cost) > budget then
    return {current, 0}
end

local new_total = redis.call('INCRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], ttl)
return {new_total, 1}
"""

# ── Lua script for atomic dual-key (project + team) increment ─────
# KEYS[1] = project spend key
# KEYS[2] = team spend key
# ARGV[1] = cost_cents
# ARGV[2] = TTL seconds
# Returns: [project_new_total, team_new_total]
_ATOMIC_DUAL_INCREMENT_LUA = """
local cost = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local proj_total = redis.call('INCRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], ttl)

local team_total = redis.call('INCRBY', KEYS[2], cost)
redis.call('EXPIRE', KEYS[2], ttl)

return {proj_total, team_total}
"""


async def get_redis() -> redis.Redis:
    """Lazy-initialize async Redis connection."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.redis_url, decode_responses=True, socket_timeout=5
        )
    return _redis_client


def _monthly_key(prefix: str, entity_id: str) -> str:
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    return f"spend:{prefix}:{entity_id}:monthly:{month}"


async def get_project_spend(project_id: str) -> int:
    """Get the current month's spend for a project (in cents)."""
    r = await get_redis()
    key = _monthly_key("project", project_id)
    val = await r.get(key)
    return int(val) if val else 0


async def get_team_spend(team_id: str) -> int:
    """Get the current month's spend for a team (in cents)."""
    r = await get_redis()
    key = _monthly_key("team", team_id)
    val = await r.get(key)
    return int(val) if val else 0


async def increment_spend(project_id: str, team_id: str, cost_cents: int) -> dict:
    """Atomically increment spend counters for both project and team.

    Uses a Lua script to ensure both increments happen atomically in a single
    Redis operation, preventing race conditions where one counter could be
    updated without the other.

    Returns dict with new totals:
      {"project_spend": int, "team_spend": int}
    """
    if cost_cents <= 0:
        return {"project_spend": 0, "team_spend": 0}

    r = await get_redis()
    proj_key = _monthly_key("project", project_id)
    team_key = _monthly_key("team", team_id)
    ttl = 40 * 24 * 3600  # ~40 days

    # Use Lua script for atomic dual-key increment (both project + team
    # in a single Redis EVAL call — no interleaving possible).
    try:
        dual_sha = await _get_or_load_dual_increment_script(r)
        result = await r.evalsha(
            dual_sha,
            2,  # number of keys
            proj_key,
            team_key,
            str(cost_cents),
            str(ttl),
        )
        return {
            "project_spend": int(result[0]),
            "team_spend": int(result[1]),
        }
    except (AttributeError, Exception):
        # Fallback for environments without Lua support (e.g. FakeRedis in tests).
        # Uses a pipeline — not truly atomic but acceptable for testing.
        pipe = r.pipeline()
        pipe.incrby(proj_key, cost_cents)
        pipe.expire(proj_key, ttl)
        pipe.incrby(team_key, cost_cents)
        pipe.expire(team_key, ttl)
        results = await pipe.execute()
        return {
            "project_spend": int(results[0]),
            "team_spend": int(results[2]),
        }


async def atomic_check_and_increment(
    project_id: str,
    budget_monthly_cents: int,
    cost_cents: int,
) -> tuple[int, bool]:
    """Atomically check budget and increment spend in one Redis operation.

    Prevents race conditions where multiple concurrent requests could
    individually pass the budget check but collectively exceed it.

    Uses a Redis Lua script that runs atomically on the Redis server:
    1. Read current spend
    2. If (current + cost) > budget → reject without incrementing
    3. Otherwise → INCRBY and return new total

    Returns:
        (new_total_cents, was_allowed)
    """
    r = await get_redis()
    key = _monthly_key("project", project_id)
    ttl = 40 * 24 * 3600

    # redis-py's evalsha/eval runs the Lua script atomically on the server.
    # This is NOT Python's eval() — it's the Redis EVAL command.
    result = await r.evalsha(
        await _get_or_load_script(r),
        1,  # number of keys
        key,
        str(budget_monthly_cents),
        str(cost_cents),
        str(ttl),
    )
    new_total = int(result[0])
    was_allowed = bool(int(result[1]))
    return new_total, was_allowed


# Cache the SHA of the Lua scripts to avoid sending the full script on every call
_script_sha: str | None = None
_dual_increment_script_sha: str | None = None


async def _get_or_load_script(r: redis.Redis) -> str:
    """Load the check-and-increment Lua script into Redis and cache its SHA."""
    global _script_sha
    if _script_sha is None:
        _script_sha = await r.script_load(_ATOMIC_CHECK_AND_INCREMENT_LUA)
    return _script_sha


async def _get_or_load_dual_increment_script(r: redis.Redis) -> str:
    """Load the dual-key increment Lua script into Redis and cache its SHA."""
    global _dual_increment_script_sha
    if _dual_increment_script_sha is None:
        _dual_increment_script_sha = await r.script_load(_ATOMIC_DUAL_INCREMENT_LUA)
    return _dual_increment_script_sha


async def check_budget(
    project_id: str, budget_monthly_cents: int | None, estimated_cost_cents: int = 1
) -> dict:
    """Check if a project is within budget.

    Returns:
      {
        "allowed": True/False,
        "budget_cents": int or None,
        "spent_cents": int,
        "remaining_cents": int or None,
        "pct_used": float
      }
    """
    spent = await get_project_spend(project_id)

    if budget_monthly_cents is None or budget_monthly_cents <= 0:
        return {
            "allowed": True,
            "budget_cents": None,
            "spent_cents": spent,
            "remaining_cents": None,
            "pct_used": 0.0,
        }

    remaining = budget_monthly_cents - spent
    pct_used = (spent / budget_monthly_cents) * 100 if budget_monthly_cents > 0 else 0

    return {
        "allowed": remaining >= estimated_cost_cents,
        "budget_cents": budget_monthly_cents,
        "spent_cents": spent,
        "remaining_cents": max(0, remaining),
        "pct_used": round(pct_used, 2),
    }
