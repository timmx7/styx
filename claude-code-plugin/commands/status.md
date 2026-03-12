---
description: Check Styx gateway health, usage stats, and provider status
argument-hint: [health|usage|providers]
allowed-tools: [Bash, Read, mcp__styx-gateway__get_health, mcp__styx-gateway__get_usage, mcp__styx-gateway__list_providers]
---

# /styx:status

Check the status of the running Styx gateway.

## Behavior

Based on the argument:

- **health** (default): Call `get_health` via MCP or `curl http://localhost:8080/health` to show gateway uptime, connected providers, and overall status.
- **usage**: Call `get_usage` via MCP to show recent token consumption, request counts, costs, and cache hit rates.
- **providers**: Call `list_providers` via MCP to list all configured AI providers, their models, and connectivity status.

If no argument is given, default to `health`.

Present results in a clean, readable format. Highlight any providers that are down or any concerning usage patterns.
