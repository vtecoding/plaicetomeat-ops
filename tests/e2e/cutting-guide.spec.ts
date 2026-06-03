import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("cutting & pricing guide", () => {
  test("renders the simple calculator before showing pricing detail", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");

    await expect(page.getByRole("heading", { name: "What's a whole animal worth?" })).toBeVisible();
    await expect(page.getByTestId("calculate-selling-prices")).toBeVisible();
    await expect(page.getByTestId("pricing-helper-panel")).toBeVisible();
    await expect(page.getByText("How this helps")).toBeVisible();
    await expect(page.getByTestId("pricing-result-summary")).toHaveCount(0);
    await expect(page.getByTestId("recommended-price-cards")).toHaveCount(0);
    await expect(page.getByTestId("cut-map-panel")).toHaveCount(0);
    await expect(page.getByTestId("retail-tip-panel")).toHaveCount(0);
  });

  test("calculation shows result summary and recommended price cards", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");

    await page.getByPlaceholder("e.g. 108").fill("108");
    await page.getByTestId("calculate-selling-prices").click();

    await expect(page.getByTestId("pricing-result-summary")).toBeVisible();
    await expect(page.getByText("Real meat cost", { exact: true })).toBeVisible();
    await expect(page.getByText("Do not price from carcass cost")).toBeVisible();
    await expect(page.getByTestId("recommended-price-cards")).toBeVisible();
    await expect(page.getByTestId("cut-row-leg")).toContainText("Suggested price");
    await expect(page.getByText("Smart retail tips")).toHaveCount(0);
  });

  test("cut map opens only after viewing a cut and highlights the selected region", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");
    await page.getByPlaceholder("e.g. 108").fill("108");
    await page.getByTestId("calculate-selling-prices").click();

    await expect(page.getByTestId("cut-map-panel")).toHaveCount(0);
    await page.getByTestId("cut-row-leg").getByRole("button", { name: "View cut" }).click();

    const dialog = page.getByRole("dialog", { name: /Leg of lamb/i });
    await expect(dialog).toBeVisible();

    // Commercial facts lead the modal, before the map.
    await expect(dialog.getByTestId("cut-detail-price")).toContainText("/kg");
    await expect(dialog.getByTestId("cut-detail-price")).toContainText("recommended");
    await expect(dialog.getByTestId("cut-detail-facts")).toContainText("Difficulty:");
    await expect(dialog.getByTestId("cut-detail-facts")).toContainText("Use:");

    await expect(page.getByTestId("cut-map-panel")).toBeVisible();
    await expect(page.getByTestId("cut-map-region-leg")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("selected-cut-region")).toContainText("Selected region: Leg");

    // Escape closes the modal.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("advanced product mapping is hidden by default", async ({ page }) => {
    const name = `V6.3 Costed Cut ${Date.now()}`;

    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/products");
    await page.getByTestId("add-product-button").click();
    await page.getByTestId("new-product-name").fill(name);
    await page.getByTestId("new-product-price").fill("1.00");
    await page.getByTestId("new-product-submit").click();
    await expect(page.getByTestId("product-feedback")).toContainText("created");

    await page.goto("/admin/cutting-guide");
    await page.getByPlaceholder("e.g. 108").fill("108");
    await page.getByTestId("calculate-selling-prices").click();

    await expect(page.getByTestId("commit-product-select")).toHaveCount(0);
    await page.getByRole("button", { name: /Advanced: connect cuts to products/i }).click();
    await expect(page.getByTestId("commit-product-select").first()).toBeVisible();

    const legAdvancedRow = page.getByTestId("advanced-product-row-leg");
    await legAdvancedRow.getByTestId("commit-product-select").selectOption({ label: name });
    await legAdvancedRow.getByTestId("commit-product-save").click();
    await expect(legAdvancedRow.getByText("Saved price and cost to product.")).toBeVisible();

    await page.goto("/admin/products");
    await expect(page.locator('[data-testid="product-row"]', { hasText: name }).getByTestId("product-price-input")).toHaveValue("9.82");
  });

  test("carcass intake confirms, creates stock and updates a linked product", async ({ page }) => {
    const name = `V6.4 Intake Lamb Leg ${Date.now()}`;

    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/products");
    await page.getByTestId("add-product-button").click();
    await page.getByTestId("new-product-name").fill(name);
    await page.getByTestId("new-product-price").fill("1.00");
    await page.getByTestId("new-product-submit").click();
    await expect(page.getByTestId("product-feedback")).toContainText("created");

    await page.goto("/admin/cutting-guide");
    await page.getByPlaceholder("e.g. 108").fill("108");
    await page.getByTestId("calculate-selling-prices").click();

    // Intake panel appears after calculation; open it (progressive disclosure).
    await expect(page.getByTestId("carcass-intake-panel")).toBeVisible();
    await page.getByTestId("carcass-intake-toggle").click();

    // Map the leg cut to the new product and choose to update its public price.
    await page.getByTestId("intake-product-leg").selectOption({ label: name });
    await page.getByTestId("intake-update-price-leg").check();

    // Preview must show the stock line and flag the still-unmapped cuts for review.
    await expect(page.getByTestId("intake-preview")).toContainText("Create stock for");
    await expect(page.getByTestId("intake-review-note")).toContainText("need a product");

    await page.getByTestId("confirm-intake").click();

    await expect(page.getByTestId("intake-confirmed")).toBeVisible();
    await expect(page.getByTestId("intake-confirmed")).toContainText("Stock created for 1 cut");
    // No second confirm button — duplicate confirmation is blocked at the UI.
    await expect(page.getByTestId("confirm-intake")).toHaveCount(0);

    // The linked product's price now reflects the confirmed intake.
    await page.goto("/admin/products");
    await expect(
      page.locator('[data-testid="product-row"]', { hasText: name }).getByTestId("product-price-input"),
    ).toHaveValue("9.82");
  });

  test("animal switching keeps the professional map stable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");

    await page.getByLabel("Animal").selectOption("chicken");
    await page.getByPlaceholder("e.g. 108").fill("4");
    await page.getByTestId("calculate-selling-prices").click();
    await page.getByTestId("cut-row-breast").getByRole("button", { name: "View cut" }).click();

    await expect(page.getByTestId("cut-map-panel")).toBeVisible();
    await expect(page.getByTestId("cut-map-region-breast")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Cut map unavailable for this animal yet.")).toHaveCount(0);
  });

  test("accounts for chiller shrinkage in the real meat cost", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");

    await page.getByPlaceholder("e.g. 108").fill("108");
    await page.getByLabel("Days hung in chiller").fill("3");
    await page.getByTestId("calculate-selling-prices").click();

    await expect(page.getByText(/Hung 3 days: .* moisture loss/i)).toBeVisible();
    await expect(page.getByText(/you are cutting/i)).toBeVisible();
  });
});
