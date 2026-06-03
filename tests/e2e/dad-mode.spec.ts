import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

// V7.0 Dad Mode: the simple owner home at /admin/today. Managers land here after
// login and see only "what to do / orders / stock / compliance / where to go".
test.describe("dad mode home", () => {
  resetStateBeforeEach();

  test("managers land on the plain-English home with the core sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    await expect(page).toHaveURL(/\/admin\/today/);
    await expect(page.getByTestId("dad-mode-home")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Today's jobs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's orders" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock needing attention" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compliance warnings" })).toBeVisible();

    // Big counter buttons.
    await expect(page.getByRole("link", { name: "Open Counter" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View Orders" })).toBeVisible();
  });

  test("offers a single 'More detail' route to the full dashboard", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    const moreDetail = page.getByRole("link", { name: "More detail" });
    await expect(moreDetail).toBeVisible();
    await moreDetail.click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("owner-dashboard")).toBeVisible();
  });

  test("never shows raw severity or developer wording", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin\/today/ });

    // No raw enum badges like `info` / `warning` / `urgent`.
    await expect(page.getByText(/^(info|warning|urgent)$/)).toHaveCount(0);
    // No developer jargon leaks.
    await expect(page.getByText("forecast rows")).toHaveCount(0);
    await expect(page.getByText("no cost source available")).toHaveCount(0);
  });
});
