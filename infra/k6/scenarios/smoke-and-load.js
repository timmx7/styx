// ============================================================================
// k6 Smoke + Load Test — Styx Router
//
// Objectif : Valider le fonctionnement nominal puis monter en charge
//            progressivement pour verifier la stabilite.
//
// Phases :
//   1. Smoke  (1 VU, 30s)   — Est-ce que ca marche ?
//   2. Ramp   (1→50 VU, 2m) — Montee progressive
//   3. Steady (50 VU, 5m)   — Charge nominale soutenue
//   4. Ramp   (50→100 VU, 2m)— Montee vers la charge haute
//   5. Steady (100 VU, 5m)  — Charge haute soutenue
//   6. Cool   (100→0 VU, 1m)— Descente propre
//
// Usage :
//   k6 run scenarios/smoke-and-load.js
//   k6 run scenarios/smoke-and-load.js --env BASE_URL=https://staging.styx.ai
//   k6 run scenarios/smoke-and-load.js --env BASE_URL=http://localhost:8080 --env API_KEY=sk_styx_...
// ============================================================================

import http from "k6/http";
import { check, group, sleep } from "k6";

import {
  BASE_URL, HEADERS, HEADERS_NO_AUTH, THRESHOLDS, TAGS,
  PAYLOAD_SIMPLE, PAYLOAD_MEDIUM, PAYLOAD_COMPLEX,
  PAYLOAD_STREAM, PAYLOAD_EMBEDDINGS, PAYLOAD_CACHEABLE,
} from "../lib/config.js";

import {
  checkHealthResponse, checkProxyResponse, checkStreamResponse,
  checkMetricsResponse, checkAuthError,
  randomPayload, randomSleep, extractRoutingInfo, debugLog,
  routerOverhead, cacheHitRate,
} from "../lib/helpers.js";

// ---------------------------------------------------------------------------
// Options k6
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    // Phase 1 — Smoke test : 1 VU pendant 30s
    smoke: {
      executor:     "constant-vus",
      vus:          1,
      duration:     "30s",
      startTime:    "0s",
      tags:         { phase: "smoke" },
      env:          { PHASE: "smoke" },
    },
    // Phase 2+3 — Montee + charge nominale
    load_normal: {
      executor:     "ramping-vus",
      startVUs:     0,
      stages: [
        { duration: "2m",  target: 50  },  // Ramp up
        { duration: "5m",  target: 50  },  // Steady state
      ],
      startTime:    "30s",
      tags:         { phase: "load_normal" },
    },
    // Phase 4+5 — Charge haute
    load_high: {
      executor:     "ramping-vus",
      startVUs:     50,
      stages: [
        { duration: "2m",  target: 100 },  // Ramp up
        { duration: "5m",  target: 100 },  // Steady state
        { duration: "1m",  target: 0   },  // Cool down
      ],
      startTime:    "7m30s",
      tags:         { phase: "load_high" },
    },
  },
  thresholds: THRESHOLDS,
};

// ---------------------------------------------------------------------------
// Setup — execute une seule fois avant les VUs
// ---------------------------------------------------------------------------
export function setup() {
  console.log(`\n========================================`);
  console.log(`  Styx Load Test — Smoke + Load`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`========================================\n`);

  // Verifier que le router repond
  const healthRes = http.get(`${BASE_URL}/health`, { tags: TAGS.health });
  const healthy = check(healthRes, {
    "setup: router is reachable": (r) => r.status === 200,
  });

  if (!healthy) {
    console.error("FATAL: Router unreachable — aborting test");
    return { abort: true };
  }

  let healthData;
  try {
    healthData = JSON.parse(healthRes.body);
  } catch {
    healthData = {};
  }
  console.log(`Router status: ${healthData.status || "unknown"}`);
  console.log(`Providers: ${JSON.stringify(healthData.providers || {}, null, 2)}\n`);

  return { startTime: Date.now(), healthy: true };
}

