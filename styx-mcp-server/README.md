# styx-mcp-server

MCP server for [Styx](https://github.com/timmx7/styx) — the intelligent AI gateway that routes requests across OpenAI, Anthropic, Google, and Mistral from a single endpoint.

Connect Claude Code, Cursor, Windsurf, or any MCP-compatible client to your self-hosted Styx instance.

## Quick start

```bash
# Add to Claude Code
claude mcp add styx -- npx styx-mcp-server

# Or run directly
npx styx-mcp-server
```

## Requirements

- Node.js 18+
- Python 3.10+ with dependencies:

```bash
pip install mcp[cli] httpx pydantic
```

## Configuration

Set environment variables before starting:

| Variable | Default | Description |
|---|---|---|
| `STYX_API_URL` | `http://localhost:8000` | Styx backend URL |
| `STYX_PROXY_URL` | `http://localhost:8080` | Styx proxy URL |
| `STYX_API_KEY` | — | API key (for `styx_send_request`) |
| `STYX_TOKEN` | — | Auth token (for project/key management) |

## Claude Code config

Add to `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "styx": {
      "command": "npx",
      "args": ["styx-mcp-server"],
      "env": {
        "STYX_API_URL": "http://localhost:8000",
        "STYX_PROXY_URL": "http://localhost:8080",
        "STYX_API_KEY": "sk-styx-...",
        "STYX_TOKEN": "your-token"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `styx_send_request` | Route AI requests through the gateway |
| `styx_list_models` | List all available models with pricing |
| `styx_switch_model` | Set a default model |
| `styx_list_projects` | List your projects |
| `styx_create_project` | Create a new project |
| `styx_list_api_keys` | List API keys |
| `styx_create_api_key` | Create an API key |
| `styx_check_usage` | View usage and cost statistics |
| `styx_manage_providers` | Manage BYOK provider keys |

## SSE transport

```bash
npx styx-mcp-server --sse   # starts on port 8090
```

## License

Apache-2.0
