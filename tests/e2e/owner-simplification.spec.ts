import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

async function openOwnerToday(page: Parameters<typeof login>[0]) {
  // Manager profiles may be intentionally locked to operator mode in production.
  // Owners can always enter the owner console, whose default post-login landing
  // remains the simple operator home.
  await login(page, USERS.owner, { expectLanding: /\/operator/ });
  await page.goto("/admin/today");
  await page.waitForURL(/\/admin\/today/);
}

test.describe("simplified owner surface", () => {
  test("keeps four stable destinations and the main information", async ({ page }, testInfo) => {
    await openOwnerToday(page);

    await expect(page.getByRole("heading", { name: "What needs you today" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Work", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
    await testInfo.attach("today-desktop", { body: await page.screenshot(), contentType: "image/png" });

    await page.getByRole("link", { name: "Work", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Choose the job" })).toBeVisible();
    for (const heading of ["Money & orders", "Stock", "Buying", "Suppliers & safety"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    await page.getByRole("link", { name: "Review", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review the business" })).toBeVisible();
    for (const heading of ["Sales", "Stock", "Waste", "Buying", "Customers", "Suppliers & safety"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Catalog & prices/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Shop schedule/ })).toBeVisible();
  });

  test("makes all four destinations visible on a phone", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOwnerToday(page);

    const mobileNav = page.locator('nav[aria-label="Staff tools"]:visible');
    for (const label of ["Today", "Work", "Review", "Settings"]) {
      await expect(mobileNav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
    await testInfo.attach("today-mobile", { body: await page.screenshot(), contentType: "image/png" });
  });
});
