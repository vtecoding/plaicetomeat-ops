import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, USERS } from "./helpers";

test.describe("Afghan Pashto Operator Mode", () => {
  test("persists locale, preserves workflow state, renders RTL, and returns to English", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/login?returnTo=/operator");

    await page.getByRole("button", { name: "پښتو", exact: true }).click();
    await expect(page.getByRole("heading", { name: "ننوځه" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.reload();
    await expect(page.getByRole("heading", { name: "ننوځه" })).toBeVisible();
    await page.fill('input[name="email"]', USERS.operator);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.getByRole("button", { name: "ننوځه", exact: true }).click();
    await page.waitForURL(/\/operator$/);

    const surface = page.locator('[data-operator-locale="ps-AF"]');
    await expect(surface).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("دوکان خلاص کړه", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: "test-results/operator-pashto-home-tablet.png", fullPage: true });

    await page.goto("/operator/serve");
    await expect(page.getByRole("heading", { name: "مشتري څه واخیستل؟" })).toBeVisible();
    await page.getByRole("button", { name: "یو بشپړ چرګ", exact: true }).click();
    await expect(page.getByRole("heading", { name: "څو دانې؟", exact: true })).toBeVisible();

    // Language changes presentation only; the in-progress Serve mode remains on amount selection.
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.getByRole("heading", { name: "How many?", exact: true })).toBeVisible();
    await expect(page.locator('[data-operator-locale="en"]')).toHaveAttribute("dir", "ltr");
    await page.getByRole("button", { name: "پښتو", exact: true }).click();
    await expect(page.getByRole("heading", { name: "څو دانې؟", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/operator-pashto-serve-tablet.png", fullPage: true });

    const routes: Array<[string, string]> = [
      ["/operator/open", "دوکان خلاص کړه"],
      ["/operator/close", "دوکان بند کړه"],
      ["/operator/stock", "راغلی مال یا مال نور نشته"],
      ["/operator/waste", "غورځول شوی مال"],
      ["/operator/till", "د کیش پیسې: دننه / بهر"],
      ["/operator/help", "څه ستونزه ده؟"],
      ["/operator/certificate", "دا کوم سند دی؟"],
    ];
    for (const [route, text] of routes) {
      await page.goto(route);
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      await expect(page.locator('[data-operator-locale="ps-AF"]')).toHaveAttribute("dir", "rtl");
    }

    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.locator('[data-operator-locale="en"]')).toHaveAttribute("dir", "ltr");
    await page.reload();
    await expect(page.getByRole("heading", { name: "What paper is it?" })).toBeVisible();
  });
});
