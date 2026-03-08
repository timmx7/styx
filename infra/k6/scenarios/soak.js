// ============================================================================
// k6 Soak Test — Styx Router
//
// Objectif : Executer une charge moderee pendant une longue duree pour
//            detecter les problemes insidieux :
//            - Memory leaks (goroutines non liberees, connexions Redis)
//            - Degradation progressive des performances
//            - Epuisement de file descriptors
//            - Rotation de certificats TLS
//            - Accumulation dans le cache Qdrant
//            - Drift de latence au fil du temps
//
// Duree : 30 minutes par defaut (surcharger avec --duration 2h pour prod)
//
// Phases :
//   1. Ramp    (0→80 VU, 2m)    — Montee douce
//   2. Soak    (80 VU, 26m)     — Charge constante prolongee
//   3. Cool    (80→0 VU, 2m)    — Descente propre
//
// Usage :
//   k6 run scenarios/soak.js
//   k6 run scenarios/soak.js --duration 2h     # Version longue pour prod
//   k6 run scenarios/soak.js --env BASE_URL=https://staging.styx.ai
// ============================================================================

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";

import {
  BASE_URL, HEADERS, TAGS, PAYLOAD_SIMPLE, PAYLOAD_CACHEABLE,
} from "../lib/config.js";

import {
  checkProxyResponse, checkHealthResponse,
  randomPayload, randomSleep,
  routerOverhead, cacheHitRate,
} from "../lib/helpers.js";

// Metriques de soak test — detecter la derive dans le temps
const latencyWindow1  = new Trend("soak_latency_window_1");  // 0-10 min
const latencyWindow2  = new Trend("soak_latency_window_2");  // 10-20 min
const latencyWindow3  = new Trend("soak_latency_window_3");  // 20-30 min
const healthLatencyT  = new Trend("soak_health_latency");
const errorsPerWindow = new Counter("soak_errors_per_window");
const memoryPressure  = new Rate("soak_memory_pressure");     // Proxy pour les 5xx dus a la memoire

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    soak_traffic: {
      executor:  "ramping-vus",
      startVUs:  0,
      stages: [
        { duration: "2m",   target: 80 },   // Ramp up
        { duration: "26m",  target: 80 },   // Soak
        { duration: "2m",   target: 0  },   // Cool down
      ],
      exec: "soakTraffic",
    },

    // Monitoring continu du health check — une sonde constante
    health_probe: {
      executor:        "constant-arrival-rate",
      rate:            2,         // 2 req/s (120 req/min)
      timeUnit:        "1s",
      duration:        "30m",
      preAllocatedVUs: 2,
      maxVUs:          5,
      exec:            "healthProbe",
    },

    // Sonde de metriques — verifier que Prometheus repond toujours
    metrics_probe: {
      executor:        "constant-arrival-rate",
      rate:            1,         // 1 req/s
      timeUnit:        "5s",     // → 1 req toutes les 5s
      duration:        "30m",
      preAllocatedVUs: 1,
      maxVUs:          2,
      exec:            "metricsProbe",
    },
  },

  thresholds: {
    // La latence ne doit PAS augmenter avec le temps
    "soak_latency_window_1":    ["p(95)<200"],
    "soak_latency_window_2":    ["p(95)<200"],   // Meme seuil !
    "soak_latency_window_3":    ["p(95)<200"],   // Si ca monte, memory leak probable
    // Health check doit rester stable
    "soak_health_latency":      ["p(95)<10", "p(99)<25"],
    // Taux d'erreur doit rester bas sur toute la duree
    "http_req_failed":          ["rate<0.01"],
    "checks":                   ["rate>0.99"],
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function setup() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  SOAK TEST — Long-duration stability check`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Duration: ~30 minutes at 80 VUs`);
  console.log(`  Watching for: memory leaks, latency drift, errors`);
  console.log(`${"=".repeat(60)}\n`);

  const healthRes = http.get(`${BASE_URL}/health`, { tags: TAGS.health });
  check(healthRes, {
    "setup: router is healthy": (r) => r.status === 200,
  });

  return {
    startTime: Date.now(),
    // Fenetres temporelles pour comparer la latence (en secondes)
    window1End: 600,   // 10 minutes
    window2End: 1200,  // 20 minutes
  };
}

// ---------------------------------------------------------------------------
// Trafic principal — mix realiste
// ---------------------------------------------------------------------------
export function soakTraffic(data) {
  const elapsed = (Date.now() - data.startTime) / 1000;

  // Requete proxy mixte
  const payload = randomPayload();
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    payload,
    { headers: HEADERS, tags: TAGS.proxy }
  );

  const latency = res.timings.duration;

  // Classifier la latence dans la bonne fenetre temporelle
  if (elapsed < data.window1End) {
    latencyWindow1.add(latency);
  } else if (elapsed < data.window2End) {
    latencyWindow2.add(latency);
  } else {
    latencyWindow3.add(latency);
  }

  // Detecter les signes de memory pressure (erreurs 503)
  if (res.status === 503) {
    memoryPressure.add(1);
    errorsPerWindow.add(1);
  } else {
    memoryPressure.add(0);
  }

  if (res.status === 200) {
    checkProxyResponse(res);
  }

  // Occasionnellement, tester le cache
  if (Math.random() < 0.10) {
    testCacheConsistency();
  }

  sleep(randomSleep(200, 1000));
}

/**
 * Health check continu — sonde de stabilite
 */
export function healthProbe() {
  const res = http.get(`${BASE_URL}/health`, {
    tags: { ...TAGS.health, probe: "soak" },
  });

  healthLatencyT.add(res.timings.duration);

  check(res, {
    "soak health: status 200":       (r) => r.status === 200,
    "soak health: latency < 20ms":   (r) => r.timings.duration < 20,
    "soak health: body has status":  (r) => {
      try { return JSON.parse(r.body).status === "ok"; }
      catch { return false; }
    },
  });
}

/**
 * Sonde Prometheus — verifier que les metriques restent accessibles
 */
export function metricsProbe() {
  const res = http.get(`${BASE_URL}/metrics`, {
    tags: { ...TAGS.metrics, probe: "soak" },
  });

  check(res, {
    "soak metrics: status 200":          (r) => r.status === 200,
    "soak metrics: has styx_up":      (r) => r.body.includes("styx_up"),
    "soak metrics: latency < 100ms":     (r) => r.timings.duration < 100,
  });
}

// ---------------------------------------------------------------------------
// Tests complementaires pendant le soak
// ---------------------------------------------------------------------------

/**
 * Verifie que le cache reste coherent dans le temps
 */
function testCacheConsistency() {
  // Envoyer un prompt identique
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_CACHEABLE,
    { headers: HEADERS, tags: TAGS.cache }
  );

  if (res.status === 200) {
    const cacheHeader = res.headers["X-Styx-Cache"];
    cacheHitRate.add(cacheHeader === "HIT" ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// Teardown — analyse de derive
// ---------------------------------------------------------------------------
export function teardown(data) {
  const elapsed = ((Date.now() - data.startTime) / 1000 / 60).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Soak test complete — ${elapsed} minutes`);
  console.log(`  `);
  console.log(`  KEY ANALYSIS:`);
  console.log(`  Compare soak_latency_window_1 vs window_2 vs window_3`);
  console.log(`  If window_3 > window_1 by >20%, suspect memory leak`);
  console.log(`  `);
  console.log(`  Also check: soak_health_latency for drift`);
  console.log(`${"=".repeat(60)}\n`);
}
