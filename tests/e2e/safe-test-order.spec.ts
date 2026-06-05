import { expect, test, type Page } from "@playwright/test";

import { resetStateBeforeEach } from "./reset-state";

// V11.1: a full checkout that is safe to run in CI — a visibly marked TEST order
// that writes a real row and gets a real PTM ref — exercised through the SECURE
// access boundary: the redirect goes to the unguessable access-id URL, the
// enumerable reference does not reveal data, and cancellation needs a session.

const PRODUCT_SLUG = "whole-chicken";

/** A future date (YYYY-MM-DD) on an ISO weekday the seeded windows allow (Mon–Sat). */
function nextWeekdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function addItemAndCheckout(page: Page) {
  await page.goto(`/product/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Added", exact: true })).toBeVisible();
  await page.goto("/checkout");
}

test.describe("safe test order — secure access boundary", () => {
  resetStateBeforeEach();

  test("checkout → access-id status → cancel; reference is not a credential", async ({ page, browser }) => {
    await addItemAndCheckout(page);

    await expect(page.getByTestId("test-order-toggle")).toBeVisible();
    await page.getByTestId("test-order-toggle").locator("input").check();

    await page.getByLabel("Name").fill("Playwright Tester");
    await page.getByLabel("UK mobile number").fill("07700900123");
    await page.getByLabel("Pickup date").fill(nextWeekdayDate());

    const select = page.getByTestId("pickup-window-select");
    const lunchtimeValue = await select.locator("option", { hasText: "Lunchtime" }).first().getAttribute("value");
    await select.selectOption(lunchtimeValue!);

    await page.getByRole("button", { name: /place pay-on-collection order/i }).click();

    // The redirect goes to the UNGUESSABLE access-id URL, never /order/<ref>.
    await page.waitForURL(/\/order\/status\/[0-9a-f-]{36}/);
    const publicAccessId = page.url().split("/order/status/")[1].split(/[/?#]/)[0];
    expect(publicAccessId).toMatch(/^[0-9a-f-]{36}$/);

    // Status shows the human ref (label) and the customer's first name only.
    const heading = page.getByRole("heading", { name: /^PTM-\d{4}-\d{5}$/ });
    await expect(heading).toBeVisible();
    const orderRef = (await heading.innerText()).trim();
    await expect(page.getByText("Order for Playwright")).toBeVisible();

    // The enumerable reference must NOT reveal data: /order/<ref> -> lookup.
    await page.goto(`/order/${orderRef}`);
    await page.waitForURL(/\/order\/lookup/);

    // A fresh browser (no established session) cannot cancel — it is asked to
    // confirm identity instead. This is the "cancel without session" invariant.
    const strangerContext = await browser.newContext();
    const stranger = await strangerContext.newPage();
    await stranger.goto(`/order/status/${publicAccessId}/cancel`);
    await expect(stranger.getByText(/confirm it'?s my order/i)).toBeVisible();
    await expect(stranger.getByTestId("confirm-cancel")).toHaveCount(0);
    await strangerContext.close();

    // The original customer (session established at checkout) CAN cancel.
    await page.goto(`/order/status/${publicAccessId}/cancel`);
    await page.getByTestId("confirm-cancel").click();
    await expect(page.getByTestId("cancel-success")).toBeVisible();
  });
});
