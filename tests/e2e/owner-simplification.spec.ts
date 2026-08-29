import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("simplified owner surface", () => {
  test("keeps four stable destinations and the main information", async ({ page }, testInfo) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

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
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    const mobileNav = page.locator('nav[aria-label="Staff tools"]:visible');
    for (const label of ["Today", "Work", "Review", "Settings"]) {
      await expect(mobileNav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
    await testInfo.attach("today-mobile", { body: await page.screenshot(), contentType: "image/png" });
  });
});
