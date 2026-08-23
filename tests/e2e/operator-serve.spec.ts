import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

test.describe("V18 counted counter sales", () => {
  resetStateBeforeEach({ openShopDay: true });

  test("serves each and box lines with visible prices and a saved total", async ({ page }) => {
    await login(page, USERS.operator, { expectLanding: /\/operator$/ });
    await page.goto("/operator/serve");

    await page.getByRole("button", { name: "Whole Chicken", exact: true }).click();
    await expect(page.getByRole("heading", { name: "How many?", exact: true })).toBeVisible();
    await expect(page.getByTestId("serve-count-6")).toContainText("6 — ≈ £39.00");
    await page.getByTestId("serve-count-6").click();
    await expect(page.getByTestId("serve-line-summary")).toContainText("Whole Chicken ×6 — £39.00");
    await expect(page.getByTestId("serve-total")).toHaveText("Total £39.00");

    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page.getByRole("button", { name: "Family Curry Pack", exact: true }).click();
    await expect(page.getByRole("heading", { name: "How many boxes?", exact: true })).toBeVisible();
    await expect(page.getByTestId("serve-count-2")).toContainText("2 — ≈ £70.00");
    await page.getByTestId("serve-count-2").click();
    await expect(page.getByTestId("serve-line-summary")).toContainText("Family Curry Pack ×2 — £70.00");
    await expect(page.getByTestId("serve-total")).toHaveText("Total £109.00");

    await page.getByRole("button", { name: "No", exact: true }).click();
    await page.getByRole("button", { name: "Card", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Save this sale?" })).toBeVisible();
    await expect(page.getByTestId("serve-line-summary")).toContainText("Whole Chicken ×6 — £39.00");
    await expect(page.getByTestId("serve-line-summary")).toContainText("Family Curry Pack ×2 — £70.00");
    await expect(page.getByTestId("serve-total")).toHaveText("Total £109.00");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
    await expect(page.getByTestId("serve-saved-total")).toHaveText("Saved. Total £109.00.");
  });
});
