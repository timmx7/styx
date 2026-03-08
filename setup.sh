#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# Styx — Interactive Setup Wizard
# Generates a .env file and prepares the project for docker compose.
# Works on macOS and Linux. No external dependencies.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Colors (only if terminal supports them) ────────────────────
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD=$(tput bold)
  DIM=$(tput setaf 7)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  RED=$(tput setaf 1)
  CYAN=$(tput setaf 6)
  RESET=$(tput sgr0)
else
  BOLD="" DIM="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

# ─── Globals ────────────────────────────────────────────────────
OPENAI_KEY="" ANTHROPIC_KEY="" GOOGLE_KEY="" MISTRAL_KEY=""
AUTH_MODE="" SKIP_AUTH="false"
SUPABASE_URL="" SUPABASE_ANON_KEY=""
ROUTER_PORT=8080 BACKEND_PORT=8000 DASHBOARD_PORT=3000
JWT_SECRET="" INTERNAL_SECRET="" API_KEY_HMAC_SECRET="" ENCRYPTION_KEY=""
POSTGRES_PASSWORD="" REDIS_PASSWORD=""

# ─── Step A: Prerequisite Check ─────────────────────────────────
check_prerequisites() {
  echo ""
  echo "${BOLD}Checking prerequisites...${RESET}"
  local ok=true

  # Docker Engine 24+
  if command -v docker &>/dev/null; then
    local docker_version
    docker_version=$(docker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)
    local docker_major
    docker_major=$(echo "$docker_version" | cut -d. -f1)
    if [ "$docker_major" -ge 24 ] 2>/dev/null; then
      echo "  ${GREEN}✓${RESET} Docker Engine $docker_version"
    else
      echo "  ${RED}✗${RESET} Docker Engine $docker_version (need 24+)"
      ok=false
    fi
  else
    echo "  ${RED}✗${RESET} Docker not found — install from https://docs.docker.com/get-docker/"
    ok=false
  fi

  # Docker Compose v2
  if docker compose version &>/dev/null; then
    local compose_version
    compose_version=$(docker compose version 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+' | head -1)
    echo "  ${GREEN}✓${RESET} Docker Compose $compose_version"
  else
    echo "  ${RED}✗${RESET} Docker Compose v2 not found — install from https://docs.docker.com/compose/install/"
    ok=false
  fi

  # curl
  if command -v curl &>/dev/null; then
    echo "  ${GREEN}✓${RESET} curl"
  else
    echo "  ${RED}✗${RESET} curl not found"
    ok=false
  fi

  # openssl
  if command -v openssl &>/dev/null; then
    echo "  ${GREEN}✓${RESET} openssl"
  else
    echo "  ${RED}✗${RESET} openssl not found"
    ok=false
  fi

  if [ "$ok" = false ]; then
    echo ""
    echo "${RED}Please install the missing prerequisites and try again.${RESET}"
    exit 1
  fi

  echo ""
}

# ─── Step B: Banner ─────────────────────────────────────────────
show_banner() {
  echo ""
  echo "${BOLD}${CYAN}"
  cat <<'BANNER'
   _____ _______   ____  __
  / ____|__   __| / __ \ \ \  / /
 | (___    | |   | |  | | \ \/ /
  \___ \   | |   | |  | |  \  /
  ____) |  | |   | |__| |  / /
 |_____/   |_|    \____/  /_/

BANNER
  echo "${RESET}"
  echo "${BOLD}  Welcome to the Styx Setup Wizard${RESET}"
  echo "  ${DIM}The MCP-Native AI Gateway${RESET}"
  echo ""
  echo "  This wizard will generate your ${BOLD}.env${RESET} file and prepare"
  echo "  Styx for launch. It takes about 2 minutes."
  echo ""
}

# ─── Step C: Provider Keys ──────────────────────────────────────
collect_provider_keys() {
  echo "${BOLD}Step 1/4 — AI Provider Keys${RESET}"
  echo "${DIM}At least one key is required. Press Enter to skip a provider.${RESET}"
  echo ""

  read -rp "  OpenAI API key (sk-...): " OPENAI_KEY
  if [ -n "$OPENAI_KEY" ]; then
    if [[ ! "$OPENAI_KEY" =~ ^sk- ]]; then
      echo "  ${YELLOW}Warning: OpenAI keys usually start with sk-${RESET}"
    fi
  fi

  read -rp "  Anthropic API key (sk-ant-...): " ANTHROPIC_KEY
  if [ -n "$ANTHROPIC_KEY" ]; then
    if [[ ! "$ANTHROPIC_KEY" =~ ^sk-ant- ]]; then
      echo "  ${YELLOW}Warning: Anthropic keys usually start with sk-ant-${RESET}"
    fi
  fi

  read -rp "  Google API key: " GOOGLE_KEY
  read -rp "  Mistral API key: " MISTRAL_KEY

  # Check at least one key was provided
  if [ -z "$OPENAI_KEY" ] && [ -z "$ANTHROPIC_KEY" ] && [ -z "$GOOGLE_KEY" ] && [ -z "$MISTRAL_KEY" ]; then
    echo ""
    echo "  ${RED}Error: At least one AI provider key is required.${RESET}"
    exit 1
  fi

  local count=0
  [ -n "$OPENAI_KEY" ] && count=$((count+1))
  [ -n "$ANTHROPIC_KEY" ] && count=$((count+1))
  [ -n "$GOOGLE_KEY" ] && count=$((count+1))
  [ -n "$MISTRAL_KEY" ] && count=$((count+1))
  echo ""
  echo "  ${GREEN}✓${RESET} $count provider(s) configured"
  echo ""
}

# ─── Step D: Auth Mode ──────────────────────────────────────────
choose_auth_mode() {
  echo "${BOLD}Step 2/4 — Authentication Mode${RESET}"
  echo ""
  echo "  ${CYAN}1)${RESET} Dev mode ${DIM}(no auth, instant start — recommended for trying Styx)${RESET}"
  echo "  ${CYAN}2)${RESET} Production ${DIM}(Supabase auth — requires a free Supabase account)${RESET}"
  echo ""

  while true; do
    read -rp "  Choose [1/2]: " choice
    case "$choice" in
      1)
        AUTH_MODE="dev"
        SKIP_AUTH="true"
        echo ""
        echo "  ${GREEN}✓${RESET} Dev mode selected — no Supabase needed"
        echo ""
        break
        ;;
      2)
        AUTH_MODE="production"
        SKIP_AUTH="false"
        echo ""
        echo "  ${DIM}Create a free project at https://supabase.com/dashboard${RESET}"
        echo "  ${DIM}Then go to Settings → API to find these values:${RESET}"
        echo ""

        while true; do
          read -rp "  Supabase Project URL (https://xxx.supabase.co): " SUPABASE_URL
          if [[ "$SUPABASE_URL" =~ ^https:// ]]; then
            break
          fi
          echo "  ${YELLOW}URL must start with https://${RESET}"
        done

        while true; do
          read -rp "  Supabase Anon Key (eyJ...): " SUPABASE_ANON_KEY
          if [ -n "$SUPABASE_ANON_KEY" ]; then
            break
          fi
          echo "  ${YELLOW}Anon key is required${RESET}"
        done

        echo ""
        echo "  ${GREEN}✓${RESET} Supabase configured"
        echo ""
        break
        ;;
      *)
        echo "  ${YELLOW}Please enter 1 or 2${RESET}"
        ;;
    esac
  done
}

