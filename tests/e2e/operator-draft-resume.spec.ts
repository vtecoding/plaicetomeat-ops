import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

test.describe("V18 operator workflow drafts", () => {
  resetStateBeforeEach({ openShopDay: true });

  test("a delivery resumes from the last saved step after refresh", async ({ page }) => {
    await login(page, USERS.operator, { expectLanding: /\/operator$/ });
    await page.goto("/operator/stock");

    await page.getByRole("button", { name: "A delivery arrived" }).click();
    await page.getByRole("button", { name: "Chicken Breast Fillets", exact: true }).click();
    await page.getByTestId("operator-delivery-quantity").fill("2.5");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // The chip only claims recovery after the awaited server write succeeds.
    await expect(page.getByTestId("operator-draft-status")).toHaveText("Saved for resume");
    await page.reload();

    await expect(page.getByTestId("operator-draft-prompt")).toBeVisible();
    await expect(page.getByText("Saved up to: How much arrived?")).toBeVisible();
    await page.getByRole("button", { name: "Carry on", exact: true }).click();

    await expect(page.getByText(/2\.5 kg/).first()).toBeVisible();
    await expect(page.getByTestId("operator-draft-status")).toHaveText("Saved for resume");
  });

  test("start fresh abandons the old run before opening a new flow", async ({ page }) => {
    await login(page, USERS.operator, { expectLanding: /\/operator$/ });
    await page.goto("/operator/waste");
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByTestId("operator-draft-status")).toHaveText("Saved for resume");

    await page.reload();
    await expect(page.getByTestId("operator-draft-prompt")).toBeVisible();
    await page.getByRole("button", { name: "Start fresh", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Did you throw anything away?" })).toBeVisible();
    await expect(page.getByTestId("operator-draft-prompt")).toHaveCount(0);
  });

  test("a failed draft save is visible, retries, and never blocks the waste record", async ({ page }) => {
    await login(page, USERS.operator, { expectLanding: /\/operator$/ });
    await page.goto("/operator/waste");

    let failedOnce = false;
    await page.route("**/operator/waste", async (route) => {
      if (route.request().method() === "POST" && !failedOnce) {
        failedOnce = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByTestId("operator-draft-status")).toContainText("Not saved for resume");

    await page.getByRole("button", { name: "Chicken Breast Fillets", exact: true }).click();
    await expect(page.getByTestId("operator-draft-status")).toHaveText("Saved for resume");
    await page.getByTestId("operator-waste-quantity").fill("0.2");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Damaged", exact: true }).click();
    await page.getByRole("button", { name: "Skip for now", exact: true }).click();
    await page.getByRole("button", { name: "Save this waste", exact: true }).click();

    await expect(page.getByText(/Waste saved/).first()).toBeVisible();
  });
});
