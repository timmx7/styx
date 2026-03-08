// ============================================================================
// k6 Spike Test — Styx Router
//
// Objectif : Simuler un pic de trafic soudain (ex: produit qui devient
//            viral, mention sur Hacker News) et verifier que le router :
//            - Survit au pic sans crash
//            - Continue a servir les requetes (meme avec degradation)
//            - Se remet rapidement apres le pic
//            - Le circuit breaker ne se declenche pas a tort
//
// Pattern :
//   1. Normal (50 VU, 1m)        — Baseline stable
//   2. SPIKE  (50→750 VU, 10s)   — Pic brutal en 10 secondes
//   3. Peak   (750 VU, 2m)       — Maintien du pic
//   4. Drop   (750→50 VU, 10s)   — Retour brutal
//   5. Verify (50 VU, 3m)        — Le systeme est-il revenu a la normale ?
//
// Usage :
//   k6 run scenarios/spike.js
// ============================================================================

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

import {
  BASE_URL, HEADERS, TAGS, PAYLOAD_SIMPLE,
} from "../lib/config.js";

import {
  checkProxyResponse, randomPayload, randomSleep,
  routerOverhead,
} from "../lib/helpers.js";

// Metriques spike
const spikeErrors      = new Counter("spike_errors_during_peak");
const spikeRecoveryMs  = new Trend("spike_recovery_latency_ms");
const preSpikeBuckets  = new Trend("spike_pre_latency_ms");
const peakBuckets      = new Trend("spike_peak_latency_ms");
const postSpikeBuckets = new Trend("spike_post_latency_ms");

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    spike: {
      executor:  "ramping-vus",
      startVUs:  0,
      stages: [
        // Phase 1 — Baseline stable
        { duration: "1m",   target: 50  },
        // Phase 2 — SPIKE ! (10 secondes pour passer de 50 a 750)
        { duration: "10s",  target: 750 },
        // Phase 3 — Maintien du pic
        { duration: "2m",   target: 750 },
        // Phase 4 — Retour brutal
        { duration: "10s",  target: 50  },
        // Phase 5 — Verification recovery
        { duration: "3m",   target: 50  },
        // Cool down
        { duration: "30s",  target: 0   },
      ],
    },
  },

  thresholds: {
    // Pendant le spike, on accepte plus de latence mais pas d'erreurs fatales
    "http_req_duration":           ["p(95)<3000", "p(99)<5000"],
    // Apres le spike, le systeme doit revenir a la normale
    "spike_post_latency_ms":       ["p(95)<200"],
    // Le taux d'erreur doit rester sous controle
    "http_req_failed":             ["rate<0.05"],  // <5%
    "checks":                      ["rate>0.90"],
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function setup() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  SPIKE TEST — Sudden traffic surge simulation`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Spike: 50 → 750 VUs in 10 seconds`);
  console.log(`${"=".repeat(60)}\n`);

  const healthRes = http.get(`${BASE_URL}/health`, { tags: TAGS.health });
  check(healthRes, {
    "setup: router is healthy": (r) => r.status === 200,
  });

  return {
    startTime: Date.now(),
    // Timestamps pour identifier les phases
    spikeStart:    60,   // secondes apres le debut
    spikeEnd:      190,  // 60s + 10s ramp + 2m peak
    recoveryStart: 200,  // 10s de descente apres
  };
}

// ---------------------------------------------------------------------------
// Scenario principal
// ---------------------------------------------------------------------------
export default function (data) {
  const elapsed = (Date.now() - data.startTime) / 1000;

  // Determiner la phase actuelle pour les metriques
  let phase;
  if (elapsed < data.spikeStart) {
    phase = "pre-spike";
  } else if (elapsed < data.spikeEnd) {
    phase = "spike-peak";
  } else {
    phase = "post-spike";
  }

  // Requete proxy standard
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    PAYLOAD_SIMPLE,
    {
      headers: HEADERS,
      tags:    { ...TAGS.proxy, phase },
    }
  );

  const latency = res.timings.duration;

  // Metriques par phase
  if (phase === "pre-spike") {
    preSpikeBuckets.add(latency);
  } else if (phase === "spike-peak") {
    peakBuckets.add(latency);
    if (res.status >= 500) {
      spikeErrors.add(1);
    }
  } else {
    postSpikeBuckets.add(latency);
    spikeRecoveryMs.add(latency);
  }

  if (res.status === 200) {
    checkProxyResponse(res);
  }

  // Think time variable selon la phase
  if (phase === "spike-peak") {
    sleep(randomSleep(10, 50));   // Tres agressif pendant le pic
  } else {
    sleep(randomSleep(200, 800)); // Normal hors pic
  }
}

// ---------------------------------------------------------------------------
// Teardown — analyse comparative des phases
// ---------------------------------------------------------------------------
export function teardown(data) {
  const elapsed = ((Date.now() - data.startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Spike test complete in ${elapsed}s`);
  console.log(`  Compare pre-spike vs peak vs post-spike latencies`);
  console.log(`  Key question: Did post-spike return to pre-spike levels?`);
  console.log(`${"=".repeat(60)}\n`);
}
