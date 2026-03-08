#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Styx Integration Test Suite
# Tests the full stack: Backend API, Auth, Keys, Budget, Alerts
# ═══════════════════════════════════════════════════════════════════

set -uo pipefail

API_URL="${API_URL:-http://localhost:8000}"
ROUTER_URL="${ROUTER_URL:-http://localhost:8080}"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_test() {
    TOTAL=$((TOTAL + 1))
    echo -en "${YELLOW}[$TOTAL] $1...${NC} "
}

log_pass() {
    PASS=$((PASS + 1))
    echo -e "${GREEN}PASS${NC}"
}

log_fail() {
    FAIL=$((FAIL + 1))
    echo -e "${RED}FAIL${NC} — $1"
}

# ─── Wait for services ──────────────────────────────────────────
echo "═══ Waiting for services... ═══"
for i in $(seq 1 30); do
    if curl -sf "$API_URL/health" > /dev/null 2>&1; then
        echo "Backend is up!"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}Backend not reachable at $API_URL after 30s${NC}"
        exit 1
    fi
    sleep 1
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Styx Integration Tests"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── 1. Health check ────────────────────────────────────────────
log_test "Backend health check"
HEALTH=$(curl -sf "$API_URL/health" 2>&1)
if echo "$HEALTH" | grep -q '"ok"'; then
    log_pass
else
    log_fail "health returned: $HEALTH"
fi

# ─── 2. Register a new user ────────────────────────────────────
EMAIL="test_$(date +%s)@styx-test.com"
PASSWORD='TestPass123A'

log_test "Register new user ($EMAIL)"
REG_RESP=$(curl -sf -X POST "$API_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Test User\"}" 2>&1)
ACCESS_TOKEN=$(echo "$REG_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
REFRESH_TOKEN=$(echo "$REG_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('refresh_token',''))" 2>/dev/null || echo "")

if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "None" ]; then
    log_pass
else
    log_fail "no access_token: $REG_RESP"
fi

# ─── 3. Refresh token ──────────────────────────────────────────
log_test "Refresh token"
if [ -n "$REFRESH_TOKEN" ] && [ "$REFRESH_TOKEN" != "None" ]; then
    REFRESH_RESP=$(curl -sf -X POST "$API_URL/api/auth/refresh" \
        -H "Content-Type: application/json" \
        -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}" 2>&1)
    NEW_TOKEN=$(echo "$REFRESH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
    if [ -n "$NEW_TOKEN" ] && [ "$NEW_TOKEN" != "None" ]; then
        ACCESS_TOKEN="$NEW_TOKEN"
        log_pass
    else
        log_fail "refresh failed: $REFRESH_RESP"
    fi
else
    log_fail "no refresh_token from register"
fi

# ─── 4. Duplicate registration blocked ─────────────────────────
log_test "Duplicate registration blocked"
DUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>&1)
if [ "$DUP_STATUS" = "409" ]; then
    log_pass
else
    log_fail "expected 409, got $DUP_STATUS"
fi

# ─── 5. Login ──────────────────────────────────────────────────
log_test "Login"
LOGIN_RESP=$(curl -sf -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>&1)
LOGIN_TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
if [ -n "$LOGIN_TOKEN" ] && [ "$LOGIN_TOKEN" != "None" ]; then
    ACCESS_TOKEN="$LOGIN_TOKEN"
    log_pass
else
    log_fail "login failed: $LOGIN_RESP"
fi

# ─── 6. Get current user ───────────────────────────────────────
log_test "Get /auth/me"
ME_RESP=$(curl -sf "$API_URL/api/auth/me" \
    -H "Authorization: Bearer $ACCESS_TOKEN" 2>&1)
if echo "$ME_RESP" | grep -q "$EMAIL"; then
    log_pass
else
    log_fail "me returned: $ME_RESP"
fi

# ─── 7. Invalid token rejected ─────────────────────────────────
log_test "Invalid token rejected"
BAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/me" \
    -H "Authorization: Bearer invalid_token_123" 2>&1)
if [ "$BAD_STATUS" = "401" ]; then
    log_pass
else
    log_fail "expected 401, got $BAD_STATUS"
fi

