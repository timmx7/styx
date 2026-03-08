# MCP Server Guide

The Styx MCP (Model Context Protocol) server lets you interact with Styx from any MCP-compatible client: Claude Code, Cursor, Windsurf, and others.

## What is MCP?

MCP is a protocol that lets AI assistants call external tools. The Styx MCP server exposes 7 tools for managing your Styx gateway directly from your IDE.

## Installation

### Option 1: Local Python

```bash
cd styx-mcp-server
pip install -r requirements.txt
python server.py  # stdio transport (default)
```

### Option 2: Docker

```bash
docker compose --profile mcp up styx-mcp
# Runs on port 8090 with SSE transport
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STYX_API_URL` | No | `http://localhost:8000` | Backend API URL |
| `STYX_PROXY_URL` | No | `http://localhost:8080` | Go router proxy URL |
| `STYX_API_KEY` | For proxy tools | -- | Styx API key (for `styx_send_request`) |
| `STYX_TOKEN` | For mgmt tools | -- | JWT auth token (for projects, keys, usage) |

### Claude Code Setup

Add to `~/.claude/mcp.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "styx": {
      "command": "python",
      "args": ["/absolute/path/to/styx-mcp-server/server.py"],
      "env": {
        "STYX_API_URL": "http://localhost:8000",
        "STYX_PROXY_URL": "http://localhost:8080",
        "STYX_API_KEY": "sk_styx_your_key",
        "STYX_TOKEN": "your-jwt-token"
      }
    }
  }
}
```

### Cursor / Windsurf

These editors support MCP servers via their settings. Point to the server.py script with the same environment variables.

## Available Tools

### styx_send_request

Send a chat completion through the Styx AI gateway.

**Parameters:**
- `model` (string, required): Model name (e.g., "gpt-4o", "claude-sonnet-4-20250514")
- `messages` (array, required): Message objects with `role` and `content`
- `max_tokens` (int, default 4096): Maximum response tokens
- `temperature` (float, default 0.7): Sampling temperature 0.0--2.0

**Example prompt:** "Use Styx to ask gpt-4o to explain REST APIs in one paragraph."

### styx_list_projects

List all projects for the authenticated user.

**Returns:** Project names, IDs, team info, budget status.

### styx_create_project

Create a new project.

**Parameters:**
- `name` (string, required): Project name
- `team_id` (string, required): Team ID
- `budget_monthly_cents` (int, default 0): Monthly budget in cents

### styx_list_api_keys

List all API keys (prefix only, never the full key).

**Returns:** Key names, prefixes, status, associated project.

### styx_create_api_key

Create a new API key. The full key is shown ONCE.

**Parameters:**
- `project_id` (string, required): Project ID
- `name` (string, default "mcp-key"): Key name

### styx_check_usage

Get usage statistics for your account.

**Parameters:**
- `days` (int, default 30): Lookback period

**Returns:** Total requests, tokens, cost, cache hit rate, latency, fallback rate, per-provider breakdown.

### styx_manage_providers

Manage BYOK provider keys for a project (Charon mode).

**Parameters:**
- `project_id` (string, required): Project ID
- `action` (string, default "list"): "list", "add", or "remove"
- `provider` (string): Provider name (required for add/remove)
- `api_key` (string): API key (required for "add")

## Transports

| Transport | Use Case | Command |
|-----------|----------|---------|
| **stdio** (default) | Claude Code, Cursor, local IDEs | `python server.py` |
| **SSE** | Web clients, Docker | `python server.py --transport sse` |

SSE transport listens on `0.0.0.0:8090`.

## Troubleshooting

**"STYX_TOKEN not set"**: Get your JWT token by logging in via the API or dashboard. The token from `/api/auth/login` works.

**"STYX_API_KEY not set"**: Create an API key via the dashboard or `styx_create_api_key` tool (requires STYX_TOKEN first).

**Connection refused**: Ensure the backend (port 8000) and router (port 8080) are running. Use `docker compose up` to start all services.
