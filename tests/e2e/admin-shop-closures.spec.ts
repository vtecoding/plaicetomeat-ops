import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

/** A future date (YYYY-MM-DD) that falls on a given ISO weekday (1=Mon..7=Sun). */
function nextDateForIsoDow(targetDow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < 14; i += 1) {
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    if (dow === targetDow) break;
    d.setDate(d.getDate() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function closureRow(page: Page, date: string) {
  return page.locator(`[data-testid="closure-row"][data-date="${date}"]`);
}

test.describe("admin shop closures", () => {
  test("manager adds and removes a closure; it persists across reload", async ({ page }) => {
    // Wednesday is covered by the seeded Lunchtime (Mon–Sat) window.
    const closeDate = nextDateForIsoDow(3);

    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/shop-closures");

    await page.getByTestId("new-closure-date").fill(closeDate);
    await page.getByTestId("new-closure-submit").click();
    await expect(page.getByTestId("closure-feedback")).toContainText(/added/i);
    await expect(closureRow(page, closeDate)).toBeVisible();

    // Persists across reload (came from the database).
    await page.reload();
    await expect(closureRow(page, closeDate)).toBeVisible();

    // Remove it.
    await closureRow(page, closeDate).getByTestId("closure-remove").click();
    await expect(page.getByTestId("closure-feedback")).toContainText(/removed/i);
    await expect(closureRow(page, closeDate)).toHaveCount(0);

    await page.reload();
    await expect(closureRow(page, closeDate)).toHaveCount(0);
  });

  test("staff cannot reach shop-closure admin", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin/shop-closures");
    await expect(page).not.toHaveURL(/\/admin\/shop-closures/);
    await expect(page.getByTestId("new-closure-submit")).toHaveCount(0);
  });
});
