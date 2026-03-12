---
description: Set up and start the Styx AI API gateway locally
argument-hint: [--skip-auth]
allowed-tools: [Bash, Read, Write, Glob]
---

# /styx:setup

Help the user set up and start the Styx AI API gateway.

## Steps

1. Check if Docker and Docker Compose are installed. If not, inform the user.
2. Check if Styx is already cloned locally. Look for a `styx` directory or a `docker-compose.yml` with styx references.
3. If not present, clone the repo:
   ```bash
   git clone https://github.com/styx-hq/styx.git
   cd styx
   ```
4. Run the setup wizard:
   ```bash
   ./setup.sh
   ```
5. Start the services:
   ```bash
   docker compose up -d
   ```
6. Verify health:
   ```bash
   curl -s http://localhost:8080/health | jq .
   ```
7. Report the status to the user:
   - Gateway URL: http://localhost:8080
   - Dashboard URL: http://localhost:3000
   - MCP endpoint: http://localhost:8080/mcp

If the user passes `--skip-auth`, remind them to set `SKIP_AUTH=true` in the environment for development mode.
