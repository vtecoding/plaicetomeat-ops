import { expect, test } from "@playwright/test";

import { expectNoBackOfficeNav } from "./helpers";

test.describe("halal promise", () => {
  test("loads publicly without exposing supplier contact details", async ({ page }) => {
    await page.goto("/our-halal-promise");
    await expect(page.getByRole("heading", { name: "Our halal promise" })).toBeVisible();
    await expect(
      page.getByText("Supplier certification records are being added").or(page.getByRole("heading", { name: "Midlands Halal Poultry" })),
    ).toBeVisible();
    await expect(page.getByText(/phone|email|address|internal notes/i)).toHaveCount(0);
    await expectNoBackOfficeNav(page);
  });
});
