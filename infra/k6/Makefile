# ============================================================================
# Styx Load Testing — Makefile
#
# Prerequis : k6 installe (brew install k6 / snap install k6)
# Optionnel : Docker pour l'execution isolee avec output Prometheus
#
# Usage rapide :
#   make smoke                    Smoke test rapide (2 min)
#   make load                     Load test complet (15 min)
#   make stress                   Stress test (14 min)
#   make spike                    Spike test (7 min)
#   make soak                     Soak test (30 min)
#   make functional               Functional tests (2 min)
#   make all                      Tout sauf soak
#   make ci                       Pour CI/CD (smoke + functional)
#
# Variables :
#   BASE_URL=https://staging.styx.ai   Cible
#   API_KEY=sk_styx_...                      Cle API
#   K6_OUT=json                            Format de sortie
# ============================================================================

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_URL   ?= http://localhost:8080
API_KEY    ?= sk_styx_test_key_for_load_testing
K6_DEBUG   ?= false
K6_OUT     ?=
RESULTS_DIR = results

# Timestamp pour nommer les fichiers de resultats
TS := $(shell date +%Y%m%d_%H%M%S)

# Options k6 communes
K6_OPTS = --env BASE_URL=$(BASE_URL) \
          --env API_KEY=$(API_KEY) \
          --env K6_DEBUG=$(K6_DEBUG)

# Ajouter --out si specifie
ifdef K6_OUT
  K6_OPTS += --out $(K6_OUT)=$(RESULTS_DIR)/$(TS)_$@.$(K6_OUT)
endif

# ---------------------------------------------------------------------------
# Commandes principales
# ---------------------------------------------------------------------------

.PHONY: help smoke load stress spike soak functional all ci clean docker-up docker-down docker-run

help: ## Afficher cette aide
	@echo ""
	@echo "  Styx Load Testing"
	@echo "  ===================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Variables:"
	@echo "    BASE_URL=$(BASE_URL)"
	@echo "    API_KEY=$(API_KEY)"
	@echo ""

smoke: _ensure-results ## Smoke test — validation rapide (~2 min)
	@echo "\n\033[1;34m▶ Running SMOKE test against $(BASE_URL)\033[0m\n"
	k6 run $(K6_OPTS) scenarios/smoke-and-load.js \
		--duration 2m \
		--vus 1

load: _ensure-results ## Load test — charge nominale (~15 min)
	@echo "\n\033[1;34m▶ Running LOAD test against $(BASE_URL)\033[0m\n"
	k6 run $(K6_OPTS) scenarios/smoke-and-load.js

stress: _ensure-results ## Stress test — trouver les limites (~14 min)
	@echo "\n\033[1;33m▶ Running STRESS test against $(BASE_URL)\033[0m\n"
	k6 run $(K6_OPTS) scenarios/stress.js

spike: _ensure-results ## Spike test — pic de trafic soudain (~7 min)
	@echo "\n\033[1;33m▶ Running SPIKE test against $(BASE_URL)\033[0m\n"
	k6 run $(K6_OPTS) scenarios/spike.js

soak: _ensure-results ## Soak test — endurance longue duree (~30 min)
	@echo "\n\033[1;35m▶ Running SOAK test against $(BASE_URL)\033[0m\n"
	k6 run $(K6_OPTS) scenarios/soak.js

functional: _ensure-results ## Tests fonctionnels — validation comportement (~2 min)
	@echo "\n\033[1;32m▶ Running FUNCTIONAL tests against $(BASE_URL)\033[0m\n"
	k6 run $(K6_OPTS) scenarios/functional.js

all: smoke load stress spike functional ## Tout sauf soak (total ~40 min)
	@echo "\n\033[1;32m✓ All tests complete\033[0m\n"

ci: smoke functional ## Tests CI/CD — rapides et critiques (~4 min)
	@echo "\n\033[1;32m✓ CI tests complete\033[0m\n"

# ---------------------------------------------------------------------------
# Execution Docker (avec Prometheus output)
# ---------------------------------------------------------------------------

docker-up: ## Lancer k6 + Prometheus + Grafana via docker-compose
	docker compose -f docker-compose.k6.yaml up -d prometheus grafana
	@echo "\n\033[1;34m  Grafana: http://localhost:3000 (admin/admin)\033[0m"
	@echo "\033[1;34m  Prometheus: http://localhost:9090\033[0m\n"

docker-down: ## Arreter la stack docker
	docker compose -f docker-compose.k6.yaml down -v

docker-smoke: docker-up ## Smoke test via Docker avec metriques Prometheus
	docker compose -f docker-compose.k6.yaml run --rm \
		-e BASE_URL=$(BASE_URL) \
		-e API_KEY=$(API_KEY) \
		k6 run /scripts/scenarios/smoke-and-load.js --duration 2m --vus 1

docker-load: docker-up ## Load test via Docker
	docker compose -f docker-compose.k6.yaml run --rm \
		-e BASE_URL=$(BASE_URL) \
		-e API_KEY=$(API_KEY) \
		k6 run /scripts/scenarios/smoke-and-load.js

docker-stress: docker-up ## Stress test via Docker
	docker compose -f docker-compose.k6.yaml run --rm \
		-e BASE_URL=$(BASE_URL) \
		-e API_KEY=$(API_KEY) \
		k6 run /scripts/scenarios/stress.js

# ---------------------------------------------------------------------------
# Comparaison de resultats
# ---------------------------------------------------------------------------

compare: ## Comparer les 2 derniers resultats JSON
	@echo "\nComparing last 2 results in $(RESULTS_DIR)/\n"
	@ls -t $(RESULTS_DIR)/*.json 2>/dev/null | head -2 | \
		xargs -I {} echo "  {}" || \
		echo "  No JSON results found. Run with K6_OUT=json"

# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

_ensure-results:
	@mkdir -p $(RESULTS_DIR)

clean: ## Supprimer les resultats
	rm -rf $(RESULTS_DIR)
	@echo "Results cleaned"

check-deps: ## Verifier les dependances
	@echo "Checking dependencies..."
	@which k6 > /dev/null 2>&1 && echo "  ✓ k6 installed ($$(k6 version))" || echo "  ✗ k6 not found (brew install k6)"
	@which docker > /dev/null 2>&1 && echo "  ✓ docker installed" || echo "  ✗ docker not found"
	@curl -sf $(BASE_URL)/health > /dev/null 2>&1 && echo "  ✓ router reachable at $(BASE_URL)" || echo "  ✗ router unreachable at $(BASE_URL)"
