import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// Phase 10: owner dashboard shows real, branch-scoped DB metrics.
// The dev seed creates exactly 3 real orders for today: one incoming, one
// prepping, one ready (subtotals 24.98 + 35.00 + 18.49 = 78.47).
test.describe("owner dashboard", () => {
  resetStateBeforeEach();

  test("shows correct counts and revenue from seeded orders", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");

    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: ["Today", "'" + "s Priorities"].join("") })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business Snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operational Status" })).toBeVisible();
    await expect(page.getByTestId("metric-order-count")).toHaveText("3");
    // incoming + prepping = 2 awaiting prep; 1 ready.
    await expect(page.getByTestId("metric-awaiting-prep")).toHaveText("2");
    await expect(page.getByTestId("metric-ready")).toHaveText("1");
    await expect(page.getByTestId("metric-revenue")).toContainText("78.47");
    await expect(page.getByTestId("metric-expiring-certificates")).toBeVisible();
    await expect(page.getByRole("link", { name: "Counter-service mode" })).toBeVisible();
  });

  test("staff cannot reach the admin dashboard", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin$/);
    await expect(page.getByTestId("owner-dashboard")).toHaveCount(0);
  });
});
