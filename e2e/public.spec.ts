import { expect, test } from "@playwright/test";

test("public shop is visible and staff routes are protected", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "PlaiceToMeat Wylde Green" })).toBeVisible();
  await expect(page.getByText("Pay at the counter on collection.", { exact: true })).toBeVisible();

  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: "Shop the counter" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chicken Breast Fillets" })).toBeVisible();

  await page.goto("/counter");
  await expect(page).toHaveURL("/");
});
