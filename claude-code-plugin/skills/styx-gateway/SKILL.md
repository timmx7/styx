---
name: styx-gateway
description: Use when managing AI API keys, routing LLM requests across providers, checking gateway health, viewing usage analytics, or configuring rate limits and caching for AI model traffic.
version: 1.0.0
---

# Styx — MCP-Native AI API Gateway

You have access to a running Styx gateway that proxies and manages LLM API traffic across multiple providers.

## What Styx Does

Styx is a unified gateway that sits between your application and AI providers (OpenAI, Anthropic, Google, Mistral, etc.). It provides:

- **Unified endpoint**: Send requests to `http://localhost:8080/v1/chat/completions` using OpenAI-compatible format
- **Key management**: Store and rotate API keys for all providers in one place
- **Rate limiting**: Per-key and per-model rate limits to control costs
- **Caching**: Semantic caching to reduce duplicate API calls
- **Analytics**: Real-time usage tracking, cost monitoring, and latency metrics
- **MCP server**: Native Model Context Protocol server at `/mcp`

## Available MCP Tools

- `list_providers` — List all configured AI providers and their status
- `list_models` — List available models across all providers
- `get_usage` — Get usage statistics for a time range
- `get_health` — Check gateway health and provider connectivity
- `create_api_key` — Generate a new API key with optional rate limits
- `revoke_api_key` — Revoke an existing API key
- `list_api_keys` — List all API keys and their status
- `get_cache_stats` — View cache hit rates and savings
- `route_request` — Send a chat completion through the gateway

## Common Workflows

### Check gateway status
Use `get_health` to verify Styx is running and all providers are reachable.

### View costs and usage
Use `get_usage` with a date range to see token consumption and costs by provider and model.

### Create a scoped API key
Use `create_api_key` with rate limit parameters to generate keys for specific applications or team members.

## Setup

If Styx is not yet running:

```bash
git clone https://github.com/styx-hq/styx.git
cd styx && ./setup.sh && docker compose up -d
```

Gateway: http://localhost:8080 | Dashboard: http://localhost:3000
