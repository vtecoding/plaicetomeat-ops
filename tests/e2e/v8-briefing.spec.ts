import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V8 Shop Intelligence: the briefing home at /admin/briefing — daily briefing,
// operational health score, explain-everything findings, weekly report, confidence,
// and the knowledge-layer playbooks it links to.
test.describe("v8 shop briefing", () => {
  resetStateBeforeEach();

  test("managers can open the briefing from Today and see the core sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    const link = page.getByTestId("briefing-link");
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/admin\/briefing/);
    await expect(page.getByTestId("briefing-page")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Today's briefing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How the shop is doing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Things to look at" })).toBeVisible();
    await expect(page.getByTestId("health-score")).toBeVisible();
    await expect(page.getByTestId("weekly-report")).toBeVisible();
    await expect(page.getByTestId("confidence-banner")).toBeVisible();
  });

  test("never shows raw severity or developer wording to the owner", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/briefing");

    await expect(page.getByTestId("briefing-page")).toBeVisible();
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

  test("staff cannot reach the manager briefing", async ({ page }) => {
    await login(page, USERS.staff, { expectLanding: /\/counter/ });
    await page.goto("/admin/briefing");
    // Middleware route protection keeps staff out of /admin/*.
    await expect(page).not.toHaveURL(/\/admin\/briefing/);
  });
});
