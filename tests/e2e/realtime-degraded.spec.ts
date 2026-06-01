import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("realtime degraded mode", () => {
  test("counter can be switched to polling without showing a live badge", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/counter");
    await page.getByRole("button", { name: "Turn off auto-updates" }).click();
    await expect(page.getByText(/every 15s/)).toBeVisible();
    await expect(page.getByText("new orders appear on their own")).toHaveCount(0);
  });
});