# ─── Step E: Generate Secrets ───────────────────────────────────
generate_secrets() {
  echo "${BOLD}Step 3/4 — Generating Security Keys${RESET}"
  echo ""

  JWT_SECRET=$(openssl rand -hex 32)
  INTERNAL_SECRET=$(openssl rand -hex 32)
  API_KEY_HMAC_SECRET=$(openssl rand -hex 32)
  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  REDIS_PASSWORD=$(openssl rand -hex 16)

  # Instance ID: stable UUID for this deployment (persists across restarts)
  if command -v uuidgen &>/dev/null; then
    INSTANCE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    INSTANCE_ID=$(cat /proc/sys/kernel/random/uuid)
  else
    # Fallback: construct a UUID-shaped string from openssl
    local rnd
    rnd=$(openssl rand -hex 16)
    INSTANCE_ID="${rnd:0:8}-${rnd:8:4}-4${rnd:13:3}-${rnd:16:4}-${rnd:20:12}"
  fi

  # Fernet key: try python3 first, then python, then openssl fallback
  if command -v python3 &>/dev/null && python3 -c "from cryptography.fernet import Fernet" 2>/dev/null; then
    ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
  elif command -v python &>/dev/null && python -c "from cryptography.fernet import Fernet" 2>/dev/null; then
    ENCRYPTION_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
  else
    # Fallback: base64-encoded 32 random bytes (valid Fernet key format)
    ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
    echo "  ${DIM}(python3 + cryptography not found, using openssl fallback for encryption key)${RESET}"
  fi

  echo "  ${GREEN}✓${RESET} JWT_SECRET generated"
  echo "  ${GREEN}✓${RESET} INTERNAL_SECRET generated"
  echo "  ${GREEN}✓${RESET} API_KEY_HMAC_SECRET generated"
  echo "  ${GREEN}✓${RESET} ENCRYPTION_KEY generated"
  echo "  ${GREEN}✓${RESET} Database passwords generated"
  echo "  ${GREEN}✓${RESET} INSTANCE_ID: $INSTANCE_ID"
  echo ""
}

