import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("cutting & pricing guide", () => {
  test("breaks a carcass down into priced cuts and teaches the real meat cost", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");

    await expect(page.getByRole("heading", { name: "What's a whole animal worth?" })).toBeVisible();

    // Lamb is the default; enter what was paid for the carcass.
    await page.getByPlaceholder("e.g. 108").fill("108");

    // The key teaching numbers and the rookie-mistake warning appear.
    await expect(page.getByText("Your REAL meat cost", { exact: true })).toBeVisible();
    await expect(page.getByText(/you'd\s+lose/i).first()).toBeVisible();

    // A real cut shows with a suggested price and best use.
    await expect(page.getByRole("heading", { name: "Leg" })).toBeVisible();
    await expect(page.getByText("Suggested price").first()).toBeVisible();
  });
});