// ---------------------------------------------------------------------------
// Scenario principal — execute par chaque VU a chaque iteration
// ---------------------------------------------------------------------------
export default function (data) {
  if (data && data.abort) return;

  // Distribuer le trafic de facon realiste
  group("health_check", () => testHealthEndpoint());
  group("proxy_simple", () => testProxySimple());
  group("proxy_complex", () => testProxyComplex());
  group("proxy_streaming", () => testStreaming());
  group("cache_behavior", () => testCacheBehavior());
  group("auth_validation", () => testAuthValidation());
  group("prometheus_metrics", () => testMetricsEndpoint());
  group("multi_model_routing", () => testMultiModelRouting());

  // Think time realiste entre les iterations
  sleep(randomSleep(500, 2000));
}

// ---------------------------------------------------------------------------
// Tests individuels
// ---------------------------------------------------------------------------

/**
 * GET /health — doit repondre en <10ms
 */
function testHealthEndpoint() {
  const res = http.get(`${BASE_URL}/health`, { tags: TAGS.health });
  checkHealthResponse(res);
}

/**
 * POST /v1/chat/completions — prompt simple
 */
function testProxySimple() {
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_SIMPLE,
    { headers: HEADERS, tags: TAGS.proxy }
  );

  if (res.status === 200) {
    checkProxyResponse(res);
    const info = extractRoutingInfo(res);
    debugLog(`Simple → ${info.provider}/${info.model} (${info.latencyMs}ms, cache=${info.cache})`);
  }
}

/**
 * POST /v1/chat/completions — prompt complexe
 */
function testProxyComplex() {
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_COMPLEX,
    { headers: HEADERS, tags: TAGS.proxy }
  );

  if (res.status === 200) {
    checkProxyResponse(res);
  }
}

/**
 * POST /v1/chat/completions — streaming SSE
 */
function testStreaming() {
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_STREAM,
    { headers: HEADERS, tags: TAGS.stream }
  );

  if (res.status === 200) {
    checkStreamResponse(res);
  }
}

/**
 * Cache semantique — meme prompt 2x, le 2e devrait etre un HIT
 */
function testCacheBehavior() {
  // Premier appel — devrait etre un MISS (ou HIT si deja en cache)
  const res1 = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_CACHEABLE,
    { headers: HEADERS, tags: TAGS.cache }
  );

  if (res1.status !== 200) return;

  // Court delai pour laisser le cache se remplir
  sleep(0.1);

  // Deuxieme appel — devrait etre un HIT
  const res2 = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_CACHEABLE,
    { headers: HEADERS, tags: TAGS.cache }
  );

  if (res2.status === 200) {
    const cacheHeader = res2.headers["X-Styx-Cache"];
    check(res2, {
      "cache: second call is a HIT": (r) => r.headers["X-Styx-Cache"] === "HIT",
      "cache: HIT is faster":        (r) => r.timings.duration < (res1.timings.duration * 0.5),
    });
    cacheHitRate.add(cacheHeader === "HIT" ? 1 : 0);
  }
}

/**
 * Auth — requete sans token doit retourner 401
 */
function testAuthValidation() {
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_SIMPLE,
    { headers: HEADERS_NO_AUTH, tags: TAGS.error }
  );

  checkAuthError(res);
}

/**
 * GET /metrics — endpoint Prometheus
 */
function testMetricsEndpoint() {
  const res = http.get(`${BASE_URL}/metrics`, { tags: TAGS.metrics });
  checkMetricsResponse(res);
}

/**
 * Routing multi-modele — verifier que differents modeles sont routes correctement
 */
function testMultiModelRouting() {
  const models = ["gpt-4o-mini", "gpt-4o", "gemini-1.5-flash"];
  const model  = models[Math.floor(Math.random() * models.length)];

  const payload = JSON.stringify({
    model,
    messages:   [{ role: "user", content: "Hi" }],
    max_tokens: 10,
    stream:     false,
  });

  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    payload,
    { headers: HEADERS, tags: TAGS.proxy }
  );

  if (res.status === 200) {
    check(res, {
      "routing: response has provider header": (r) =>
        r.headers["X-Styx-Provider"] !== undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// Teardown — resume final
// ---------------------------------------------------------------------------
export function teardown(data) {
  if (!data) return;
  const elapsed = ((Date.now() - data.startTime) / 1000).toFixed(1);
  console.log(`\n========================================`);
  console.log(`  Test complete in ${elapsed}s`);
  console.log(`========================================\n`);
}
