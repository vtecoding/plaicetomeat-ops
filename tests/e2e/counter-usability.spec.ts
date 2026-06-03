import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

test.describe("counter usability", () => {
  resetStateBeforeEach();

  test("order cards show phone, age, notes count, SMS state, and no raw UUIDs", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/counter");
    const firstCard = page.locator("article").first();
    await expect(firstCard.getByRole("link", { name: /0\d{4}/ })).toBeVisible();
    await expect(firstCard.getByText(/(received|started|ready|collected) (just now|\d+ min ago)/i).first()).toBeVisible();
    await expect(firstCard.getByText(/Staff notes \(internal\) · \d+/)).toBeVisible();
    await expect(firstCard.getByTestId("sms-badge")).toBeVisible();
    await expect(firstCard).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });
});
