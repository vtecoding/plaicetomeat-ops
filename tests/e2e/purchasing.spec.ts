import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("purchasing & stock planning", () => {
  test("manager sees the purchasing decision-support page", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/purchasing");

    await expect(page.getByRole("heading", { name: "What should I order?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data quality" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before you place an order" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Buy more / buy less" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Products needing attention" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What makes me money?" })).toBeVisible();
  });

  test("shows an honest data-quality score and a back route to the dashboard", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/purchasing");

    // Data quality is shown as a percentage so the owner knows how far to trust the guidance.
    await expect(page.getByText(/^\d{1,3}%$/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
  });
});
