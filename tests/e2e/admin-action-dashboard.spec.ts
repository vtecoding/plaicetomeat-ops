import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("admin action dashboard", () => {
  test("shows stock, compliance, customer/order, and system health sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Owner Task List" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Opening Checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Closing Checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quick Wins" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock risk" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compliance risk" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Text Messages" })).toBeVisible();
    await expect(page.getByTestId("metric-awaiting-prep")).toBeVisible();
  });
});
