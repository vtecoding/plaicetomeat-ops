import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("realtime degraded mode", () => {
  test("counter can be switched to polling without showing a live badge", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/counter");
    await page.getByRole("button", { name: "Use polling" }).click();
    await expect(page.getByText(/Polling every 15s/)).toBeVisible();
    await expect(page.getByText("Realtime connected")).toHaveCount(0);
  });
});
