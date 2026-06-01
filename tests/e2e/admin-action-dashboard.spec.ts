import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("admin action dashboard", () => {
  test("shows the new priority and insight sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Today's Priorities" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's Focus" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business Snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operational Status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quick Actions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business Insights" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Stock & Waste" })).toBeVisible();
    await expect(page.getByTestId("metric-stock-risk")).toBeVisible();
  });

  test("surfaces the launch readiness panel", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Launch Readiness" })).toBeVisible();
  });
});
