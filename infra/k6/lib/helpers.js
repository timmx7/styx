// ============================================================================
// k6 Load Testing — Fonctions utilitaires partagees
//
// Regroupe les checks communs, generateurs de donnees aleatoires,
// et fonctions de validation utilisees par tous les scenarios.
// ============================================================================

import { check, group } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";

// ---------------------------------------------------------------------------
// Metriques custom — complement aux metriques standard de k6
// ---------------------------------------------------------------------------

// Taux de cache hits (propre a Styx)
export const cacheHitRate = new Rate("styx_cache_hit_rate");

// Overhead du router (extrait du header X-Styx-Latency-Ms)
export const routerOverhead = new Trend("styx_router_overhead_ms");

// Compteur de fallbacks (quand un provider tombe)
export const fallbackCount = new Counter("styx_fallback_count");

// Erreurs par type
export const authErrors   = new Counter("styx_auth_errors");
export const budgetErrors = new Counter("styx_budget_errors");
export const rateLimitHits = new Counter("styx_ratelimit_hits");

// ---------------------------------------------------------------------------
// Checks standard — valident les reponses du router
// ---------------------------------------------------------------------------

/**
 * Verifie une reponse de health check
 */
export function checkHealthResponse(res) {
  const checks = check(res, {
    "health: status is 200":       (r) => r.status === 200,
    "health: body contains status": (r) => {
      try { return JSON.parse(r.body).status === "ok"; }
      catch { return false; }
    },
    "health: has providers":        (r) => {
      try { return "providers" in JSON.parse(r.body); }
      catch { return false; }
    },
    "health: latency < 10ms":      (r) => r.timings.duration < 10,
  });
  return checks;
}

/**
 * Verifie une reponse proxy standard (non-stream)
 */
export function checkProxyResponse(res) {
  const passed = check(res, {
    "proxy: status is 200":          (r) => r.status === 200,
    "proxy: has X-Request-ID":       (r) => r.headers["X-Request-Id"] !== undefined,
    "proxy: has X-Styx-Provider": (r) => r.headers["X-Styx-Provider"] !== undefined,
    "proxy: has X-Styx-Latency":  (r) => r.headers["X-Styx-Latency-Ms"] !== undefined,
    "proxy: body is valid JSON":     (r) => {
      try { JSON.parse(r.body); return true; }
      catch { return false; }
    },
  });

  // Extraire l'overhead du router pour les metriques custom
  const latencyMs = res.headers["X-Styx-Latency-Ms"];
  if (latencyMs) {
    routerOverhead.add(parseFloat(latencyMs));
  }

  // Tracker les cache hits
  const cacheHeader = res.headers["X-Styx-Cache"];
  if (cacheHeader) {
    cacheHitRate.add(cacheHeader === "HIT" ? 1 : 0);
  }

  return passed;
}

/**
 * Verifie une reponse streaming SSE
 */
export function checkStreamResponse(res) {
  return check(res, {
    "stream: status is 200":               (r) => r.status === 200,
    "stream: content-type is event-stream": (r) =>
      (r.headers["Content-Type"] || "").includes("text/event-stream"),
    "stream: has X-Request-ID":            (r) => r.headers["X-Request-Id"] !== undefined,
    "stream: body contains data:":         (r) => r.body && r.body.includes("data:"),
  });
}

/**
 * Verifie une erreur d'auth (401)
 */
export function checkAuthError(res) {
  const passed = check(res, {
    "auth: status is 401":       (r) => r.status === 401,
    "auth: body has error":      (r) => {
      try { return "error" in JSON.parse(r.body); }
      catch { return false; }
    },
  });
  if (res.status === 401) authErrors.add(1);
  return passed;
}

/**
 * Verifie un rate limit (429)
 */
export function checkRateLimitResponse(res) {
  const passed = check(res, {
    "ratelimit: status is 429":          (r) => r.status === 429,
    "ratelimit: has Retry-After header": (r) => r.headers["Retry-After"] !== undefined,
    "ratelimit: has X-RateLimit-Limit":  (r) => r.headers["X-Ratelimit-Limit"] !== undefined,
  });
  if (res.status === 429) rateLimitHits.add(1);
  return passed;
}

