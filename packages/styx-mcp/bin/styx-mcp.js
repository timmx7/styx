#!/usr/bin/env node

/**
 * styx-mcp — launcher for the Styx MCP server.
 *
 * Finds the bundled Python server and starts it with the correct
 * environment variables. Falls back to a helpful error if Python
 * or the required packages are not installed.
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Parse CLI args
const args = process.argv.slice(2);
let apiKey = process.env.STYX_API_KEY || "";
let token = process.env.STYX_TOKEN || "";
let transport = "stdio";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--api-key" && args[i + 1]) {
    apiKey = args[++i];
  } else if (args[i] === "--token" && args[i + 1]) {
    token = args[++i];
  } else if (args[i] === "--transport" && args[i + 1]) {
    transport = args[++i];
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Styx MCP Server — connect any AI tool to every model provider.

Usage:
  npx styx-mcp --api-key <key> [--token <jwt>] [--transport stdio|sse]

Options:
  --api-key   Styx API key (or set STYX_API_KEY env var)
  --token     JWT auth token for management operations (or set STYX_TOKEN)
  --transport Transport mode: stdio (default) or sse (port 8090)
  --help      Show this help

Examples:
  npx styx-mcp --api-key sk-styx-xxx
  STYX_API_KEY=sk-styx-xxx npx styx-mcp

More info: https://docs.styx.sh/docs/mcp-server
`);
    process.exit(0);
  }
}

if (!apiKey) {
  console.error("Error: STYX_API_KEY is required.");
  console.error("  npx styx-mcp --api-key sk-styx-xxx");
  console.error("  or set the STYX_API_KEY environment variable.");
  process.exit(1);
}

// Locate server.py
const serverPath = path.join(__dirname, "..", "server.py");
if (!fs.existsSync(serverPath)) {
  console.error("Error: server.py not found at", serverPath);
  process.exit(1);
}

// Build env
const env = {
  ...process.env,
  STYX_API_KEY: apiKey,
};
if (token) env.STYX_TOKEN = token;

// Launch Python server
const child = spawn("python3", [serverPath, "--transport", transport], {
  env,
  stdio: "inherit",
});

child.on("error", (err) => {
  if (err.code === "ENOENT") {
    console.error("Error: Python 3 is required but not found.");
    console.error("Install Python 3.10+ and try again.");
    console.error("  pip install -r requirements.txt");
  } else {
    console.error("Error starting server:", err.message);
  }
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
