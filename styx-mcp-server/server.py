#!/usr/bin/env python3
"""Styx MCP Server — connect any MCP client to the Styx AI gateway.

This server exposes Styx operations as MCP tools so that Claude Code,
Cursor, Windsurf, or any MCP-compatible client can interact with Styx
natively.

Configuration (environment variables):
    STYX_API_URL   — Backend URL (default: http://localhost:8000)
    STYX_API_KEY   — Your Styx API key (required for proxy tools)
    STYX_TOKEN     — Your Styx auth token (required for management tools)
    MCP_TRANSPORT  — Transport mode: "stdio", "sse", or "http" (default: stdio)
    MCP_PORT       — Port for HTTP/SSE transport (default: 8081 for HTTP, 8090 for SSE)

Run:
    python server.py                     # stdio transport (default)
    python server.py --transport sse     # SSE transport on port 8090
    python server.py --transport http    # Streamable HTTP on port 8081
    MCP_TRANSPORT=http python server.py  # Same via env var
"""

import contextvars
import json
import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from starlette.requests import Request
from starlette.responses import JSONResponse

# Session state — persists across tool calls within one MCP session
_default_model: contextvars.ContextVar[str] = contextvars.ContextVar("default_model", default="")

# ═══════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════

STYX_API_URL = os.getenv("STYX_API_URL", "http://localhost:8000")
STYX_PROXY_URL = os.getenv("STYX_PROXY_URL", "http://localhost:8080")
STYX_API_KEY = os.getenv("STYX_API_KEY", "")
STYX_TOKEN = os.getenv("STYX_TOKEN", "")

mcp = FastMCP(
    "Styx AI Gateway",
    instructions="MCP server for the Styx AI gateway — route requests to any AI provider through a single interface.",
    host="0.0.0.0",
    port=8090,
)


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def _auth_headers() -> dict[str, str]:
    """Build authentication headers for Styx management API."""
    if not STYX_TOKEN:
        raise ValueError(
            "STYX_TOKEN not set. Get your token from the Styx dashboard "
            "(Settings → API Tokens) and set STYX_TOKEN environment variable."
        )
    return {"Authorization": f"Bearer {STYX_TOKEN}"}


def _api_key_headers() -> dict[str, str]:
    """Build headers for Styx proxy requests."""
    if not STYX_API_KEY:
        raise ValueError(
            "STYX_API_KEY not set. Create an API key in the Styx dashboard "
            "(API Keys page) and set STYX_API_KEY environment variable."
        )
    return {"Authorization": f"Bearer {STYX_API_KEY}"}


async def _api_request(
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
    params: dict | None = None,
    use_proxy: bool = False,
) -> dict[str, Any]:
    """Make an authenticated request to the Styx API."""
    base_url = STYX_PROXY_URL if use_proxy else STYX_API_URL
    headers = _api_key_headers() if use_proxy else _auth_headers()

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.request(
            method,
            f"{base_url}{path}",
            headers=headers,
            json=json_body,
            params=params,
        )

        if response.status_code >= 400:
            try:
                error = response.json()
            except Exception:
                error = {"detail": response.text}
            return {
                "error": True,
                "status_code": response.status_code,
                "detail": error.get("detail", str(error)),
            }

        if response.status_code == 204:
            return {"success": True}

        return response.json()


