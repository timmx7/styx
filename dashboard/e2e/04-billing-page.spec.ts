import { test, expect } from "@playwright/test";

// Register ONCE for the whole suite (avoids rate limiting: 3/min)
let accessToken: string;

test.beforeAll(async ({ request }) => {
  const email = `billing-${Date.now()}@styx-test.ai`;
  const password = "BillTest#123";

  const regRes = await request.post("http://localhost:8000/api/auth/register", {
    data: { email, password, name: "Bill Tester" },
  });
  const body = await regRes.json();
  accessToken = body.access_token;
});

test.describe("Billing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      {
        name: "styx_token",
        value: accessToken,
        domain: "localhost",
        path: "/",
      },
    ]);
  });

  test("billing page loads", async ({ page }) => {
    await page.goto("/billing");
    await page.waitForLoadState("networkidle");

    const body = await page.locator("body").textContent();
    expect(body).toBeTruthy();
    expect(body).not.toContain("Internal Server Error");
  });

  test("pricing models endpoint returns data", async ({ page }) => {
    const res = await page.request.get("http://localhost:8000/api/pricing/models");
    expect(res.status()).toBe(200);
    const models = await res.json();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty("input_price_per_million");
    expect(models[0]).toHaveProperty("output_price_per_million");
  });

  test("billing plans endpoint returns plans", async ({ page }) => {
    const res = await page.request.get("http://localhost:8000/api/billing/plans");
    expect(res.status()).toBe(200);
    const plans = await res.json();
    expect(plans.length).toBeGreaterThan(0);
  });
});
