#!/bin/bash
# ═══════════════════════════════════════════════════════
# Styx — Backend Test Runner
#
# Runs the full 310-test backend suite locally.
# Tests use in-memory SQLite + FakeRedis (no Docker needed).
#
# NOTE: test_alerts.py must run FIRST to avoid an async
# event-loop ordering deadlock.
#
# Usage: bash scripts/run_backend_tests.sh [pytest args]
# ═══════════════════════════════════════════════════════

set -euo pipefail

cd "$(dirname "$0")/../backend"

echo "🧪 Running 310 backend tests..."
python3 -m pytest tests/test_alerts.py tests/ --timeout=15 -q "$@"