# ═══════════════════════════════════════════════════════════════
# Tool 1: Send AI Request
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="Route Chat Completion",
        readOnlyHint=False,
        destructiveHint=False,
        idempotentHint=False,
        openWorldHint=True,
    )
)
async def styx_send_request(
    messages: list[dict[str, str]],
    model: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> str:
    """Send a chat completion request through the Styx AI gateway.

    Styx automatically routes to the optimal provider (OpenAI, Anthropic,
    Google, Mistral) based on the model name and configured routing rules.

    Args:
        messages: List of message objects with "role" and "content" keys
        model: Model name (e.g., "gpt-4o", "claude-sonnet-4-20250514", "gemini-1.5-pro").
               If empty, uses the default model set by styx_switch_model.
        max_tokens: Maximum tokens in the response (default: 4096)
        temperature: Sampling temperature 0.0–2.0 (default: 0.7)

    Returns:
        The AI model's response text, or an error message.
    """
    effective_model = model or _default_model.get()
    if not effective_model:
        return (
            "No model specified and no default model set. "
            "Either pass a model name (e.g., 'gpt-4o') or use styx_switch_model first. "
            "Run styx_list_models to see available models."
        )

    result = await _api_request(
        "POST",
        "/v1/chat/completions",
        json_body={
            "model": effective_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        },
        use_proxy=True,
    )

    if isinstance(result, dict) and result.get("error"):
        return f"Error ({result['status_code']}): {result['detail']}"

    # Extract response content from OpenAI-compatible format
    try:
        choices = result.get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", "")
            usage = result.get("usage", {})
            provider = result.get("x-styx-provider", "unknown")
            return (
                f"{content}\n\n"
                f"---\n"
                f"Provider: {provider} | "
                f"Tokens: {usage.get('prompt_tokens', '?')}/{usage.get('completion_tokens', '?')} | "
                f"Model: {result.get('model', effective_model)}"
            )
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Response parsing error: {e}\nRaw: {json.dumps(result)[:500]}"


# ═══════════════════════════════════════════════════════════════
# Tool 2: List Projects
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="List Projects",
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )
)
async def styx_list_projects() -> str:
    """List all projects for the authenticated user.

    Returns project names, IDs, team info, and budget status.
    """
    result = await _api_request("GET", "/api/projects")

    if isinstance(result, dict) and result.get("error"):
        return f"Error: {result['detail']}"

    if not isinstance(result, list) or len(result) == 0:
        return "No projects found. Create one with styx_create_project."

    lines = [f"Found {len(result)} project(s):\n"]
    for p in result:
        budget = p.get("budget_monthly_cents") or 0
        spent = p.get("spent_cents") or 0
        budget_str = f"${budget/100:.0f}" if budget > 0 else "No budget"
        spent_str = f"${spent/100:.2f}" if spent > 0 else "$0"
        lines.append(
            f"  - {p['name']} (ID: {p['id']})\n"
            f"    Budget: {budget_str} | Spent: {spent_str}"
        )

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Tool 3: Create Project
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="Create Project",
        readOnlyHint=False,
        destructiveHint=False,
        idempotentHint=False,
        openWorldHint=False,
    )
)
async def styx_create_project(
    name: str,
    team_id: str,
    budget_monthly_cents: int = 0,
) -> str:
    """Create a new project in your Styx account.

    Args:
        name: Project name (e.g., "Production API", "Dev Environment")
        team_id: Team ID to create the project under
        budget_monthly_cents: Monthly budget in cents (0 = no budget limit)

    Returns:
        Project ID and creation confirmation.
    """
    result = await _api_request(
        "POST",
        "/api/projects",
        json_body={
            "name": name,
            "team_id": team_id,
            "budget_monthly_cents": budget_monthly_cents,
        },
    )

    if isinstance(result, dict) and result.get("error"):
        return f"Error: {result['detail']}"

    return (
        f"Project created!\n"
        f"  Name: {result.get('name')}\n"
        f"  ID: {result.get('id')}\n"
        f"  Budget: ${budget_monthly_cents/100:.0f}/month"
    )


# ═══════════════════════════════════════════════════════════════
# Tool 4: List API Keys
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="List API Keys",
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )
)
async def styx_list_api_keys() -> str:
    """List all API keys for the authenticated user.

    Returns key prefixes (not full keys), names, and status.
    """
    result = await _api_request("GET", "/api/keys")

    if isinstance(result, dict) and result.get("error"):
        return f"Error: {result['detail']}"

    if not isinstance(result, list) or len(result) == 0:
        return "No API keys found. Create one with styx_create_api_key."

    lines = [f"Found {len(result)} API key(s):\n"]
    for k in result:
        status = "active" if k.get("is_active", True) else "revoked"
        lines.append(
            f"  - {k.get('name', 'unnamed')} ({status})\n"
            f"    Prefix: {k.get('key_prefix', '???')}...\n"
            f"    Project: {k.get('project_id', 'N/A')}"
        )

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Tool 5: Create API Key
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="Create API Key",
        readOnlyHint=False,
        destructiveHint=False,
        idempotentHint=False,
        openWorldHint=False,
    )
)
async def styx_create_api_key(
    project_id: str,
    name: str = "mcp-key",
) -> str:
    """Create a new API key for a project.

    The full key is shown ONCE — save it immediately. After this,
    only the prefix is visible.

    Args:
        project_id: Project ID to create the key for
        name: Human-readable key name (default: "mcp-key")

    Returns:
        The full API key (shown once only).
    """
    result = await _api_request(
        "POST",
        "/api/keys",
        json_body={
            "project_id": project_id,
            "name": name,
        },
    )

    if isinstance(result, dict) and result.get("error"):
        return f"Error: {result['detail']}"

    key = result.get("key", "")
    prefix = key[:12] + "..." if len(key) > 12 else "***"
    return (
        f"API key created!\n"
        f"  Name: {result.get('name')}\n"
        f"  Key prefix: {prefix}\n"
        f"  *** The full key was returned by the API. Retrieve it from your dashboard. ***\n\n"
        f"Set it with: STYX_API_KEY=<your-full-key>"
    )


