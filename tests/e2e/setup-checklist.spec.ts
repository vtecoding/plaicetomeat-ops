import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

// V7.0 setup checklist (/admin/setup): an owner-facing "ready to open?" list.
test.describe("setup checklist", () => {
  test("manager sees the grouped setup sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/setup");

    await expect(page.getByTestId("setup-checklist")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business setup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Product setup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Security setup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compliance setup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operations setup" })).toBeVisible();
  });

  test("only the owner sees the launch safety panel", async ({ page, browser }) => {
    await login(page, USERS.owner, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/setup");
    await expect(page.getByTestId("launch-safety")).toBeVisible();

    const managerCtx = await browser.newContext();
    const managerPage = await managerCtx.newPage();
    await login(managerPage, USERS.manager, { expectLanding: /\/admin\/today/ });
    await managerPage.goto("/admin/setup");
    await expect(managerPage.getByTestId("setup-checklist")).toBeVisible();
    await expect(managerPage.getByTestId("launch-safety")).toHaveCount(0);
    await managerCtx.close();
  });

  test("reachable from the Dad Mode home", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.getByRole("link", { name: "Setup checklist" }).click();
    await expect(page).toHaveURL(/\/admin\/setup/);
  });
});
