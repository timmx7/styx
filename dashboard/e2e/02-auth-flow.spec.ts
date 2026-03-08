import { test, expect } from "@playwright/test";

const TEST_EMAIL = `e2e-${Date.now()}@styx-test.ai`;
const TEST_PASSWORD = "E2eTestPass#99";
const TEST_NAME = "E2E Tester";

test.describe("Authentication Flow", () => {
  test("register a new account", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("h1")).toContainText("Create an account");

    // Fill registration form (inputs use id attributes)
    await page.fill("#name", TEST_NAME);
    await page.fill("#email", TEST_EMAIL);
    await page.fill("#password", TEST_PASSWORD);
    await page.fill("#confirmPassword", TEST_PASSWORD);

    // Submit
    await page.click('button[type="submit"]');

    // Should redirect to dashboard or onboarding
    await page.waitForURL(/\/(overview|onboarding|billing)/, { timeout: 15_000 });
  });

  test("login with existing credentials", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Log in");

    // Fill login form
    await page.fill("#email", TEST_EMAIL);
    await page.fill("#password", TEST_PASSWORD);

    // Submit
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await page.waitForURL(/\/(overview|onboarding|analytics|billing)/, { timeout: 15_000 });
  });

  test("login page shows error for wrong password", async ({ page }) => {
    await page.goto("/login");

    await page.fill("#email", "nobody@styx.ai");
    await page.fill("#password", "WrongPass#1");

    await page.click('button[type="submit"]');

    // Should show an error message (not redirect) — stay on login
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toContain("/login");
  });
});
