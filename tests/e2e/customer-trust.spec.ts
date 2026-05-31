import { expect, test } from "@playwright/test";

test.describe("customer trust", () => {
  test("homepage trust strip links to halal promise without overclaiming", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Supplier certs tracked")).toBeVisible();
    await page.getByRole("link", { name: "Our halal promise" }).click();
    await expect(page).toHaveURL(/\/our-halal-promise/);
    await expect(page.getByText(/We do not claim a specific certification body/)).toBeVisible();
  });

  test("product education tags render without blocking basket controls", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByText(/Best for curry|Best for grill|Lean option|Freezer friendly/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Add/ }).first()).toBeVisible();
  });
});
