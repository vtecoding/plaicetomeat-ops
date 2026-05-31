import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

function card(page: Page, orderRef: string) {
  return page.locator("article", { hasText: orderRef });
}

function noteItem(page: Page, orderRef: string, text: string) {
  return card(page, orderRef).getByTestId("staff-note").filter({ hasText: text });
}

test.describe("staff notes", () => {
  resetStateBeforeEach();

  test("a note persists, is visible to other staff, and stays internal", async ({ browser }) => {
    const noteText = `Trim the fat ${Date.now()}`;

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await login(pageA, USERS.staff, { expectLanding: /\/counter/ });

    const orderCard = card(pageA, "PTM-2026-90003");
    await expect(orderCard).toBeVisible();

    await orderCard.getByLabel("Add staff note").fill(noteText);
    await orderCard.getByRole("button", { name: "Add note" }).click();

    // Appears as a saved note item (only renders after the server confirms).
    await expect(noteItem(pageA, "PTM-2026-90003", noteText)).toBeVisible();
    await expect(noteItem(pageA, "PTM-2026-90003", noteText)).toContainText("Sam Staff");

    // Persists across refresh (came from the database).
    await pageA.reload();
    await expect(noteItem(pageA, "PTM-2026-90003", noteText)).toBeVisible();

    // Visible to a second staff member.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await login(pageB, USERS.manager, { expectLanding: /\/admin/ });
    await pageB.goto("/counter");
    await expect(noteItem(pageB, "PTM-2026-90003", noteText)).toBeVisible({ timeout: 5_000 });

    // Customer-facing order page must NOT expose internal notes.
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    await customer.goto("/order/PTM-2026-90003");
    await expect(customer.getByText(noteText)).toHaveCount(0);

    await contextA.close();
    await contextB.close();
    await customerContext.close();
  });

  test("empty notes are rejected client-side", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    const orderCard = card(page, "PTM-2026-90001");
    // Add-note button is disabled until there is non-whitespace content.
    await expect(orderCard.getByRole("button", { name: "Add note" })).toBeDisabled();
    await orderCard.getByLabel("Add staff note").fill("   ");
    await expect(orderCard.getByRole("button", { name: "Add note" })).toBeDisabled();
  });
});
