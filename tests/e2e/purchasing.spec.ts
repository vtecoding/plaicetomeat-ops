import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("purchasing & stock planning", () => {
  test("manager sees the purchasing decision-support page", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/purchasing");

    await expect(page.getByRole("heading", { name: "What should I order?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before you order" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before you place an order" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order guidance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check these before ordering" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What makes me money?" })).toHaveCount(0);
  });

  test("shows operator readiness and a back route to the dashboard", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/purchasing");

    await expect(page.getByTestId("order-readiness-note")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
  });
});
