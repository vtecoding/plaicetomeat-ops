import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("admin action dashboard", () => {
  test("shows stock, compliance, customer/order, and system health sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Owner Actions" })).toBeVisible();
    await expect(page.getByText("Stock risk")).toBeVisible();
    await expect(page.getByText("Compliance risk")).toBeVisible();
    await expect(page.getByText("System health")).toBeVisible();
    await expect(page.getByTestId("metric-awaiting-prep")).toBeVisible();
  });
});
