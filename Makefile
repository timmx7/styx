# ═══════════════════════════════════════════════════════════════
#  Styx — Root Makefile
#  One command to rule them all.
# ═══════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help

# ─── Colors ───────────────────────────────────────────────────
CYAN  := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED   := \033[31m
RESET := \033[0m

# ─── Variables ────────────────────────────────────────────────
COMPOSE := docker compose
HELM    := helm
K6_DIR  := infra/k6

# ═══════════════════════════════════════════════════════════════
#  Development
# ═══════════════════════════════════════════════════════════════

.PHONY: dev
dev: ## Start all services in development mode
	@echo "$(CYAN)Starting Styx development stack...$(RESET)"
	$(COMPOSE) up --build

.PHONY: dev-detached
dev-detached: ## Start all services in background
	@echo "$(CYAN)Starting Styx (detached)...$(RESET)"
	$(COMPOSE) up --build -d

.PHONY: down
down: ## Stop all services
	@echo "$(YELLOW)Stopping Styx...$(RESET)"
	$(COMPOSE) down

.PHONY: restart
restart: down dev-detached ## Restart all services

.PHONY: logs
logs: ## Tail logs for all services
	$(COMPOSE) logs -f

.PHONY: ps
ps: ## Show running services
	$(COMPOSE) ps

# ═══════════════════════════════════════════════════════════════
#  Build
# ═══════════════════════════════════════════════════════════════

.PHONY: build
build: ## Build all Docker images
	@echo "$(CYAN)Building all images...$(RESET)"
	$(COMPOSE) build

.PHONY: build-router
build-router: ## Build Go router only
	@echo "$(CYAN)Building router...$(RESET)"
	cd router && go build -o bin/router ./cmd/server

.PHONY: build-dashboard
build-dashboard: ## Build Next.js dashboard only
	@echo "$(CYAN)Building dashboard...$(RESET)"
	cd dashboard && npm run build

# ═══════════════════════════════════════════════════════════════
#  Testing
# ═══════════════════════════════════════════════════════════════

.PHONY: test
test: test-router test-backend test-sdk test-dashboard ## Run ALL tests
	@echo "$(GREEN)All tests passed!$(RESET)"

.PHONY: test-router
test-router: ## Run Go router tests
	@echo "$(CYAN)Running router tests...$(RESET)"
	cd router && go test -race -count=1 ./...

.PHONY: test-backend
test-backend: ## Run Python backend tests
	@echo "$(CYAN)Running backend tests...$(RESET)"
	cd backend && python3 -m pytest tests/ -x -q

.PHONY: test-sdk
test-sdk: ## Run Python SDK tests
	@echo "$(CYAN)Running SDK tests...$(RESET)"
	cd sdk/python && python3 -m pytest tests/ -x -q

.PHONY: test-dashboard
test-dashboard: ## Run Next.js dashboard tests
	@echo "$(CYAN)Running dashboard tests...$(RESET)"
	cd dashboard && npm test -- --watchAll=false --passWithNoTests

.PHONY: test-ci
test-ci: test-router test-backend test-sdk ## Tests suitable for CI (no dashboard build required)

# ═══════════════════════════════════════════════════════════════
#  Linting & Formatting
# ═══════════════════════════════════════════════════════════════

.PHONY: lint
lint: lint-router lint-backend lint-dashboard ## Lint all services

.PHONY: lint-router
lint-router: ## Lint Go router
	@echo "$(CYAN)Linting router...$(RESET)"
	cd router && go vet ./...

.PHONY: lint-backend
lint-backend: ## Lint Python backend
	@echo "$(CYAN)Linting backend...$(RESET)"
	cd backend && python3 -m ruff check .

.PHONY: lint-dashboard
lint-dashboard: ## Lint Next.js dashboard
	@echo "$(CYAN)Linting dashboard...$(RESET)"
	cd dashboard && npx next lint

.PHONY: fmt
fmt: ## Format all code
	@echo "$(CYAN)Formatting code...$(RESET)"
	cd router && go fmt ./...
	cd backend && python3 -m ruff format .
	cd dashboard && npx prettier --write "src/**/*.{ts,tsx}"

# ═══════════════════════════════════════════════════════════════
#  Security
# ═══════════════════════════════════════════════════════════════

.PHONY: security
security: ## Run security checks
	@echo "$(RED)Running security scans...$(RESET)"
	@echo "--- Python (bandit) ---"
	cd backend && python3 -m bandit -r app/ -q || true
	@echo "--- Go (govulncheck) ---"
	cd router && go run golang.org/x/vuln/cmd/govulncheck@latest ./... || true
	@echo "--- npm audit ---"
	cd dashboard && npm audit --production || true
	@echo "--- Secrets (gitleaks) ---"
	gitleaks detect --source . --no-banner || true

.PHONY: pre-commit
pre-commit: ## Run pre-commit hooks
	pre-commit run --all-files

# ═══════════════════════════════════════════════════════════════
#  Load Testing (k6)
# ═══════════════════════════════════════════════════════════════

.PHONY: k6-smoke
k6-smoke: ## Run k6 smoke test
	@$(MAKE) -C $(K6_DIR) smoke

.PHONY: k6-load
k6-load: ## Run k6 load test
	@$(MAKE) -C $(K6_DIR) load

.PHONY: k6-stress
k6-stress: ## Run k6 stress test
	@$(MAKE) -C $(K6_DIR) stress

.PHONY: k6-all
k6-all: ## Run all k6 tests
	@$(MAKE) -C $(K6_DIR) all

.PHONY: k6-docker
k6-docker: ## Start k6 + Prometheus + Grafana stack
	@$(MAKE) -C $(K6_DIR) docker-up

# ═══════════════════════════════════════════════════════════════
#  Helm / Kubernetes
# ═══════════════════════════════════════════════════════════════

.PHONY: helm-lint
helm-lint: ## Lint Helm chart
	@echo "$(CYAN)Linting Helm chart...$(RESET)"
	$(HELM) lint infra/helm/styx -f infra/helm/styx/envs/dev.yaml

.PHONY: helm-template
helm-template: ## Render Helm templates
	$(HELM) template styx infra/helm/styx -f infra/helm/styx/envs/production.yaml

.PHONY: helm-package
helm-package: ## Package Helm chart
	$(HELM) package infra/helm/styx

.PHONY: helm-deploy-dev
helm-deploy-dev: ## Deploy to dev namespace
	$(HELM) upgrade --install styx infra/helm/styx \
		-f infra/helm/styx/envs/dev.yaml \
		-n styx-dev --create-namespace

.PHONY: helm-deploy-staging
helm-deploy-staging: ## Deploy to staging namespace
	$(HELM) upgrade --install styx infra/helm/styx \
		-f infra/helm/styx/envs/staging.yaml \
		-n styx-staging --create-namespace

.PHONY: helm-deploy-prod
helm-deploy-prod: ## Deploy to production namespace (requires confirmation)
	@echo "$(RED)WARNING: Deploying to PRODUCTION$(RESET)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	$(HELM) upgrade --install styx infra/helm/styx \
		-f infra/helm/styx/envs/production.yaml \
		-n styx --create-namespace

# ═══════════════════════════════════════════════════════════════
#  Database
# ═══════════════════════════════════════════════════════════════

.PHONY: db-migrate
db-migrate: ## Run Alembic migrations
	cd backend && python3 -m alembic upgrade head

.PHONY: db-rollback
db-rollback: ## Rollback last migration
	cd backend && python3 -m alembic downgrade -1

.PHONY: db-revision
db-revision: ## Create new migration (usage: make db-revision MSG="add users table")
	cd backend && python3 -m alembic revision --autogenerate -m "$(MSG)"

.PHONY: db-reset
db-reset: ## Reset database (DESTROYS ALL DATA)
	@echo "$(RED)WARNING: This will destroy ALL data$(RESET)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	$(COMPOSE) down -v
	$(COMPOSE) up -d postgres redis clickhouse qdrant
	@sleep 3
	cd backend && python3 -m alembic upgrade head

# ═══════════════════════════════════════════════════════════════
#  Cleanup
# ═══════════════════════════════════════════════════════════════

.PHONY: clean
clean: ## Remove build artifacts
	@echo "$(YELLOW)Cleaning build artifacts...$(RESET)"
	rm -rf router/bin/
	rm -rf dashboard/.next/ dashboard/out/
	rm -rf backend/__pycache__ backend/.pytest_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true

.PHONY: clean-docker
clean-docker: down ## Remove all Docker resources
	@echo "$(RED)Removing all Docker resources...$(RESET)"
	$(COMPOSE) down -v --rmi local --remove-orphans

# ═══════════════════════════════════════════════════════════════
#  Help
# ═══════════════════════════════════════════════════════════════

.PHONY: help
help: ## Show this help
	@echo "$(CYAN)Styx — Available Commands$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Examples:$(RESET)"
	@echo "  make dev              # Start development stack"
	@echo "  make test             # Run all tests"
	@echo "  make lint             # Lint all code"
	@echo "  make k6-smoke         # Quick load test"
	@echo "  make helm-deploy-dev  # Deploy to Kubernetes dev"
