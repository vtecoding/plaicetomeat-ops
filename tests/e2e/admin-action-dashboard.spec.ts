import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

// V11.3 — /admin is analysis only. Operational "action" sections and the launch
// readiness card moved to Today / setup. This asserts the analysis content stays
// and the operational duplication is gone.
test.describe("business insights hub (analysis only)", () => {
  test("shows analysis sections, not operational action boards", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");

    // The headline snapshot stays visible; deeper analysis and tools are
    // deliberately compressed behind separate disclosure groups.
    await expect(page.getByRole("heading", { name: "What happened today?" })).toBeVisible();
    await expect(page.getByTestId("metric-stock-risk")).toBeVisible();

    const detail = page.getByRole("group", { name: "Shop detail" });
    await detail.getByText("Open what to watch").click();
    await expect(detail.getByRole("heading", { name: "What expires soon?" })).toBeVisible();

    const tools = page.getByRole("group", { name: "Shop tools" });
    await tools.getByText("Open buying, pricing and stock").click();
    await expect(tools.getByRole("link", { name: "What stock do I have?" })).toBeVisible();

    // Operational boards now live on Today, not here.
    await expect(page.getByRole("heading", { name: "What needs attention?" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Today's Focus" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What needs fixing?" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Where do I go next?" })).toHaveCount(0);
  });

  test("launch readiness is not duplicated on the analysis hub", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");
    // Onboarding/launch readiness has a single home (Today setup-mode + /admin/setup).
    await expect(page.getByRole("heading", { name: "Launch Readiness" })).toHaveCount(0);
  });
});
