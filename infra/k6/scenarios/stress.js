// ============================================================================
// k6 Stress Test — Styx Router
//
// Objectif : Trouver le point de rupture du router. On pousse la charge
//            bien au-dela de la capacite nominale pour identifier :
//            - A quel moment le p99 depasse 100ms
//            - A quel moment les erreurs 5xx commencent
//            - Le throughput maximum avant degradation
//            - Le comportement du circuit breaker sous pression
//
// Phases :
//   1. Warm-up    (0→50 VU, 1m)    — Point de depart stable
//   2. Ramp       (50→200 VU, 3m)  — Montee aggressive
//   3. Peak       (200→500 VU, 3m) — Zone de stress
//   4. Breakpoint (500→1000 VU, 3m)— Chercher la cassure
//   5. Recover    (1000→50 VU, 2m) — Le systeme se remet-il ?
//   6. Verify     (50 VU, 2m)      — Retour a la normale ?
//
// Usage :
//   k6 run scenarios/stress.js
//   k6 run scenarios/stress.js --env BASE_URL=https://staging.styx.ai
// ============================================================================

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

import {
  BASE_URL, HEADERS, THRESHOLDS_STRESS, TAGS,
  PAYLOAD_SIMPLE,
} from "../lib/config.js";

import {
  checkProxyResponse, checkHealthResponse,
  randomPayload, randomSleep, debugLog,
  routerOverhead,
} from "../lib/helpers.js";

// Metriques specifiques au stress test
const errorsByPhase  = new Counter("stress_errors_by_phase");
const recoveryTime   = new Trend("stress_recovery_time_ms");
const degradationVUs = new Counter("stress_degradation_detected");

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    stress_ramp: {
      executor:  "ramping-vus",
      startVUs:  0,
      stages: [
        // Phase 1 — Warm-up
        { duration: "1m",  target: 50   },
        // Phase 2 — Montee aggressive
        { duration: "3m",  target: 200  },
        // Phase 3 — Zone de stress
        { duration: "3m",  target: 500  },
        // Phase 4 — Breakpoint
        { duration: "3m",  target: 1000 },
        // Phase 5 — Recovery
        { duration: "2m",  target: 50   },
        // Phase 6 — Verification post-recovery
        { duration: "2m",  target: 50   },
      ],
      tags: { test: "stress" },
    },

    // Scenario parallele : bombarder le health check pour mesurer
    // l'overhead meme sous forte charge
    health_monitor: {
      executor:   "constant-arrival-rate",
      rate:       10,              // 10 req/s
      timeUnit:   "1s",
      duration:   "14m",
      preAllocatedVUs: 5,
      maxVUs:     10,
      tags:       { test: "stress_health" },
      exec:       "healthCheck",
    },
  },

  thresholds: {
    ...THRESHOLDS_STRESS,
    // Seuil specifique : le health check doit rester <10ms meme sous stress
    "http_req_duration{test:stress_health}": ["p(95)<20", "p(99)<50"],
    // Recovery : apres le pic, le systeme doit revenir a la normale
    "http_req_duration{phase:recovery}": ["p(95)<500"],
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function setup() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  STRESS TEST — Finding the breaking point`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Peak load: 1000 VUs`);
  console.log(`${"=".repeat(60)}\n`);

  const healthRes = http.get(`${BASE_URL}/health`, { tags: TAGS.health });
  const healthy = check(healthRes, {
    "setup: router is healthy": (r) => r.status === 200,
  });

  if (!healthy) {
    console.error("FATAL: Router unreachable");
    return { abort: true };
  }

  return { startTime: Date.now(), healthy: true };
}

// ---------------------------------------------------------------------------
// Scenario principal — bombardement proxy
// ---------------------------------------------------------------------------
export default function (data) {
  if (data && data.abort) return;

  // Alterner entre differents types de requetes
  const rand = Math.random();

  if (rand < 0.70) {
    // 70% — requetes simples (le cas le plus courant)
    stressProxySimple();
  } else if (rand < 0.90) {
    // 20% — requetes aleatoires (mix de complexites)
    stressProxyRandom();
  } else {
    // 10% — requetes volontairement couteuses
    stressProxyHeavy();
  }

  // Think time tres court sous stress (simuler un client agressif)
  sleep(randomSleep(50, 200));
}

/**
 * Health check continu — monitore le router pendant le stress
 */
export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`, {
    tags: { ...TAGS.health, test: "stress_health" },
  });

  const latency = res.timings.duration;
  check(res, {
    "health: still responds under stress": (r) => r.status === 200,
    "health: latency < 50ms under stress": (r) => r.timings.duration < 50,
  });

  // Detecter la degradation
  if (latency > 50) {
    degradationVUs.add(1);
    debugLog(`DEGRADATION: health check took ${latency.toFixed(1)}ms`);
  }
}

// ---------------------------------------------------------------------------
// Fonctions de stress
// ---------------------------------------------------------------------------

function stressProxySimple() {
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_SIMPLE,
    { headers: HEADERS, tags: { ...TAGS.proxy, test: "stress" } }
  );

  if (res.status === 200) {
    checkProxyResponse(res);
  } else if (res.status === 429) {
    // Rate limit atteint — c'est normal sous stress
    debugLog(`Rate limited (429)`);
  } else if (res.status >= 500) {
    errorsByPhase.add(1);
    debugLog(`Server error: ${res.status}`);
  }
}

function stressProxyRandom() {
  const payload = randomPayload();
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    payload,
    { headers: HEADERS, tags: { ...TAGS.proxy, test: "stress" } }
  );

  if (res.status === 200) {
    checkProxyResponse(res);
  }
}

function stressProxyHeavy() {
  // Payload plus gros que la moyenne
  const heavyPayload = JSON.stringify({
    model:    "gpt-4o",
    messages: [
      { role: "system", content: "You are an expert." },
      { role: "user",   content: "A".repeat(5000) }, // 5KB de contenu
    ],
    max_tokens: 2000,
    stream:     false,
  });

  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    heavyPayload,
    { headers: HEADERS, tags: { ...TAGS.proxy, test: "stress" } }
  );

  if (res.status === 200) {
    checkProxyResponse(res);
  }
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
export function teardown(data) {
  if (!data) return;
  const elapsed = ((Date.now() - data.startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Stress test complete in ${elapsed}s`);
  console.log(`  Check k6 output for breakpoint analysis`);
  console.log(`${"=".repeat(60)}\n`);
}
