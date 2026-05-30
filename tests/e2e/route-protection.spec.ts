import { expect, test } from "@playwright/test";

import { expectNoBackOfficeNav, login, USERS } from "./helpers";

const MANAGER_ONLY = [
  "/admin",
  "/admin/products",
  "/admin/pickup-windows",
  "/admin/shop-closures",
  "/admin/orders",
  "/admin/settings",
];

const STAFF_FACING = ["/counter", "/counter/compliance", ...MANAGER_ONLY];

test.describe("route protection", () => {
  test("unauthenticated users are redirected to login for every back-office route", async ({ page }) => {
    for (const path of STAFF_FACING) {
      await page.goto(path);
      await expect(page, `expected ${path} to redirect to /login`).toHaveURL(/\/login/);
    }
  });

  test("staff cannot reach any manager-only route", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    for (const path of MANAGER_ONLY) {
      await page.goto(path);
      await expect(page, `staff should not reach ${path}`).not.toHaveURL(new RegExp(path.replace(/\//g, "\\/") + "$"));
    }
  });

  test("public pages never leak back-office navigation", async ({ page }) => {
    for (const path of ["/", "/shop", "/basket"]) {
      await page.goto(path);
      await expectNoBackOfficeNav(page);
    }
  });

  test("manager sees Admin nav; plain staff does not", async ({ page, browser }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/counter");
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toBeVisible();

    const staffCtx = await browser.newContext();
    const staffPage = await staffCtx.newPage();
    await login(staffPage, USERS.staff, { expectLanding: /\/counter/ });
    await expect(staffPage.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    await staffCtx.close();
  });
});
