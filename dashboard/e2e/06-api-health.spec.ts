import { test, expect } from "@playwright/test";

test.describe("API Health & Integration", () => {
  test("backend health endpoint is reachable", async ({ page }) => {
    const res = await page.request.get("http://localhost:8000/health");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  test("router health shows providers", async ({ page }) => {
    const res = await page.request.get("http://localhost:8080/health");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.providers).toBeDefined();
    // At minimum OpenAI should be healthy
    expect(data.providers.openai?.status).toBe("healthy");
  });

  test("OpenAPI schema is available", async ({ page }) => {
    const res = await page.request.get("http://localhost:8000/openapi.json");
    expect(res.status()).toBe(200);
    const schema = await res.json();
    expect(schema.info).toBeDefined();
    expect(Object.keys(schema.paths).length).toBeGreaterThan(50);
  });

  test("proxy rejects requests without API key", async ({ page }) => {
    const res = await page.request.post("http://localhost:8080/v1/chat/completions", {
      data: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      },
    });
    expect(res.status()).toBe(401);
    const data = await res.json();
    expect(data.error.type).toBe("missing_api_key");
  });
});
