import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("admin inventory", () => {
  test("manager can view batch intake and waste risk", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/inventory");
    await expect(page.getByRole("heading", { name: "Inventory batches" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Receive batch" })).toBeVisible();
    await expect(page.getByText("Expiry and waste risk")).toBeVisible();
  });

  test("staff cannot access inventory admin", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin/inventory");
    await expect(page).not.toHaveURL(/\/admin\/inventory$/);
  });
});