/**
 * Verifie une reponse /metrics Prometheus
 */
export function checkMetricsResponse(res) {
  return check(res, {
    "metrics: status is 200":               (r) => r.status === 200,
    "metrics: has styx_requests_total":   (r) => r.body.includes("styx_requests_total"),
    "metrics: has styx_up":              (r) => r.body.includes("styx_up"),
    "metrics: has duration histogram":      (r) => r.body.includes("styx_request_duration_seconds"),
  });
}

// ---------------------------------------------------------------------------
// Generateurs de donnees aleatoires
// ---------------------------------------------------------------------------

const SIMPLE_PROMPTS = [
  "Say hello",
  "What is 2+2?",
  "Tell me a joke",
  "What color is the sky?",
  "Name a fruit",
  "Say goodbye",
  "What day is today?",
  "Count to 5",
  "Spell 'cat'",
  "What is water?",
];

const COMPLEX_PROMPTS = [
  "Design a microservices architecture for an e-commerce platform handling 1M daily orders",
  "Implement a distributed consensus algorithm similar to Raft in pseudocode with failure handling",
  "Create a comprehensive security audit checklist for a banking API with OAuth2 and mTLS",
  "Design a real-time analytics pipeline processing 10TB of clickstream data daily using Kafka and Flink",
  "Architect a multi-region disaster recovery strategy for a SaaS platform with RPO < 1 minute",
];

const MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "claude-3-haiku-20240307",
  "claude-sonnet-4-20250514",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "mistral-small",
  "mistral-large",
];

/**
 * Genere un payload aleatoire simulant un trafic realiste.
 * Distribution : 60% simple, 25% medium, 15% complex
 */
export function randomPayload() {
  const rand = Math.random();

  if (rand < 0.60) {
    // Simple prompt — modele leger
    return JSON.stringify({
      model:      pickRandom(["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-1.5-flash", "mistral-small"]),
      messages:   [{ role: "user", content: pickRandom(SIMPLE_PROMPTS) }],
      max_tokens: 50,
      stream:     Math.random() < 0.20,  // 20% en streaming
    });
  }

  if (rand < 0.85) {
    // Medium prompt
    return JSON.stringify({
      model:    pickRandom(["gemini-1.5-pro", "gpt-4o-mini"]),
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user",   content: pickRandom(SIMPLE_PROMPTS) + " Explain in detail." },
      ],
      max_tokens: 500,
      stream:     Math.random() < 0.30,
    });
  }

  // Complex prompt — modele lourd
  return JSON.stringify({
    model:    pickRandom(["gpt-4o", "claude-sonnet-4-20250514", "mistral-large"]),
    messages: [
      { role: "system", content: "You are an expert software architect." },
      { role: "user",   content: pickRandom(COMPLEX_PROMPTS) },
    ],
    max_tokens: 2000,
    stream:     Math.random() < 0.15,
  });
}

/**
 * Genere un payload avec un modele specifique
 */
export function payloadForModel(model) {
  return JSON.stringify({
    model,
    messages:   [{ role: "user", content: pickRandom(SIMPLE_PROMPTS) }],
    max_tokens: 50,
    stream:     false,
  });
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/**
 * Pause aleatoire entre min et max millisecondes (simule le think time)
 */
export function randomSleep(minMs, maxMs) {
  const ms = Math.random() * (maxMs - minMs) + minMs;
  return ms / 1000; // k6 sleep() prend des secondes
}

/**
 * Extrait les informations de routing d'une reponse
 */
export function extractRoutingInfo(res) {
  return {
    provider:   res.headers["X-Styx-Provider"]   || "unknown",
    model:      res.headers["X-Styx-Model"]      || "unknown",
    complexity: res.headers["X-Styx-Complexity"]  || "unknown",
    latencyMs:  res.headers["X-Styx-Latency-Ms"] || "unknown",
    cache:      res.headers["X-Styx-Cache"]       || "MISS",
    requestId:  res.headers["X-Request-Id"]          || "unknown",
  };
}

/**
 * Log conditionnel (seulement si K6_DEBUG est set)
 */
export function debugLog(msg) {
  if (__ENV.K6_DEBUG === "true") {
    console.log(`[DEBUG] ${msg}`);
  }
}
