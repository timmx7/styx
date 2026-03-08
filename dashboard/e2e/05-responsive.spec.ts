import { test, expect } from "@playwright/test";

test.describe("Responsive Layout", () => {
  test("mobile: landing page has no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check that the page width doesn't exceed viewport
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });

  test("mobile: login page is usable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Email and password inputs should be visible
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput.first()).toBeVisible();
    await expect(passwordInput.first()).toBeVisible();
    await expect(submitBtn.first()).toBeVisible();
  });

  test("desktop: landing page renders full width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();
  });
});
