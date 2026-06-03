import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("waste risk board", () => {
  test("shows honest risk summary on inventory page", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/inventory");
    await expect(page.getByText(/stock item.*Money at risk/).first()).toBeVisible();
  });
});
