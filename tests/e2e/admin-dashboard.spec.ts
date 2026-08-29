import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// /admin is the periodic Review. It preserves the important business outcomes
// without competing with Today or exposing internal scores and tool directories.
test.describe("periodic owner review", () => {
  resetStateBeforeEach();

  test("shows business outcomes, not a second operational dashboard", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");

    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review the business" })).toBeVisible();
    for (const heading of ["Sales", "Stock", "Waste", "Buying", "Customers", "Suppliers & safety"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    // Operational boards and the duplicate counter no longer live here.
    await expect(page.getByRole("heading", { name: "What needs attention?" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What needs fixing?" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Do now" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Counter-service mode" })).toHaveCount(0);
  });

  test("staff cannot reach owner Review", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin$/);
    await expect(page.getByTestId("owner-dashboard")).toHaveCount(0);
  });
});
