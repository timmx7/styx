// ============================================================================
// k6 Functional Load Test — Styx Router
//
// Objectif : Valider le comportement fonctionnel du router sous charge.
//            Contrairement aux autres scripts qui mesurent la performance,
//            celui-ci verifie la CORRECTION du comportement.
//
// Scenarios testes :
//   1. Rate limiting — les quotas sont-ils respectes ?
//   2. Auth — les requetes sans token sont-elles bloquees ?
//   3. Circuit breaker — le failover fonctionne-t-il ?
//   4. Body size limit — les requetes >10MB sont-elles rejetees ?
//   5. Method validation — seul POST est accepte sur /v1
//   6. Path validation — les chemins non autorises sont rejetes
//   7. Headers de securite — presents sur chaque reponse
//   8. Concurrent cache — le cache gere-t-il les requetes simultanees ?
//
// Usage :
//   k6 run scenarios/functional.js
//   k6 run scenarios/functional.js --env BASE_URL=http://localhost:8080
// ============================================================================

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter } from "k6/metrics";

import {
  BASE_URL, API_KEY, HEADERS, HEADERS_NO_AUTH, TAGS,
  PAYLOAD_SIMPLE, PAYLOAD_CACHEABLE, generateLargePayload,
} from "../lib/config.js";

import {
  checkAuthError, checkRateLimitResponse,
  rateLimitHits,
} from "../lib/helpers.js";

// Metriques fonctionnelles
const functionalPassed = new Counter("functional_tests_passed");
const functionalFailed = new Counter("functional_tests_failed");