# ─── 8. Create team ────────────────────────────────────────────
log_test "Create team"
TEAM_RESP=$(curl -sf -X POST "$API_URL/api/teams" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Test Team"}' 2>&1)
TEAM_ID=$(echo "$TEAM_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if [ -n "$TEAM_ID" ] && [ "$TEAM_ID" != "None" ]; then
    log_pass
else
    log_fail "team creation failed: $TEAM_RESP"
fi

# ─── 9. Create project ─────────────────────────────────────────
log_test "Create project"
PROJ_RESP=$(curl -sf -X POST "$API_URL/api/projects" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Test Project\",\"team_id\":\"$TEAM_ID\",\"budget_monthly_cents\":10000}" 2>&1)
PROJECT_ID=$(echo "$PROJ_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if [ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "None" ]; then
    log_pass
else
    log_fail "project creation failed: $PROJ_RESP"
fi

# ─── 10. Create API key ────────────────────────────────────────
log_test "Create API key"
KEY_RESP=$(curl -sf -X POST "$API_URL/api/keys" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"project_id\":\"$PROJECT_ID\",\"name\":\"Test Key\"}" 2>&1)
API_KEY=$(echo "$KEY_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null || echo "")
KEY_ID=$(echo "$KEY_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if echo "$API_KEY" | grep -q "^sk_styx_"; then
    log_pass
else
    log_fail "key creation failed: $KEY_RESP"
fi

# ─── 11. List API keys ─────────────────────────────────────────
log_test "List API keys"
KEYS_LIST=$(curl -sf "$API_URL/api/keys" \
    -H "Authorization: Bearer $ACCESS_TOKEN" 2>&1)
if echo "$KEYS_LIST" | grep -q "Test Key"; then
    log_pass
else
    log_fail "list returned: $KEYS_LIST"
fi

# ─── 12. Get billing plans ─────────────────────────────────────
log_test "Get billing plans"
PLANS=$(curl -sf "$API_URL/api/billing/plans" 2>&1)
if echo "$PLANS" | grep -q "Starter"; then
    log_pass
else
    log_fail "plans returned: $PLANS"
fi

# ─── 13. Get budget status ─────────────────────────────────────
log_test "Get budget status"
BUDGETS=$(curl -sf "$API_URL/api/budget" \
    -H "Authorization: Bearer $ACCESS_TOKEN" 2>&1)
if echo "$BUDGETS" | grep -q "project_id"; then
    log_pass
else
    log_fail "budgets returned: $BUDGETS"
fi

# ─── 14. Internal endpoint blocked without secret ───────────────
log_test "Internal endpoint requires secret"
INT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/internal/validate-key" \
    -H "Content-Type: application/json" \
    -d '{"key":"test"}' 2>&1)
if [ "$INT_STATUS" = "403" ] || [ "$INT_STATUS" = "500" ]; then
    log_pass
else
    log_fail "expected 403/500, got $INT_STATUS"
fi

# ─── 15. Revoke API key ────────────────────────────────────────
log_test "Revoke API key"
if [ -n "$KEY_ID" ] && [ "$KEY_ID" != "None" ]; then
    REV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/keys/$KEY_ID" \
        -H "Authorization: Bearer $ACCESS_TOKEN" 2>&1)
    if [ "$REV_STATUS" = "204" ]; then
        log_pass
    else
        log_fail "expected 204, got $REV_STATUS"
    fi
else
    log_fail "no key_id to revoke"
fi

# ─── 16. Router health check ───────────────────────────────────
log_test "Router health check"
ROUTER_HEALTH=$(curl -sf "$ROUTER_URL/health" 2>&1 || echo "UNREACHABLE")
if echo "$ROUTER_HEALTH" | grep -q '"ok"'; then
    log_pass
else
    log_fail "router health: $ROUTER_HEALTH (router may not be running)"
fi

# ─── 17. Classifier health check ───────────────────────────────
log_test "Classifier health check"
CL_HEALTH=$(curl -sf "http://localhost:8001/health" 2>&1 || echo "UNREACHABLE")
if echo "$CL_HEALTH" | grep -q '"ok"'; then
    log_pass
else
    log_fail "classifier health: $CL_HEALTH (classifier may not be running)"
fi

# ─── Summary ────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
echo "═══════════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
