import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("retired owner guide", () => {
  test("legacy guide links return to the simplified Work screen", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/guide");

    await expect(page).toHaveURL(/\/admin\/menu/);
    await expect(page.getByTestId("owner-menu")).toBeVisible();
  });

  test("Work exposes the four real business areas instead of a help directory", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.getByTestId("owner-menu-link").click();
    await expect(page.getByRole("heading", { name: "Money & orders" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Buying" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Suppliers & safety" })).toBeVisible();
  });
});
