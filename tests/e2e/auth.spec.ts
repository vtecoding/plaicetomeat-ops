import { expect, test } from "@playwright/test";

import { expectNoBackOfficeNav, login, logout, USERS } from "./helpers";

test.describe("authentication", () => {
  test("public header hides back-office links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Staff login" }).first()).toBeVisible();
    await expectNoBackOfficeNav(page);
  });

  test("manager can log in and reach /admin", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("link", { name: "Admin", exact: true }).first()).toBeVisible();
  });

  test("staff can log in and reach /counter", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await expect(page).toHaveURL(/\/counter/);
    await expect(page.getByRole("link", { name: "Counter", exact: true }).first()).toBeVisible();
    // staff must NOT see the Admin link
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  });

  test("owner can reach both /admin and /counter", async ({ page }) => {
    await login(page, USERS.owner, { expectLanding: /\/admin/ });
    await page.goto("/counter");
    await expect(page).toHaveURL(/\/counter/);
  });

  test("manager can also reach /counter", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/counter");
    await expect(page).toHaveURL(/\/counter/);
  });

  test("staff cannot reach /admin", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin");
    // denied — bounced away from /admin
    await expect(page).not.toHaveURL(/\/admin$/);
  });

  test("failed login shows a safe, non-enumerating error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "owner@ptm.test");
    await page.fill('input[name="password"]', "wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    // Same generic message for a non-existent user (no enumeration).
    await page.fill('input[name="email"]', "nobody@ptm.test");
    await page.fill('input[name="password"]', "whatever");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("inactive account cannot sign in", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', USERS.inactive);
    await page.fill('input[name="password"]', "PlaiceTest123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("logout removes access and protected URL fails afterwards", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await logout(page);

    await page.goto("/counter");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sanitised returnTo sends an authorised user to their target", async ({ page }) => {
    await page.goto("/counter/compliance");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcounter%2Fcompliance/);
    await page.fill('input[name="email"]', USERS.staff);
    await page.fill('input[name="password"]', "PlaiceTest123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/counter\/compliance/);
  });
});
