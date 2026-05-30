import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

// Phase 8: a full checkout that is safe to run in CI — a visibly marked TEST
// order that writes a real row, gets a real PTM ref, appears on the counter,
// and never triggers a real SMS.

const PRODUCT_SLUG = "whole-chicken";

/** A future date (YYYY-MM-DD) on an ISO weekday the seeded windows allow (Mon–Sat). */
function nextWeekdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  // Avoid Sunday (ISO 7); the seeded Lunchtime window covers Mon–Sat.
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function addItemAndCheckout(page: Page) {
  await page.goto(`/product/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Added", exact: true })).toBeVisible();
  await page.goto("/checkout");
}

test.describe("safe test order", () => {
  test("submits a TEST order end to end without sending SMS", async ({ page, browser }) => {
    await addItemAndCheckout(page);

    // Test-mode toggle is available because CHECKOUT_TEST_MODE_ENABLED is on.
    await expect(page.getByTestId("test-order-toggle")).toBeVisible();
    await page.getByTestId("test-order-toggle").locator("input").check();

    await page.getByLabel("Name").fill("Playwright Tester");
    await page.getByLabel("UK mobile number").fill("07700900123");
    await page.getByLabel("Pickup date").fill(nextWeekdayDate());

    // Lunchtime runs Mon–Sat, so it is valid for any non-Sunday pickup date.
    const select = page.getByTestId("pickup-window-select");
    const lunchtimeValue = await select
      .locator("option", { hasText: "Lunchtime" })
      .first()
      .getAttribute("value");
    await select.selectOption(lunchtimeValue!);

    await page.getByRole("button", { name: /place pay-on-collection order/i }).click();

    // Confirmation page renders with a PTM ref and the TEST badge, no raw UUID.
    await page.waitForURL(/\/order\/PTM-\d{4}-\d{5}/);
    await expect(page.getByTestId("test-order-badge")).toBeVisible();
    const orderRef = page.url().split("/order/")[1];
    expect(orderRef).toMatch(/^PTM-\d{4}-\d{5}$/);

    // A test order is visibly marked as such for staff. (The counter board shows
    // today's pickups; test orders carry the TEST badge wherever they render.)
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await login(staffPage, USERS.manager, { expectLanding: /\/admin/ });
    await staffPage.goto(`/order/${orderRef}`);
    await expect(staffPage.getByTestId("test-order-badge")).toBeVisible();
    await staffContext.close();

    // The test order can be cancelled safely (still 'incoming').
    await page.goto(`/order/${orderRef}/cancel`);
    await page.getByTestId("confirm-cancel").click();
    await expect(page.getByTestId("cancel-success")).toBeVisible();
  });
});
