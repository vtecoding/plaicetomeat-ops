import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V9 Owner Brain: the TODAY home at /admin/today. Managers land here after login and see
// a compressed, jargon-free picture — Urgent / Important / Opportunities (or, while the
// shop is still being set up, only the Getting Started steps). Every item opens a
// standardised decision card.
test.describe("v9 owner brain — today", () => {
  resetStateBeforeEach();

  test("managers land on the Owner Brain home", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await expect(page).toHaveURL(/\/admin\/today/);
    await expect(page.getByTestId("owner-brain-home")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What needs you today" })).toBeVisible();

    const setup = page.getByTestId("setup-mode");
    if (await setup.count()) {
      // Setup mode: only Getting Started is shown, no intelligence.
      await expect(setup).toBeVisible();
      await expect(page.getByTestId("decisions-do-now")).toHaveCount(0);
    } else {
      // The dominant "Do now" zone contains the complete immediate workload (≤3).
      // Later is optional and collapsed; analysis is absent from Today.
      await expect(page.getByTestId("do-now-zone")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Do now", exact: true })).toBeVisible();
      const doNowRows = page.getByTestId("decisions-do-now").getByTestId("decision-row");
      expect(await doNowRows.count()).toBeLessThanOrEqual(3);
      // Dashboard retirement: the status panel is gone from TODAY.
      await expect(page.getByTestId("shop-status")).toHaveCount(0);
      await expect(page.getByTestId("weekly-owner-summary")).toHaveCount(0);
      await expect(page.getByTestId("yesterday-money")).toHaveCount(0);
      await expect(page.getByTestId("reconcile-today-panel")).toHaveCount(0);
    }
  });

  test("a decision opens a standardised decision card", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    test.skip((await page.getByTestId("setup-mode").count()) > 0, "Shop is in setup mode — no decision to open");
    const rows = page.getByTestId("decisions-do-now").getByTestId("decision-row");
    const count = await rows.count();
    test.skip(count === 0, "No Do now decision in the current data set");

    await rows.first().click();
    await expect(page).toHaveURL(/\/admin\/today\/.+/);
    await expect(page.getByTestId("decision-card")).toBeVisible();

    // Every card answers the decision questions before showing optional evidence.
    await expect(page.getByText("What happened?")).toBeVisible();
    await expect(page.getByText("Why does it matter?")).toBeVisible();
    await expect(page.getByText("PTM recommends")).toBeVisible();
    const evidence = page.getByTestId("decision-evidence");
    await expect(evidence).toBeVisible();
    await expect(evidence).not.toHaveAttribute("open", "");
    await evidence.locator("summary").click();
    await expect(page.getByText("Who", { exact: true })).toBeVisible();
    await expect(page.getByText("When", { exact: true })).toBeVisible();
  });

  test("never shows scores, raw severity, or technical jargon", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await expect(page.getByTestId("owner-brain-home")).toBeVisible();

    // No raw enum badges like `info` / `warning` / `urgent` shown alone.
    await expect(page.getByText(/^(info|warning|urgent)$/)).toHaveCount(0);
    // No numeric health score like "81 / 100".
    await expect(page.getByText(/\d+\s*\/\s*100/)).toHaveCount(0);
    // Language firewall: forbidden terms must never appear.
    for (const term of ["yield variance", "operational health", "purchasing discipline", "gross margin", "data quality score"]) {
      await expect(page.getByText(new RegExp(term, "i"))).toHaveCount(0);
    }
  });

  test("retires the duplicate guided walk back to Today", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await page.goto("/admin/today/walk");
    await expect(page).toHaveURL(/\/admin\/today$/);
    await expect(page.getByTestId("owner-brain-home")).toBeVisible();
    await expect(page.getByTestId("guided-walk")).toHaveCount(0);
  });

  test("keeps Work and Review as separate simple destinations", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await page.getByTestId("owner-menu-link").click();
    await expect(page).toHaveURL(/\/admin\/menu/);
    await expect(page.getByTestId("owner-menu")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Money & orders" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();
    await page.getByRole("link", { name: "Review", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
  });
});
