import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test.describe("cutting & pricing guide", () => {
  test("breaks a carcass down into priced cuts and teaches the real meat cost", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");

    await expect(page.getByRole("heading", { name: "What's a whole animal worth?" })).toBeVisible();

    // Lamb is the default; enter what was paid for the carcass.
    await page.getByPlaceholder("e.g. 108").fill("108");

    // The key teaching numbers and the rookie-mistake warning appear.
    await expect(page.getByText("Your REAL meat cost", { exact: true })).toBeVisible();
    await expect(page.getByText(/you'd\s+lose/i).first()).toBeVisible();

    // A real cut shows with a suggested price and best use.
    await expect(page.getByRole("heading", { name: "Leg" })).toBeVisible();
    await expect(page.getByText("Suggested price").first()).toBeVisible();

    // Overall margin (master slider readout) is shown.
    await expect(page.getByText("Overall margin")).toBeVisible();

    // V6.2 guardrail layer appears inside the same protected pricing workflow.
    await expect(page.getByTestId("cut-map-panel")).toBeVisible();
    await expect(page.getByTestId("yield-guardrail-panel")).toBeVisible();
    await expect(page.getByTestId("retail-tip-panel")).toBeVisible();
  });

  test("accounts for chiller shrinkage in the real meat cost", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");
    await page.getByPlaceholder("e.g. 108").fill("108");

    // Hang the lamb for 3 days — water-loss line should appear.
    await page.getByPlaceholder("0", { exact: true }).fill("3");
    await expect(page.getByText(/lost/i).first()).toBeVisible();
    await expect(page.getByText(/water/i).first()).toBeVisible();
  });

  test("selecting a cut highlights the matching map region", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");
    await page.getByPlaceholder("e.g. 108").fill("108");

    await page.getByRole("button", { name: "Select Rack / best end on cut map" }).click();
    await expect(page.getByTestId("cut-map-region-rack")).toHaveAttribute("fill", "#0f5132");
    await expect(page.getByText("Region: Rack")).toBeVisible();
  });

  test("animal switching keeps V6.2 guidance stable on mobile-sized maps", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin/cutting-guide");

    await page.getByRole("button", { name: "Chicken" }).click();
    await page.getByPlaceholder("e.g. 108").fill("4");

    await expect(page.getByTestId("cut-map-panel")).toBeVisible();
    await expect(page.getByTestId("yield-guardrail-panel")).toBeVisible();
    await expect(page.getByText("No animal map configured")).toHaveCount(0);
  });
});
