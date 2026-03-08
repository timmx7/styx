import { test, expect } from "@playwright/test";

// Register ONCE for the whole suite (avoids rate limiting: 3/min)
let accessToken: string;

test.beforeAll(async ({ request }) => {
  const email = `nav-${Date.now()}@styx-test.ai`;
  const password = "NavTest#123";

  const regRes = await request.post("http://localhost:8000/api/auth/register", {
    data: { email, password, name: "Nav Tester" },
  });
  const body = await regRes.json();
  accessToken = body.access_token;
});

test.describe("Dashboard Navigation", () => {
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

  const pages = [
    { path: "/overview", label: "Overview" },
    { path: "/analytics", label: "Analytics" },
    { path: "/projects", label: "Projects" },
    { path: "/keys", label: "API Keys" },
    { path: "/logs", label: "Logs" },
    { path: "/billing", label: "Billing" },
    { path: "/alerts", label: "Alerts" },
  ];

  for (const { path, label } of pages) {
    test(`${label} page (${path}) loads without error`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // Page should not show a 500 error or blank body
      const body = await page.locator("body").textContent();
      expect(body).toBeTruthy();
      expect(body).not.toContain("Internal Server Error");
      expect(body).not.toContain("Application error");
    });
  }
});
