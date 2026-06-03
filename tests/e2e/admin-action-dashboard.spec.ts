import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("admin action dashboard", () => {
  test("shows the new priority and insight sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "What needs attention?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's Focus" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What happened today?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What needs fixing?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where do I go next?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What should I watch?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "What stock do I have?" })).toBeVisible();
    await expect(page.getByTestId("metric-stock-risk")).toBeVisible();
  });

  test("surfaces the launch readiness panel", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Launch Readiness" })).toBeVisible();
  });
});
