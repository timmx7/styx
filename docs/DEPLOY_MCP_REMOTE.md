# Deploying the Remote MCP Server

The Styx MCP server supports **Streamable HTTP** transport for remote access from claude.ai, Claude Desktop, and Claude Code — without local installation.

**Target URL:** `https://mcp.styxhq.com/mcp`

## Docker Setup

The `styx-mcp-remote` service is defined in `docker-compose.yml` and starts automatically:

```bash
docker compose up -d styx-mcp-remote
```

It listens on port **8081** with Streamable HTTP transport.

## DNS Configuration (Cloudflare)

1. Go to **Cloudflare > styxhq.com > DNS**
2. Add an **A record**: `mcp` → `[server IP]` (proxied)
3. SSL/TLS: **Full (strict)**

## Reverse Proxy

### Option A — Nginx (if using the existing nginx in docker-compose)

Add a server block to `nginx/nginx.conf`:

```nginx
server {
    listen 443 ssl;
    server_name mcp.styxhq.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        proxy_pass http://styx-mcp-remote:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for Streamable HTTP / SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Option B — Cloudflare Tunnel (zero-config)

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared  # macOS
# or: apt install cloudflared                    # Linux

# Create tunnel
cloudflared tunnel create styx-mcp
cloudflared tunnel route dns styx-mcp mcp.styxhq.com

# Run tunnel
cloudflared tunnel --url http://localhost:8081 run styx-mcp
```

## Verify

```bash
# Health check
curl https://mcp.styxhq.com/health

# MCP initialize
curl -X POST https://mcp.styxhq.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

## CORS

The MCP server accepts requests from:
- `https://claude.ai`
- `https://claude.com`
- `https://app.styxhq.com`
- `http://localhost:3000`

These are configured in `server.py` in the `create_http_app()` function.

## Client Configuration

### Claude.ai / Claude Desktop

Settings > Connectors > Add custom connector > URL: `https://mcp.styxhq.com/mcp`

### Claude Code

```bash
claude mcp add --transport http styx https://mcp.styxhq.com/mcp
```

### Cursor / Windsurf

Use the stdio transport with `npx styx-mcp` for local, or configure the HTTP URL if your client supports it.
