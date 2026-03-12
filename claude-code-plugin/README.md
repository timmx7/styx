# Styx — Claude Code Plugin

The first **MCP-native AI API gateway**, packaged as a Claude Code plugin.

## Installation

```
/plugin install styx@claude-plugin-directory
```

Or: `/plugin > Discover > styx`

## Prerequisites

- Docker and Docker Compose
- A running Styx instance

## Quick Start

```
/styx:setup
```

## Commands

| Command | Description |
|---------|-------------|
| `/styx:setup` | Set up and start the Styx gateway |
| `/styx:status [health\|usage\|providers]` | Check gateway status |

## Agent

| Agent | Description |
|-------|-------------|
| `@styx-ops` | Diagnose issues, optimize costs, manage keys |

## MCP Tools

`list_providers` · `list_models` · `get_usage` · `get_health` · `create_api_key` · `revoke_api_key` · `list_api_keys` · `get_cache_stats` · `route_request`

## Links

- [Repository](https://github.com/styx-hq/styx)
- [Website](https://styxhq.com)
- License: Apache 2.0
