import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V11.3 — /admin is the single analysis hub ("Business Insights"), analysis only.
// Operational sections (what needs attention / fixing, counter-service mode) moved
// to Today. The dev seed creates 3 real orders for today (24.98 + 35.00 + 18.49 =
// 78.47 revenue).
test.describe("business insights hub", () => {
  resetStateBeforeEach();

  test("shows analysis numbers from seeded orders, not operational boards", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");

    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review the business" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What happened today?" })).toBeVisible();
    await expect(page.getByTestId("metric-order-count")).toHaveText("3");
    await expect(page.getByTestId("metric-revenue")).toContainText("78.47");
    await expect(page.getByTestId("metric-expiring-certificates")).toBeVisible();

    // Operational boards and the duplicate counter no longer live here.
    await expect(page.getByRole("heading", { name: "What needs attention?" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What needs fixing?" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Counter-service mode" })).toHaveCount(0);
  });

  test("staff cannot reach the analysis hub", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin$/);
    await expect(page.getByTestId("owner-dashboard")).toHaveCount(0);
  });
});
