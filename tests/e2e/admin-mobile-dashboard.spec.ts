import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

test.describe("owner dashboard mobile mode", () => {
  resetStateBeforeEach();

  test("shows the compact counter-service view", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin?mode=counter");

    await expect(page.getByRole("heading", { name: "Service view" })).toBeVisible();
    await expect(page.getByTestId("metric-awaiting-prep")).toHaveText("2");
    await expect(page.getByTestId("metric-ready")).toHaveText("1");
    await expect(page.getByTestId("metric-revenue")).toContainText("78.47");
    await expect(page.getByTestId("metric-critical-alerts")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business Insights" })).toHaveCount(0);
  });
});