# ═══════════════════════════════════════════════════════════════
# Tool 6: Check Usage
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="Get Usage Statistics",
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )
)
async def styx_check_usage(
    days: int = 30,
) -> str:
    """Get usage statistics for your Styx account.

    Args:
        days: Number of days to look back (default: 30)

    Returns:
        Request count, tokens used, cost, and per-provider breakdown.
    """
    overview = await _api_request(
        "GET",
        "/api/analytics/overview",
        params={"days": days},
    )

    if isinstance(overview, dict) and overview.get("error"):
        return f"Error: {overview['detail']}"

    # Also get by-provider breakdown
    by_provider = await _api_request(
        "GET",
        "/api/analytics/by-provider",
        params={"days": days},
    )

    lines = [f"Usage (last {days} days):\n"]
    lines.append(f"  Total requests: {overview.get('total_requests', 0):,}")
    lines.append(f"  Total tokens: {overview.get('total_tokens', 0):,}")
    lines.append(f"  Total cost: ${overview.get('total_cost_cents', 0)/100:.2f}")
    lines.append(f"  Cache hit rate: {overview.get('cache_hit_rate', 0):.1%}")
    lines.append(f"  Avg latency: {overview.get('avg_latency_ms', 0):.0f}ms")
    lines.append(f"  Fallback rate: {overview.get('fallback_rate', 0):.1%}")

    if isinstance(by_provider, list) and len(by_provider) > 0:
        lines.append(f"\n  By provider:")
        for p in by_provider:
            lines.append(
                f"    {p.get('provider', 'unknown')}: {p.get('request_count', 0):,} requests, "
                f"${p.get('total_cost_cents', 0)/100:.2f}"
            )

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Tool 7: Manage Providers (BYOK keys)
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="Manage Provider Keys",
        readOnlyHint=False,
        destructiveHint=True,
        idempotentHint=False,
        openWorldHint=False,
    )
)
async def styx_manage_providers(
    project_id: str,
    action: str = "list",
    provider: str = "",
    api_key: str = "",
) -> str:
    """Manage BYOK (Bring Your Own Key) provider keys for a project.

    In Charon mode, you bring your own API keys for each AI provider.
    This tool lets you add, remove, or list configured provider keys.

    Args:
        project_id: Project ID to manage
        action: "list", "add", or "remove"
        provider: Provider name (openai, anthropic, google, mistral) — required for add/remove
        api_key: API key to add — required for "add" action

    Returns:
        Confirmation of the action taken, or list of configured providers.
    """
    if action == "list":
        result = await _api_request(
            "GET",
            f"/api/provider-keys/{project_id}",
        )
        if isinstance(result, dict) and result.get("error"):
            return f"Error: {result['detail']}"
        if not isinstance(result, list) or len(result) == 0:
            return "No BYOK provider keys configured for this project."
        lines = ["Configured providers:"]
        for pk in result:
            lines.append(f"  - {pk.get('provider', '?')} (key: {pk.get('key_preview', '***')})")
        return "\n".join(lines)

    elif action == "add":
        if not provider or not api_key:
            return "Error: 'provider' and 'api_key' are required for 'add' action."
        result = await _api_request(
            "POST",
            f"/api/provider-keys/{project_id}",
            json_body={"provider": provider, "api_key": api_key},
        )
        if isinstance(result, dict) and result.get("error"):
            detail = str(result['detail'])
            # Never echo the api_key back in error messages
            if api_key and api_key in detail:
                detail = detail.replace(api_key, "***")
            return f"Error: {detail}"
        return f"Provider key added: {provider} for project {project_id}"

    elif action == "remove":
        if not provider:
            return "Error: 'provider' is required for 'remove' action."
        result = await _api_request(
            "DELETE",
            f"/api/provider-keys/{project_id}/{provider}",
        )
        if isinstance(result, dict) and result.get("error"):
            return f"Error: {result['detail']}"
        return f"Provider key removed: {provider} from project {project_id}"

    else:
        return f"Unknown action '{action}'. Use 'list', 'add', or 'remove'."


