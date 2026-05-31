import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

function columnSection(page: import("@playwright/test").Page, label: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: label, exact: true }) });
}

test.describe("counter status persistence", () => {
  resetStateBeforeEach();

  test("moving an order persists across a refresh", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });

    const incoming = columnSection(page, "Incoming");
    const prepping = columnSection(page, "Prepping");

    // PTM-2026-90001 is seeded as 'incoming'.
    const card = incoming.locator("article", { hasText: "PTM-2026-90001" });
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Start Prep" }).click();

    // Optimistic + canonical: it lands in Prepping.
    const moved = prepping.locator("article", { hasText: "PTM-2026-90001" });
    await expect(moved).toBeVisible();

    // Wait for the server to confirm (the pending button re-enables to the next
    // action only after the canonical write returns). This avoids reloading
    // mid-request and proves the status came from the database.
    await expect(moved.getByRole("button", { name: "Mark Ready" })).toBeVisible();

    // Hard reload — status must come from the database, not local state.
    await page.reload();
    await expect(columnSection(page, "Prepping").locator("article", { hasText: "PTM-2026-90001" })).toBeVisible();
    await expect(columnSection(page, "Incoming").locator("article", { hasText: "PTM-2026-90001" })).toHaveCount(0);
  });
});
