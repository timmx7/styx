import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("loads with correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Styx/i);
  });

  test("hero section is visible", async ({ page }) => {
    await page.goto("/");
    // The landing page should have a prominent heading
    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();
  });

  test("CTA buttons are present", async ({ page }) => {
    await page.goto("/");
    // Should have at least one link to /register or /login or Get Started
    const ctaLink = page.locator(
      'a[href*="register"], a[href*="login"], a[href*="dashboard"]'
    );
    await expect(ctaLink.first()).toBeVisible();
  });

  test("no console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Filter out known non-critical errors (favicon, HMR)
    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("HMR") && !e.includes("hydration")
    );
    expect(critical).toHaveLength(0);
  });
});