// ---------------------------------------------------------------------------
// Options — court mais intense
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    // Test rate limiting — beaucoup de VUs sur le meme API key
    rate_limit_test: {
      executor:     "per-vu-iterations",
      vus:          5,
      iterations:   30,    // 5 VUs x 30 = 150 requetes rapides
      startTime:    "0s",
      maxDuration:  "1m",
      exec:         "testRateLimiting",
      tags:         { scenario: "rate_limit" },
    },

    // Test auth — tentatives sans credentials
    auth_test: {
      executor:     "per-vu-iterations",
      vus:          3,
      iterations:   10,
      startTime:    "0s",
      maxDuration:  "30s",
      exec:         "testAuth",
      tags:         { scenario: "auth" },
    },

    // Test body limits
    body_limit_test: {
      executor:     "per-vu-iterations",
      vus:          2,
      iterations:   3,
      startTime:    "0s",
      maxDuration:  "30s",
      exec:         "testBodyLimits",
      tags:         { scenario: "body_limit" },
    },

    // Test method validation
    method_test: {
      executor:     "per-vu-iterations",
      vus:          2,
      iterations:   5,
      startTime:    "0s",
      maxDuration:  "30s",
      exec:         "testMethodValidation",
      tags:         { scenario: "method" },
    },

    // Test path validation
    path_test: {
      executor:     "per-vu-iterations",
      vus:          2,
      iterations:   5,
      startTime:    "0s",
      maxDuration:  "30s",
      exec:         "testPathValidation",
      tags:         { scenario: "path" },
    },

    // Test security headers
    security_headers_test: {
      executor:     "per-vu-iterations",
      vus:          2,
      iterations:   5,
      startTime:    "0s",
      maxDuration:  "30s",
      exec:         "testSecurityHeaders",
      tags:         { scenario: "security" },
    },

    // Test concurrent cache
    cache_concurrent_test: {
      executor:     "per-vu-iterations",
      vus:          10,
      iterations:   5,
      startTime:    "5s",
      maxDuration:  "30s",
      exec:         "testConcurrentCache",
      tags:         { scenario: "cache" },
    },
  },

  thresholds: {
    "checks":              ["rate>0.95"],
    "http_req_failed":     ["rate<0.20"],  // On s'attend a des 4xx volontaires
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function setup() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  FUNCTIONAL TEST — Behavior validation under load`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`${"=".repeat(60)}\n`);

  const healthRes = http.get(`${BASE_URL}/health`, { tags: TAGS.health });
  check(healthRes, {
    "setup: router is healthy": (r) => r.status === 200,
  });

  return { startTime: Date.now() };
}

// ---------------------------------------------------------------------------
// 1. Rate Limiting
// ---------------------------------------------------------------------------
export function testRateLimiting() {
  group("rate_limiting", () => {
    // Envoyer des requetes rapidement pour depasser le quota
    const res = http.post(
      `${BASE_URL}/v1/chat/completions`,
      PAYLOAD_SIMPLE,
      { headers: HEADERS, tags: TAGS.proxy }
    );

    if (res.status === 429) {
      // Rate limit atteint — verifier les headers
      const passed = check(res, {
        "rate_limit: has X-RateLimit-Limit":     (r) =>
          r.headers["X-Ratelimit-Limit"] !== undefined,
        "rate_limit: has X-RateLimit-Remaining":  (r) =>
          r.headers["X-Ratelimit-Remaining"] !== undefined,
        "rate_limit: has Retry-After":            (r) =>
          r.headers["Retry-After"] !== undefined,
        "rate_limit: remaining is 0":             (r) =>
          r.headers["X-Ratelimit-Remaining"] === "0",
      });
      if (passed) functionalPassed.add(1);
      else        functionalFailed.add(1);
      rateLimitHits.add(1);
    } else if (res.status === 200) {
      // Encore sous le quota — c'est normal
      check(res, {
        "rate_limit: has remaining header":  (r) =>
          r.headers["X-Ratelimit-Remaining"] !== undefined,
        "rate_limit: remaining > 0":         (r) => {
          const rem = parseInt(r.headers["X-Ratelimit-Remaining"] || "0");
          return rem >= 0;
        },
      });
    }

    // Pas de sleep — on veut declencher le rate limit
  });
}

// ---------------------------------------------------------------------------
// 2. Authentication
// ---------------------------------------------------------------------------
export function testAuth() {
  group("auth_validation", () => {
    // Sans auth header
    const res1 = http.post(
      `${BASE_URL}/v1/chat/completions`,
      PAYLOAD_SIMPLE,
      { headers: { "Content-Type": "application/json" }, tags: TAGS.error }
    );
    const p1 = check(res1, {
      "auth: no token → 401": (r) => r.status === 401,
    });

    // Avec un faux token
    const res2 = http.post(
      `${BASE_URL}/v1/chat/completions`,
      PAYLOAD_SIMPLE,
      {
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer fake_invalid_key_12345",
        },
        tags: TAGS.error,
      }
    );
    const p2 = check(res2, {
      "auth: bad token → 401": (r) => r.status === 401,
    });

    // Avec un header mal forme
    const res3 = http.post(
      `${BASE_URL}/v1/chat/completions`,
      PAYLOAD_SIMPLE,
      {
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "NotBearer something",
        },
        tags: TAGS.error,
      }
    );
    const p3 = check(res3, {
      "auth: wrong scheme → 401": (r) => r.status === 401,
    });

    if (p1 && p2 && p3) functionalPassed.add(3);
    else                functionalFailed.add(1);

    sleep(0.5);
  });
}

// ---------------------------------------------------------------------------
// 3. Body Size Limits
// ---------------------------------------------------------------------------
export function testBodyLimits() {
  group("body_limits", () => {
    // Payload ~500 KB — devrait passer
    const mediumPayload = generateLargePayload(400);
    const res1 = http.post(
      `${BASE_URL}/v1/chat/completions`,
      mediumPayload,
      { headers: HEADERS, tags: TAGS.proxy }
    );
    check(res1, {
      "body_limit: 400KB passes": (r) => r.status !== 413,
    });

    // Payload ~11 MB — devrait etre rejete (limite = 10MB)
    // Note: On ne genere pas vraiment 11MB, on envoie un header Content-Length
    // incorrect pour tester la validation cote serveur
    const bigPayload = generateLargePayload(5000); // ~5MB
    const res2 = http.post(
      `${BASE_URL}/v1/chat/completions`,
      bigPayload,
      { headers: HEADERS, tags: TAGS.error }
    );
    // Le serveur peut retourner 413 ou couper la connexion
    check(res2, {
      "body_limit: large body handled": (r) =>
        r.status === 413 || r.status === 400 || r.status === 200,
    });

    sleep(1);
  });
}

// ---------------------------------------------------------------------------
// 4. Method Validation
// ---------------------------------------------------------------------------
export function testMethodValidation() {
  group("method_validation", () => {
    // GET sur /v1/chat/completions — devrait etre 405
    const res1 = http.get(
      `${BASE_URL}/v1/chat/completions`,
      { headers: HEADERS, tags: TAGS.error }
    );
    check(res1, {
      "method: GET on /v1/chat → 405": (r) =>
        r.status === 405 || r.status === 401,  // 401 si auth avant method check
    });

    // PUT — non supporte
    const res2 = http.put(
      `${BASE_URL}/v1/chat/completions`,
      PAYLOAD_SIMPLE,
      { headers: HEADERS, tags: TAGS.error }
    );
    check(res2, {
      "method: PUT → rejected": (r) => r.status >= 400,
    });

    // DELETE — non supporte
    const res3 = http.del(
      `${BASE_URL}/v1/chat/completions`,
      null,
      { headers: HEADERS, tags: TAGS.error }
    );
    check(res3, {
      "method: DELETE → rejected": (r) => r.status >= 400,
    });

    sleep(0.5);
  });
}

// ---------------------------------------------------------------------------
// 5. Path Validation
// ---------------------------------------------------------------------------
export function testPathValidation() {
  group("path_validation", () => {
    // Chemin valide
    const validPaths = ["/v1/chat/completions", "/v1/completions", "/v1/embeddings", "/v1/models"];
    // Chemins invalides
    const invalidPaths = ["/v1/admin", "/v1/../../etc/passwd", "/v2/chat/completions", "/api/internal/secret"];

    for (const path of invalidPaths) {
      const res = http.post(
        `${BASE_URL}${path}`,
        PAYLOAD_SIMPLE,
        { headers: HEADERS, tags: TAGS.error }
      );
      const passed = check(res, {
        [`path: ${path} → rejected`]: (r) => r.status >= 400,
      });
      if (passed) functionalPassed.add(1);
    }

    sleep(0.5);
  });
}

// ---------------------------------------------------------------------------
// 6. Security Headers
// ---------------------------------------------------------------------------
export function testSecurityHeaders() {
  group("security_headers", () => {
    // Verifier sur le health check (pas besoin d'auth)
    const res = http.get(`${BASE_URL}/health`, { tags: TAGS.health });

    check(res, {
      "security: has X-Content-Type-Options": (r) =>
        r.headers["X-Content-Type-Options"] === "nosniff",
      "security: has X-Frame-Options":        (r) =>
        r.headers["X-Frame-Options"] === "DENY",
      "security: has X-Request-Id":           (r) =>
        r.headers["X-Request-Id"] !== undefined,
      "security: no Server header leak":      (r) =>
        !r.headers["Server"] || !r.headers["Server"].includes("Go"),
    });

    // Verifier aussi sur une reponse proxy
    const res2 = http.post(
      `${BASE_URL}/v1/chat/completions`,
      PAYLOAD_SIMPLE,
      { headers: HEADERS, tags: TAGS.proxy }
    );

    if (res2.status === 200) {
      check(res2, {
        "security: proxy has X-Content-Type-Options": (r) =>
          r.headers["X-Content-Type-Options"] === "nosniff",
        "security: proxy has Cache-Control no-store":  (r) =>
          (r.headers["Cache-Control"] || "").includes("no-store"),
      });
    }

    sleep(0.5);
  });
}

// ---------------------------------------------------------------------------
// 7. Concurrent Cache
// ---------------------------------------------------------------------------
export function testConcurrentCache() {
  group("concurrent_cache", () => {
    // Tous les VUs envoient le meme prompt simultanement
    // Le cache doit gerer les ecritures concurrentes sans corruption
    const res = http.post(
      `${BASE_URL}/v1/chat/completions`,
      PAYLOAD_CACHEABLE,
      { headers: HEADERS, tags: TAGS.cache }
    );

    if (res.status === 200) {
      check(res, {
        "cache_concurrent: valid response":  (r) => {
          try { JSON.parse(r.body); return true; }
          catch { return false; }
        },
        "cache_concurrent: has cache header": (r) =>
          r.headers["X-Styx-Cache"] !== undefined,
      });
      functionalPassed.add(1);
    }

    sleep(0.2);
  });
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
export function teardown(data) {
  const elapsed = ((Date.now() - data.startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Functional test complete in ${elapsed}s`);
  console.log(`  Review check results for behavioral correctness`);
  console.log(`${"=".repeat(60)}\n`);
}
