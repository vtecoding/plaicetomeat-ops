import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V11.3 — counter dedup. The old /admin?mode=counter "Service view" is retired:
// /counter is the sole live-service authority. The legacy URL must NOT render a
// duplicate counter; it falls through to the analysis hub (Business Insights).
test.describe("admin no longer hosts a duplicate counter", () => {
  resetStateBeforeEach();

  test("legacy /admin?mode=counter shows Business Insights, not a counter view", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin?mode=counter");

    // No counter-service experience here anymore.
    await expect(page.getByRole("heading", { name: "Service view" })).toHaveCount(0);
    await expect(page.getByTestId("metric-critical-alerts")).toHaveCount(0);

    // It is the analysis hub.
    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review the business" })).toBeVisible();
  });
});
