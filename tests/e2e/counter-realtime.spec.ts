import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

function columnSection(page: Page, label: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: label, exact: true }) });
}

test.describe("counter realtime", () => {
  test("a status change in one context appears in another within 3s", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await login(pageA, USERS.staff, { expectLanding: /\/counter/ });
    await login(pageB, USERS.staff, { expectLanding: /\/counter/ });

    // Both should establish a real realtime connection (badge reflects state).
    await expect(pageA.getByText("Realtime connected")).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText("Realtime connected")).toBeVisible({ timeout: 15_000 });

    // Move PTM-2026-90002 (prepping) -> ready in context A.
    const cardA = columnSection(pageA, "Prepping").locator("article", { hasText: "PTM-2026-90002" });
    await expect(cardA).toBeVisible();
    await cardA.getByRole("button", { name: "Mark Ready" }).click();

    // Context B should reflect it without a manual refresh.
    await expect(columnSection(pageB, "Ready").locator("article", { hasText: "PTM-2026-90002" })).toBeVisible({
      timeout: 3_000,
    });

    // No duplicate cards after the realtime refetch.
    await expect(pageB.locator("article", { hasText: "PTM-2026-90002" })).toHaveCount(1);

    await contextA.close();
    await contextB.close();
  });

  test("manual degradation flips the badge to polling honestly", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await expect(page.getByText("Realtime connected")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Use polling" }).click();
    await expect(page.getByText(/Polling every 15s/)).toBeVisible();
    await expect(page.getByText("Realtime connected")).toHaveCount(0);
  });
});
