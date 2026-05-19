import { test, expect } from "@playwright/test";

/**
 * Prerequisites to run this test:
 * - LINKEDIN_SEND_MODE=mock set in the test environment
 * - A seeded DB with at least 1 authenticated user, 2 contacts, 1 template
 * - Dev server running (baseURL in playwright.config.ts)
 */
test.describe("Campaign flow (mock mode)", () => {
  test.skip(process.env.CI !== "e2e", "Only runs in e2e CI environment with seeded DB");

  test("create and run a LinkedIn campaign", async ({ page }) => {
    await page.goto("/dashboard");
    // Select first two contacts
    await page.getByRole("checkbox").first().check();
    await page.getByRole("checkbox").nth(1).check();
    // Open campaign modal
    await page.getByRole("button", { name: /send campaign/i }).click();
    // Fill campaign name
    await page.getByPlaceholder(/e\.g\. CTO outreach/i).fill("E2E Test Campaign");
    // Submit
    await page.getByRole("button", { name: /send campaign/i }).last().click();
    // Should navigate to detail page
    await expect(page).toHaveURL(/\/campaigns\/[a-z0-9]+/, { timeout: 15_000 });
    // Campaign should enter RUNNING or COMPLETED
    await expect(page.getByText(/RUNNING|COMPLETED/)).toBeVisible({ timeout: 30_000 });
  });
});
