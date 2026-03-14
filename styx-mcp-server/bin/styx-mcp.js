#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const SERVER_PY = path.join(__dirname, "..", "server.py");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`styx-mcp-server — MCP server for the Styx AI gateway

Usage:
  npx styx-mcp-server               stdio transport (default — for Claude Code, Cursor, Windsurf)
  npx styx-mcp-server --sse         SSE transport on port 8090
  npx styx-mcp-server --http        Streamable HTTP on port 8081 (for remote access)

Environment variables:
  STYX_API_URL    Backend API URL   (default: http://localhost:8000)
  STYX_PROXY_URL  Proxy URL         (default: http://localhost:8080)
  STYX_API_KEY    API key for proxy requests (required for styx_send_request)
  STYX_TOKEN      Auth token for management tools (required for project/key tools)
  MCP_TRANSPORT   Transport mode: stdio, sse, http (default: stdio)
  MCP_PORT        Port for HTTP transport (default: 8081)

MCP tools:
  styx_send_request      Route AI requests through the gateway
  styx_list_models       List available models across all providers
  styx_switch_model      Set a default model for subsequent requests
  styx_list_projects     List your projects
  styx_create_project    Create a new project
  styx_list_api_keys     List API keys
  styx_create_api_key    Create an API key
  styx_check_usage       View usage and cost statistics
  styx_manage_providers  Manage BYOK provider keys

Requirements:
  Python 3.10+ with mcp[cli], httpx, pydantic installed
  pip install mcp[cli] httpx pydantic

Docs: https://github.com/timmx7/styx`);
  process.exit(0);
}

// python3 on Unix/Mac, python on Windows (which aliases to python3 in modern setups)
const pythonCmd = process.platform === "win32" ? "python" : "python3";

const pythonArgs = [SERVER_PY];
if (process.argv.includes("--http")) {
  pythonArgs.push("--transport", "http");
} else if (process.argv.includes("--sse")) {
  pythonArgs.push("--transport", "sse");
}

const child = spawn(pythonCmd, pythonArgs, {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (err) => {
  if (err.code === "ENOENT") {
    console.error("[styx-mcp-server] Python 3 not found. Please install Python 3.10+");
    console.error("  https://python.org/downloads/");
    console.error(
      "  Then install dependencies: pip install mcp[cli] httpx pydantic",
    );
  } else {
    console.error(`[styx-mcp-server] Failed to start: ${err.message}`);
  }
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
