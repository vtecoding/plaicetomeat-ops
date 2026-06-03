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
      await expect(page.getByTestId("decisions-urgent")).toHaveCount(0);
    } else {
      // Active mode: the three — and only three — decision sections plus status + week.
      await expect(page.getByRole("heading", { name: "Urgent", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Important", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Opportunities", exact: true })).toBeVisible();
      await expect(page.getByTestId("shop-status")).toBeVisible();
      await expect(page.getByTestId("weekly-owner-summary")).toBeVisible();
    }
  });

  test("a decision opens a standardised decision card", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    const rows = page.getByTestId("decision-row");
    const count = await rows.count();
    test.skip(count === 0, "No decisions in the current data set");

    await rows.first().click();
    await expect(page).toHaveURL(/\/admin\/today\/.+/);
    await expect(page.getByTestId("decision-card")).toBeVisible();

    // Every card answers the four questions, plus who and when.
    await expect(page.getByText("What happened?")).toBeVisible();
    await expect(page.getByText("Why it matters")).toBeVisible();
    await expect(page.getByText("Recommended action")).toBeVisible();
    await expect(page.getByText("Money impact")).toBeVisible();
    await expect(page.getByText("Who should do it")).toBeVisible();
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

  test("offers a route to the full detail dashboard", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    const moreDetail = page.getByRole("link", { name: "More detail" });
    await expect(moreDetail).toBeVisible();
    await moreDetail.click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
  });
});
