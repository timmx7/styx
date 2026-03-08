# Styx MCP Server

> Connect any MCP-compatible AI tool to every model provider through one gateway.

The Styx MCP server lets Claude Desktop, Cursor, Windsurf, and any MCP client interact with the Styx AI gateway natively. List models, switch providers, send requests, and manage your account — all through natural language.

## Quick Start

### Option 1: npx (recommended)

```bash
npx styx-mcp --api-key $STYX_API_KEY
```

### Option 2: pip

```bash
pip install styx-gateway
styx-mcp --api-key $STYX_API_KEY
```

### Option 3: From source

```bash
cd styx-mcp-server
pip install -r requirements.txt
python server.py
```

## Connect to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "styx": {
      "command": "npx",
      "args": ["styx-mcp"],
      "env": {
        "STYX_API_KEY": "sk-styx-xxx",
        "STYX_TOKEN": "your-jwt-token"
      }
    }
  }
}
```

## Connect to Claude Code

Add to `.mcp.json` in your project or `~/.claude/mcp.json` globally:

```json
{
  "mcpServers": {
    "styx": {
      "command": "python",
      "args": ["/path/to/styx-mcp-server/server.py"],
      "env": {
        "STYX_API_URL": "http://localhost:8000",
        "STYX_PROXY_URL": "http://localhost:8080",
        "STYX_API_KEY": "sk-styx-xxx",
        "STYX_TOKEN": "your-jwt-token"
      }
    }
  }
}
```

## Connect to Cursor / Windsurf

Both support MCP servers. Add Styx in your editor's MCP settings using the same `npx styx-mcp` command.

## Available Tools

| Tool | Description |
|------|-------------|
| `styx_send_request` | Send chat completions through the Styx gateway |
| `styx_list_models` | List all available AI models with pricing |
| `styx_switch_model` | Set a default model for the session |
| `styx_list_projects` | List all projects for the authenticated user |
| `styx_create_project` | Create a new project |
| `styx_list_api_keys` | List API keys (prefixes only) |
| `styx_create_api_key` | Create a new API key (shown once) |
| `styx_check_usage` | Get usage statistics and per-provider breakdown |
| `styx_manage_providers` | Manage BYOK provider keys (list/add/remove) |

## Usage Examples

### Natural language (via Claude)

```
"What models are available on Styx?"
  -> Claude calls styx_list_models

"Switch to GPT-4o"
  -> Claude calls styx_switch_model(model="gpt-4o")

"Summarize this document"
  -> Claude calls styx_send_request (uses GPT-4o automatically)

"Show my usage for the last 7 days"
  -> Claude calls styx_check_usage(days=7)
```

### Direct tool calls

```
styx_list_models
styx_switch_model model="gpt-4o"
styx_send_request messages=[{"role":"user","content":"Hello!"}]
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STYX_API_URL` | No | `http://localhost:8000` | Backend API URL |
| `STYX_PROXY_URL` | No | `http://localhost:8080` | Go router proxy URL |
| `STYX_API_KEY` | For AI requests | — | API key for proxy requests |
| `STYX_TOKEN` | For management | — | JWT auth token |

## Transport Modes

```bash
# stdio (default - for Claude Desktop, Claude Code, Cursor)
python server.py

# SSE (for web-based clients, port 8090)
python server.py --transport sse
```

## Docker

```bash
# Start with MCP server
docker compose --profile mcp up

# MCP server listens on port 8090 (SSE transport)
```

## Running Tests

```bash
cd styx-mcp-server
pip install -r requirements.txt pytest pytest-asyncio
pytest test_server.py -v
```
