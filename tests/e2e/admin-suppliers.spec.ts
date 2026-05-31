import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("admin supplier compliance", () => {
  test("manager can view supplier compliance tools", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/compliance");
    await expect(page.getByRole("heading", { name: "Supplier compliance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Record supplier certificate" })).toBeVisible();
  });

  test("staff cannot access supplier compliance admin", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin/compliance");
    await expect(page).not.toHaveURL(/\/admin\/compliance$/);
  });
});
