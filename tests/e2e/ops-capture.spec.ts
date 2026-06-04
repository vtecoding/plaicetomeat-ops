import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V10 Phase 2 — guided operational capture. The opening/closing rituals persist every step,
// so a refresh resumes exactly where the owner left off, and finishing yields a persisted
// receipt. Manager/owner-gated.
test.describe("v10 guided capture — rituals", () => {
  resetStateBeforeEach();

  test("opening: record a step, resume across refresh, finish to a persisted receipt", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/open");

    await expect(page.getByTestId("open-checklist-page")).toBeVisible();
    await expect(page.getByTestId("guided-checklist")).toBeVisible();
    await expect(page.getByTestId("checklist-progress")).toHaveText(/0 of \d+ done/);

    // First step (fridge temperature) takes a number.
    await expect(page.getByTestId("checklist-step-active")).toBeVisible();
    await page.getByTestId("step-number-input").fill("3.5");
    await page.getByTestId("step-done-btn").click();

    await expect(page.getByTestId("checklist-progress")).toHaveText(/1 of \d+ done/);
    await expect(page.getByTestId("checklist-step-done")).toHaveCount(1);

    // REFRESH — the recorded step must persist (resume from the server, not client state).
    await page.reload();
    await expect(page.getByTestId("guided-checklist")).toBeVisible();
    await expect(page.getByTestId("checklist-progress")).toHaveText(/1 of \d+ done/);
    await expect(page.getByTestId("checklist-step-done")).toHaveCount(1);
    // The recorded temperature is still shown.
    await expect(page.getByText("3.5 °C")).toBeVisible();

    // Work through the remaining steps one at a time, waiting for each to commit (the
    // progress counter ticking up) before moving on, so we never race the save.
    let handled = 1;
    for (let i = 0; i < 12; i += 1) {
      if ((await page.getByTestId("checklist-finish").count()) > 0) break;
      const numberInput = page.getByTestId("step-number-input");
      if (await numberInput.count()) await numberInput.fill("2");
      const doneBtn = page.getByTestId("step-done-btn");
      await expect(doneBtn).toBeEnabled();
      await doneBtn.click();
      handled += 1;
      await expect(page.getByTestId("checklist-progress")).toHaveText(new RegExp(`${handled} of \\d+ done`));
    }

    // Finish → persisted receipt.
    await page.getByTestId("checklist-finish").click();
    await expect(page.getByTestId("checklist-receipt")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shop is ready" })).toBeVisible();

    // The receipt survives a refresh — proof it's persisted, not just in the browser.
    await page.reload();
    await expect(page.getByTestId("checklist-receipt")).toBeVisible();
  });

  test("a step can be skipped, and the skip is a real recorded state", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/open");

    await expect(page.getByTestId("checklist-step-active")).toBeVisible();
    await page.getByTestId("step-skip-btn").click();

    await expect(page.getByTestId("checklist-progress")).toHaveText(/1 of \d+ done/);
    await expect(page.getByText("Skipped").first()).toBeVisible();

    // It survives a refresh as a skipped step, not a blank one.
    await page.reload();
    await expect(page.getByText("Skipped").first()).toBeVisible();
  });

  test("closing checklist is reachable from today and starts clean", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await page.getByTestId("close-shop-link").click();
    await expect(page).toHaveURL(/\/admin\/close/);
    await expect(page.getByTestId("close-checklist-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Closing the shop" })).toBeVisible();
    await expect(page.getByTestId("checklist-progress")).toHaveText(/0 of \d+ done/);
  });
});
