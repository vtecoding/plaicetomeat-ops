import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

// Phase 9: SMS status reflects reality. With SMS_SENDING_ENABLED=false the
// "ready" transition must record a truthful non-"sent" status and never claim
// success, while the status transition itself still succeeds.

function card(page: Page, orderRef: string) {
  return page.locator("article", { hasText: orderRef });
}

test.describe("truthful SMS status", () => {
  test("marking an order ready records a disabled SMS, not a fake 'sent'", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });

    // PTM-2026-90002 is seeded as 'prepping' -> can move to 'ready'.
    const orderCard = card(page, "PTM-2026-90002");
    await expect(orderCard).toBeVisible();

    await orderCard.getByRole("button", { name: "Mark Ready" }).click();

    // The status transition succeeds even though SMS does not send.
    const readyCard = card(page, "PTM-2026-90002");
    const badge = readyCard.getByTestId("sms-badge");
    await expect(badge).toBeVisible();
    // Honest: SMS is disabled in this environment; it must NOT say "sent".
    await expect(badge).toHaveAttribute("data-sms-status", "disabled");
    await expect(badge).toContainText(/disabled/i);
  });
});
