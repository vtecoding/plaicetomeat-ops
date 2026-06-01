import { expect, test } from "@playwright/test";

const routes = [
  { path: "/", text: "PlaiceToMeat Wylde Green" },
  { path: "/shop", text: "Shop the counter" },
  { path: "/basket", text: "Basket" },
  { path: "/checkout", text: "Checkout" },
  { path: "/our-halal-promise", text: "Our halal promise" },
] as const;

test.describe("hosted smoke", () => {
  for (const route of routes) {
    test(`${route.path} renders`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByText(route.text).first()).toBeVisible();
    });
  }

  for (const path of ["/counter", "/admin", "/admin/releases", "/admin/compliance", "/admin/inventory"]) {
    test(`${path} is protected`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?returnTo=/);
    });
  }
});
