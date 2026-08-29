import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V11.3 — Briefing retired. /admin/briefing now redirects to Today (the sole
// operational home), and the V8 shop-intelligence analysis (health score,
// useful weekly outcomes live on the periodic Review at /admin. Internal scores,
// duplicate action lists and the permanent playbook index are intentionally absent.
test.describe("shop intelligence after consolidation", () => {
  resetStateBeforeEach();

  test("/admin/briefing redirects to Today", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await page.goto("/admin/briefing");
    await expect(page).toHaveURL(/\/admin\/today/);
    await expect(page.getByTestId("owner-brain-home")).toBeVisible();
  });

  test("the periodic Review is separate from Today and Work", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await page.getByRole("link", { name: "Review", exact: true }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Review the business" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sales" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();
    await expect(page.getByText(/\/ 100/)).toHaveCount(0);
  });

  test("never shows raw severity or developer wording to the owner", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin");

    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
    // No raw enum badges like `info` / `warning` / `urgent`.
    await expect(page.getByText(/^(info|warning|urgent)$/)).toHaveCount(0);
    // No raw confidence enums.
    await expect(page.getByText(/^(low|medium|high)$/)).toHaveCount(0);
  });

  test("keeps contextual playbooks reachable without a permanent index", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/playbooks/carcass-intake");
    await expect(page.getByTestId("playbook-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Step by step" })).toBeVisible();
  });

  test("staff cannot reach the manager analysis hub", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin");
    // Middleware route protection keeps staff out of /admin/*.
    await expect(page).not.toHaveURL(/\/admin$/);
    await page.goto("/admin/briefing");
    await expect(page).not.toHaveURL(/\/admin\/briefing/);
  });
});
