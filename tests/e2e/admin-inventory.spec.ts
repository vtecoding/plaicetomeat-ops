import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("admin inventory", () => {
  test("manager can view batch intake and waste risk", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/inventory");
    await expect(page.getByRole("heading", { name: "Stock", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add stock" })).toBeVisible();
    await expect(page.getByText("Use this stock first")).toBeVisible();
    await expect(page.getByText("What did we actually get?")).toBeVisible();
  });

  test("staff cannot access inventory admin", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin/inventory");
    await expect(page).not.toHaveURL(/\/admin\/inventory$/);
  });
});