# ─── Step F: Port Config ────────────────────────────────────────
configure_ports() {
  echo "${BOLD}Step 4/4 — Port Configuration${RESET}"
  echo ""
  echo "  Defaults: Router=${CYAN}$ROUTER_PORT${RESET}, Backend=${CYAN}$BACKEND_PORT${RESET}, Dashboard=${CYAN}$DASHBOARD_PORT${RESET}"
  echo ""
  read -rp "  Use default ports? [Y/n]: " use_defaults

  if [[ "$(echo "$use_defaults" | tr '[:upper:]' '[:lower:]')" == "n" ]]; then
    read -rp "  Router port [$ROUTER_PORT]: " port
    [ -n "$port" ] && ROUTER_PORT="$port"
    read -rp "  Backend port [$BACKEND_PORT]: " port
    [ -n "$port" ] && BACKEND_PORT="$port"
    read -rp "  Dashboard port [$DASHBOARD_PORT]: " port
    [ -n "$port" ] && DASHBOARD_PORT="$port"
  fi

  echo ""
  echo "  ${GREEN}✓${RESET} Ports: Router=$ROUTER_PORT, Backend=$BACKEND_PORT, Dashboard=$DASHBOARD_PORT"
  echo ""
}

# ─── Step G: Write .env ─────────────────────────────────────────
write_env_file() {
  if [ -f .env ]; then
    echo "${YELLOW}A .env file already exists.${RESET}"
    read -rp "  Overwrite? [y/N]: " overwrite
    if [[ "$(echo "$overwrite" | tr '[:upper:]' '[:lower:]')" != "y" ]]; then
      echo "  ${DIM}Keeping existing .env file. Exiting.${RESET}"
      exit 0
    fi
    echo ""
  fi

  cat > .env <<ENVFILE
# ══════════════════════════════════════════════════════════════════
# STYX — Generated by setup.sh on $(date -u '+%Y-%m-%d %H:%M UTC')
# ══════════════════════════════════════════════════════════════════

# ── Mode ──
DEBUG=true
ENVIRONMENT=development

# ── Authentication ──
SKIP_AUTH=${SKIP_AUTH}
NEXT_PUBLIC_SKIP_AUTH=${SKIP_AUTH}

# ── Database ──
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql+asyncpg://styx:${POSTGRES_PASSWORD}@postgres:5432/styx

# ── Redis ──
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

# ── Instance ──
INSTANCE_ID=${INSTANCE_ID}

# ── Security ──
JWT_SECRET=${JWT_SECRET}
INTERNAL_SECRET=${INTERNAL_SECRET}
API_KEY_HMAC_SECRET=${API_KEY_HMAC_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ── Supabase ──
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}

# ── AI Providers ──
OPENAI_API_KEY=${OPENAI_KEY}
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
GOOGLE_API_KEY=${GOOGLE_KEY}
MISTRAL_API_KEY=${MISTRAL_KEY}

# ── ClickHouse ──
CLICKHOUSE_PASSWORD=$(openssl rand -hex 16)

# ── Stripe (optional) ──
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# ── CORS ──
CORS_ORIGINS=http://localhost:${DASHBOARD_PORT},http://127.0.0.1:${DASHBOARD_PORT},https://localhost,https://127.0.0.1

# ── Frontend URL ──
FRONTEND_URL=http://localhost:${DASHBOARD_PORT}
NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}
ENVFILE

  echo "  ${GREEN}✓${RESET} .env file generated"
  echo ""
}

