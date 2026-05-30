import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

function windowRow(page: Page, label: string) {
  return page.locator('[data-testid="window-row"]', { hasText: label });
}

test.describe("admin pickup windows", () => {
  test("disabling a window removes it from checkout; re-enabling restores it", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/pickup-windows");

    const target = windowRow(page, "Lunchtime");
    await expect(target).toBeVisible();

    // Confirm it is offered at checkout to begin with.
    await page.goto("/checkout");
    await expect(page.getByTestId("pickup-window-select")).toContainText("Lunchtime");

    // Disable it.
    await page.goto("/admin/pickup-windows");
    await windowRow(page, "Lunchtime").getByTestId("window-toggle-active").click();
    await expect(page.getByTestId("window-feedback")).toContainText(/disabled/i);
    await expect(windowRow(page, "Lunchtime").getByTestId("window-active-state")).toHaveText("Disabled");

    // It is no longer offered at checkout.
    await page.goto("/checkout");
    await expect(page.getByTestId("pickup-window-select")).not.toContainText("Lunchtime");

    // Re-enable it.
    await page.goto("/admin/pickup-windows");
    await windowRow(page, "Lunchtime").getByTestId("window-toggle-active").click();
    await expect(page.getByTestId("window-feedback")).toContainText(/enabled/i);

    await page.goto("/checkout");
    await expect(page.getByTestId("pickup-window-select")).toContainText("Lunchtime");
  });

  test("invalid pickup window (start after end) is rejected", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/pickup-windows");

    await page.getByTestId("add-window-button").click();
    await page.getByTestId("new-window-label").fill("Broken Window");
    await page.getByTestId("new-window-start").fill("15:00");
    await page.getByTestId("new-window-end").fill("14:00");
    await page.getByTestId("new-window-submit").click();

    await expect(page.getByTestId("window-feedback")).toContainText(/before end time/i);
  });

  test("staff cannot reach pickup-window admin", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin/pickup-windows");
    await expect(page).not.toHaveURL(/\/admin\/pickup-windows/);
    await expect(page.getByTestId("add-window-button")).toHaveCount(0);
  });
});
