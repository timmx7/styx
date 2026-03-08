// ============================================================================
// k6 Load Testing — Configuration partagee
//
// Centralise toutes les constantes, URLs, headers, et payloads utilises
// par les differents scenarios de test. Un seul endroit a modifier.
// ============================================================================

// ---------------------------------------------------------------------------
// Environnement — surcharge via variables d'env k6
// ---------------------------------------------------------------------------
export const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
export const API_KEY  = __ENV.API_KEY  || "sk_styx_test_key_for_load_testing";

// Backend direct (pour les checks de sante backend)
export const BACKEND_URL = __ENV.BACKEND_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Headers standard
// ---------------------------------------------------------------------------
export const HEADERS = {
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${API_KEY}`,
};

export const HEADERS_NO_AUTH = {
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// Thresholds — seuils de performance
//
// Le router Go doit ajouter <10ms d'overhead. Puisqu'on teste en local
// (pas de vrai appel provider), les reponses mockees doivent etre ultra-rapides.
// En production avec des vrais providers, seul l'overhead du router compte.
// ---------------------------------------------------------------------------
export const THRESHOLDS = {
  // -- Latence globale --
  "http_req_duration":              ["p(95)<500", "p(99)<1000"],
  // -- Latence du router uniquement (hors provider) --
  "http_req_duration{type:health}": ["p(95)<10",  "p(99)<20"],
  "http_req_duration{type:proxy}":  ["p(95)<100", "p(99)<200"],
  // -- Taux de reussite --
  "http_req_failed":                ["rate<0.01"],  // <1% d'erreurs
  "checks":                         ["rate>0.99"],  // 99%+ des checks passent
  // -- Throughput minimum --
  "http_reqs":                      ["rate>50"],    // Au moins 50 req/s
};

// Thresholds stricts pour le smoke test
export const THRESHOLDS_SMOKE = {
  "http_req_duration":              ["p(95)<200", "p(99)<500"],
  "http_req_duration{type:health}": ["p(95)<5",   "p(99)<10"],
  "http_req_failed":                ["rate<0.001"],
  "checks":                         ["rate>0.999"],
};

// Thresholds pour le stress test (plus tolerants)
export const THRESHOLDS_STRESS = {
  "http_req_duration":              ["p(95)<2000", "p(99)<5000"],
  "http_req_duration{type:health}": ["p(95)<50",   "p(99)<100"],
  "http_req_failed":                ["rate<0.10"],  // Jusqu'a 10% acceptable sous stress
  "checks":                         ["rate>0.90"],
};

// ---------------------------------------------------------------------------
// Payloads — requetes types pour tester differents scenarios
// ---------------------------------------------------------------------------

// Prompt simple — devrait etre route vers un modele "light"
export const PAYLOAD_SIMPLE = JSON.stringify({
  model:      "gpt-4o-mini",
  messages:   [{ role: "user", content: "Say hello" }],
  max_tokens: 10,
  stream:     false,
});

// Prompt moyen — modele "medium"
export const PAYLOAD_MEDIUM = JSON.stringify({
  model:    "gemini-1.5-pro",
  messages: [
    { role: "system", content: "You are a helpful coding assistant." },
    { role: "user",   content: "Explain the difference between a mutex and a semaphore in Go. Provide code examples." },
  ],
  max_tokens: 500,
  stream:     false,
});

// Prompt complexe — modele "heavy"
export const PAYLOAD_COMPLEX = JSON.stringify({
  model:    "gpt-4o",
  messages: [
    { role: "system", content: "You are an expert software architect." },
    { role: "user",   content: "Design a distributed event sourcing system with CQRS for a banking application handling 100K transactions per second. Include failure modes, consistency guarantees, and a complete architecture diagram description." },
  ],
  max_tokens: 2000,
  stream:     false,
});

// Streaming — pour tester le support SSE
export const PAYLOAD_STREAM = JSON.stringify({
  model:      "gpt-4o-mini",
  messages:   [{ role: "user", content: "Count from 1 to 10" }],
  max_tokens: 100,
  stream:     true,
});

// Embeddings — endpoint different
export const PAYLOAD_EMBEDDINGS = JSON.stringify({
  model: "text-embedding-ada-002",
  input: "The quick brown fox jumps over the lazy dog",
});

// Prompt identique pour tester le cache semantique
export const PAYLOAD_CACHEABLE = JSON.stringify({
  model:      "gpt-4o-mini",
  messages:   [{ role: "user", content: "What is the capital of France?" }],
  max_tokens: 50,
  stream:     false,
});

// Body enorme pour tester les limites (~ 1 MB)
export function generateLargePayload(sizeKb = 500) {
  const filler = "x".repeat(1024); // 1 KB de contenu
  const lines  = [];
  for (let i = 0; i < sizeKb; i++) {
    lines.push(filler);
  }
  return JSON.stringify({
    model:      "gpt-4o",
    messages:   [{ role: "user", content: lines.join("\n") }],
    max_tokens: 10,
    stream:     false,
  });
}

// ---------------------------------------------------------------------------
// Tags k6 pour segmenter les metriques
// ---------------------------------------------------------------------------
export const TAGS = {
  health:     { type: "health"     },
  proxy:      { type: "proxy"      },
  stream:     { type: "stream"     },
  cache:      { type: "cache"      },
  embeddings: { type: "embeddings" },
  metrics:    { type: "metrics"    },
  error:      { type: "error"      },
};
