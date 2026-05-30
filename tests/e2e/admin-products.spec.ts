import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

function row(page: Page, name: string) {
  return page.locator('[data-testid="product-row"]', { hasText: name });
}

test.describe("admin product CRUD", () => {
  test("manager creates, prices, and hides a product; public shop reflects it", async ({ page }) => {
    const name = `E2E Test Cut ${Date.now()}`;

    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/products");

    // Create
    await page.getByTestId("add-product-button").click();
    await page.getByTestId("new-product-name").fill(name);
    await page.getByTestId("new-product-price").fill("12.50");
    await page.getByTestId("new-product-submit").click();

    await expect(page.getByTestId("product-feedback")).toContainText("created");
    await expect(row(page, name)).toBeVisible();

    // Appears on the public shop (available by default).
    await page.goto("/shop");
    await expect(page.getByText(name, { exact: false })).toBeVisible();

    // Edit price and confirm it persists across a reload.
    await page.goto("/admin/products");
    const productRow = row(page, name);
    await productRow.getByTestId("product-price-input").fill("18.75");
    await productRow.getByTestId("product-save").click();
    await expect(page.getByTestId("product-feedback")).toContainText(/updated|Price/i);

    await page.reload();
    await expect(row(page, name).getByTestId("product-price-input")).toHaveValue("18.75");

    // Mark unavailable -> disappears from public shop.
    await row(page, name).getByTestId("product-availability-toggle").click();
    await expect(page.getByTestId("product-feedback")).toContainText(/Availability/i);
    await expect(row(page, name).getByTestId("product-availability-state")).toHaveText("Unavailable");

    await page.goto("/shop");
    await expect(page.getByText(name, { exact: false })).toHaveCount(0);
  });

  test("empty product name is rejected by the server action", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/products");

    await page.getByTestId("add-product-button").click();
    await page.getByTestId("new-product-name").fill("   ");
    await page.getByTestId("new-product-price").fill("5.00");
    await page.getByTestId("new-product-submit").click();

    await expect(page.getByTestId("product-feedback")).toContainText(/name is required/i);
  });

  test("staff cannot reach the product admin", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin/products");

    // Middleware redirects non-managers away from /admin/*.
    await expect(page).not.toHaveURL(/\/admin\/products/);
    await expect(page.getByTestId("add-product-button")).toHaveCount(0);
  });
});
