import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

// V7.0 Parts 11 & 12: a short how-to guide plus a printable dry-run script.
test.describe("owner guide", () => {
  test("manager sees the everyday job guides and the dry-run script", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/guide");

    await expect(page.getByTestId("owner-guide")).toBeVisible();
    await expect(page.getByRole("heading", { name: "How to handle an order" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How to add stock" })).toBeVisible();
    await expect(page.getByTestId("dry-run-script")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Full order test" })).toBeVisible();
  });

  test("reachable from the Dad Mode home", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.getByRole("link", { name: "Help & guide" }).click();
    await expect(page).toHaveURL(/\/admin\/guide/);
  });
});
