import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// Phase 9: SMS status reflects reality. With SMS_SENDING_ENABLED=false, an order
// that becomes "ready" must record a truthful non-"sent" status (disabled here)
// and never claim success — and the status transition itself still succeeds.
//
// This spec is resilient to shared-seed state: it drives whichever seeded order
// it can to "ready" rather than assuming a specific order's current status.

function card(page: Page, orderRef: string) {
  return page.locator("article", { hasText: orderRef });
}

const SEED_ORDERS = ["PTM-2026-90001", "PTM-2026-90002", "PTM-2026-90003"];

resetStateBeforeEach();

test("marking an order ready records a disabled SMS, never a fake 'sent'", async ({ page }) => {
  await login(page, USERS.staff, { expectLanding: /\/counter/ });
  await page.goto("/counter");

  // Find an order we can move to "ready" (one click away), driving an incoming
  // order to prepping first if necessary.
  let targetRef: string | null = null;

  for (const ref of SEED_ORDERS) {
    const c = card(page, ref);
    if ((await c.count()) === 0) continue;

    const markReady = c.getByRole("button", { name: "Mark Ready" });
    const startPrep = c.getByRole("button", { name: "Start Prep" });

    if (await markReady.count()) {
      targetRef = ref;
      break;
    }
    if (await startPrep.count()) {
      await startPrep.click();
      await expect(card(page, ref).getByRole("button", { name: "Mark Ready" })).toBeVisible();
      targetRef = ref;
      break;
    }
  }

  expect(targetRef, "expected at least one seeded order that can be marked ready").not.toBeNull();

  await card(page, targetRef!).getByRole("button", { name: "Mark Ready" }).click();

  // The transition succeeds and the SMS badge is truthful: disabled, NOT "sent".
  const badge = card(page, targetRef!).getByTestId("sms-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-sms-status", "disabled");
  await expect(badge).not.toHaveAttribute("data-sms-status", "sent");
});