# ═══════════════════════════════════════════════════════════════
# Tool 8: List Available Models
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="List Available Models",
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )
)
async def styx_list_models() -> str:
    """List all AI models available through the Styx gateway.

    Shows model names, providers, and pricing. Use this to discover
    which models you can use with styx_send_request or styx_switch_model.

    Returns:
        Formatted list of models with pricing information.
    """
    result = await _api_request("GET", "/api/pricing/models")

    if isinstance(result, dict) and result.get("error"):
        # Fallback: return hardcoded model list if pricing endpoint unavailable
        return (
            "Available models (pricing endpoint unavailable):\n\n"
            "  OpenAI:     gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o1-mini\n"
            "  Anthropic:  claude-sonnet-4-20250514, claude-3-5-haiku-20241022, claude-3-opus-20240229\n"
            "  Google:     gemini-1.5-pro, gemini-1.5-flash\n"
            "  Mistral:    mistral-large-latest\n\n"
            f"Current default model: {_default_model.get() or '(none set)'}\n"
            "Use styx_switch_model to set a default."
        )

    if not isinstance(result, list) or len(result) == 0:
        return "No models found in the pricing catalog."

    lines = [f"Available models ({len(result)}):\n"]

    # Group by provider
    by_provider: dict[str, list] = {}
    for m in result:
        provider = m.get("provider", "unknown")
        by_provider.setdefault(provider, []).append(m)

    for provider, models in sorted(by_provider.items()):
        lines.append(f"  {provider.upper()}:")
        for m in models:
            name = m.get("model", m.get("display_name", "?"))
            display = m.get("display_name", name)
            input_price = m.get("input_price_per_1k_client", 0)
            output_price = m.get("output_price_per_1k_client", 0)
            lines.append(
                f"    {name}"
                + (f" ({display})" if display != name else "")
                + f"  — ${input_price:.4f}/${ output_price:.4f} per 1K tokens (in/out)"
            )
        lines.append("")

    lines.append(f"Current default model: {_default_model.get() or '(none set)'}")
    lines.append("Use styx_switch_model to set a default.")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Tool 9: Switch Default Model
# ═══════════════════════════════════════════════════════════════

@mcp.tool(
    annotations=ToolAnnotations(
        title="Switch Default Model",
        readOnlyHint=False,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )
)
async def styx_switch_model(
    model: str,
) -> str:
    """Set the default model for subsequent styx_send_request calls.

    After switching, you can call styx_send_request without specifying
    a model — it will use this one automatically.

    Args:
        model: Model name to use as default (e.g., "gpt-4o", "claude-sonnet-4-20250514")

    Returns:
        Confirmation of the model switch.
    """
    new_model = model.strip()

    if not new_model:
        return "Error: model name cannot be empty. Use styx_list_models to see available models."

    previous = _default_model.get()
    _default_model.set(new_model)

    msg = f"Default model switched to: {new_model}"
    if previous:
        msg += f" (was: {previous})"
    msg += "\n\nAll subsequent styx_send_request calls will use this model unless overridden."
    return msg


# ═══════════════════════════════════════════════════════════════
# Streamable HTTP app factory (for CORS + remote access)
# ═══════════════════════════════════════════════════════════════

def create_http_app():
    """Create a CORS-wrapped MCP app for remote access.

    Wraps the SDK's streamable_http_app() directly with CORSMiddleware.
    CORSMiddleware is pure ASGI middleware — it passes through lifespan
    events unchanged, so the SDK's session manager initializes correctly.
    """
    from starlette.middleware.cors import CORSMiddleware

    mcp_app = mcp.streamable_http_app()

    return CORSMiddleware(
        mcp_app,
        allow_origins=[
            "https://claude.ai",
            "https://claude.com",
            "https://app.styxhq.com",
            "http://localhost:3000",
        ],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Mcp-Session-Id"],
        expose_headers=["Mcp-Session-Id"],
    )


# ═══════════════════════════════════════════════════════════════
# Entry point
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys

    transport = os.getenv("MCP_TRANSPORT", "stdio")
    if "--transport" in sys.argv:
        idx = sys.argv.index("--transport")
        if idx + 1 < len(sys.argv):
            transport = sys.argv[idx + 1]

    if transport == "http":
        import uvicorn

        port = int(os.getenv("MCP_PORT", "8081"))
        print(f"Starting Styx MCP server (streamable-http) on 0.0.0.0:{port}/mcp")
        uvicorn.run(create_http_app(), host="0.0.0.0", port=port)
    elif transport == "sse":
        mcp.run(transport="sse")
    else:
        mcp.run(transport="stdio")