# ─── Step H: Summary ────────────────────────────────────────────
show_summary() {
  echo "${BOLD}══════════════════════════════════════════════════${RESET}"
  echo "${BOLD}  Setup Complete${RESET}"
  echo "${BOLD}══════════════════════════════════════════════════${RESET}"
  echo ""

  if [ "$AUTH_MODE" = "dev" ]; then
    echo "  Mode:      ${YELLOW}Dev mode${RESET} (no authentication)"
  else
    echo "  Mode:      ${GREEN}Production${RESET} (Supabase auth)"
  fi

  echo "  Providers: $(
    providers=""
    [ -n "$OPENAI_KEY" ] && providers="${providers}OpenAI "
    [ -n "$ANTHROPIC_KEY" ] && providers="${providers}Anthropic "
    [ -n "$GOOGLE_KEY" ] && providers="${providers}Google "
    [ -n "$MISTRAL_KEY" ] && providers="${providers}Mistral "
    echo "${CYAN}${providers}${RESET}"
  )"
  echo ""
  echo "  ${BOLD}Next steps:${RESET}"
  echo ""
  echo "    ${CYAN}docker compose up -d --build${RESET}"
  echo ""
  echo "  Wait ~60 seconds for all services to become healthy, then:"
  echo ""
  echo "    Dashboard:   ${CYAN}http://localhost:${DASHBOARD_PORT}${RESET}"
  echo "    API Gateway: ${CYAN}http://localhost:${ROUTER_PORT}${RESET}"
  echo "    Backend API: ${CYAN}http://localhost:${BACKEND_PORT}${RESET}"
  echo ""

  if [ "$AUTH_MODE" = "dev" ]; then
    echo "  ${YELLOW}Dev mode:${RESET} Authentication is disabled."
    echo "  The dashboard will show an orange banner as a reminder."
    echo "  Requests to the router are accepted without an API key."
    echo ""
    echo "  ${BOLD}Quick test:${RESET}"
    echo "    curl http://localhost:${ROUTER_PORT}/v1/chat/completions \\"
    echo "      -H \"Content-Type: application/json\" \\"
    echo "      -d '{\"model\":\"gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello from Styx\"}]}'"
  else
    echo "  Open the dashboard, create an account, then create an API key."
    echo ""
    echo "  ${BOLD}Quick test:${RESET}"
    echo "    curl http://localhost:${ROUTER_PORT}/v1/chat/completions \\"
    echo "      -H \"Authorization: Bearer YOUR_STYX_KEY\" \\"
    echo "      -H \"Content-Type: application/json\" \\"
    echo "      -d '{\"model\":\"gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello from Styx\"}]}'"
  fi

  echo ""
}

# ─── Main ───────────────────────────────────────────────────────
main() {
  show_banner
  check_prerequisites
  collect_provider_keys
  choose_auth_mode
  generate_secrets
  configure_ports
  write_env_file
  show_summary
}

main "$@"
