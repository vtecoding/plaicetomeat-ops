import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V11.3 — Briefing retired. /admin/briefing now redirects to Today (the sole
// operational home), and the V8 shop-intelligence analysis (health score,
// explain-everything findings, weekly report, confidence) lives on the single
// analysis hub at /admin ("Business Insights"). Knowledge-layer playbooks unchanged.
test.describe("shop intelligence after consolidation", () => {
  resetStateBeforeEach();

  test("/admin/briefing redirects to Today", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await page.goto("/admin/briefing");
    await expect(page).toHaveURL(/\/admin\/today/);
    await expect(page.getByTestId("owner-brain-home")).toBeVisible();
  });

  test("the analysis now lives on Business Insights, reachable from Today", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    const link = page.getByTestId("business-insights-link");
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "How the shop is doing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Things to review" })).toBeVisible();
    await expect(page.getByTestId("health-score")).toBeVisible();
    await expect(page.getByTestId("weekly-report")).toBeVisible();
    await expect(page.getByTestId("confidence-banner")).toBeVisible();
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

  test("links findings to the operational playbooks", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/playbooks");

    await expect(page.getByTestId("playbooks-page")).toBeVisible();
    await page.getByRole("link", { name: /Carcass intake/ }).first().click();

    await expect(page).toHaveURL(/\/admin\/playbooks\/carcass-intake/);
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
