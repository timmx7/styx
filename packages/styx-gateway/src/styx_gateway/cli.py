"""CLI entry point for the Styx MCP server."""

import argparse
import os
import sys


def main() -> None:
    """Launch the Styx MCP server."""
    parser = argparse.ArgumentParser(
        description="Styx MCP Server — connect any AI tool to every model provider.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("STYX_API_KEY", ""),
        help="Styx API key (or set STYX_API_KEY env var)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("STYX_TOKEN", ""),
        help="JWT auth token for management operations (or set STYX_TOKEN)",
    )
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse"],
        default="stdio",
        help="Transport mode (default: stdio)",
    )
    args = parser.parse_args()

    if not args.api_key:
        print("Error: STYX_API_KEY is required.", file=sys.stderr)
        print("  styx-mcp --api-key sk-styx-xxx", file=sys.stderr)
        print("  or set the STYX_API_KEY environment variable.", file=sys.stderr)
        sys.exit(1)

    # Set env vars for the server module
    os.environ["STYX_API_KEY"] = args.api_key
    if args.token:
        os.environ["STYX_TOKEN"] = args.token

    # Import and run the server
    from styx_gateway import server  # noqa: F401

    if args.transport == "sse":
        server.mcp.run(transport="sse")
    else:
        server.mcp.run()


if __name__ == "__main__":
    main()
