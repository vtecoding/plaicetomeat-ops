import { expect, test } from "@playwright/test";

// V7.0 Part 7: the public homepage must use real catalogue/branch data and must
// not advertise staff-only shortcuts to customers.
test.describe("storefront homepage", () => {
  test("shows the shop call to action without a staff counter shortcut", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Shop click-and-collect" })).toBeVisible();
    // No public link advertising the staff counter dashboard.
    await expect(page.getByRole("link", { name: "Open counter dashboard" })).toHaveCount(0);
  });

  test("featured products come from the catalogue or show a safe empty state", async ({ page }) => {
    await page.goto("/");

    const productLinks = page.locator('a[href^="/product/"]');
    const emptyState = page.getByText("Our online shop is being prepared.");

    const productCount = await productLinks.count();
    if (productCount === 0) {
      await expect(emptyState).toBeVisible();
    } else {
      // Real products link to a real product page (no fake "ready today" claim).
      await expect(productLinks.first()).toBeVisible();
      await expect(page.getByText("Ready for pickup windows today.")).toHaveCount(0);
    }
  });
});
