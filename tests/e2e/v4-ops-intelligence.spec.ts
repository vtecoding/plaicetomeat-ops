import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

test.describe("V4 operations intelligence", () => {
  resetStateBeforeEach();

  test("shows the owner morning briefing and business control sections", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Good Morning" })).toBeVisible();
    await expect(page.getByText("What's Going Off Soon")).toBeVisible();
    await expect(page.getByText("Where Money's Being Lost")).toBeVisible();
    await expect(page.getByText("Daily Profit Estimate")).toBeVisible();
    await expect(page.getByText("Product Performance")).toBeVisible();
    await expect(page.getByText("Profit & Loss")).toBeVisible();
    await expect(page.getByText("Stock Running Low")).toBeVisible();
    await expect(page.getByText("Customer Loyalty")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What Customers Buy Together" })).toBeVisible();
    await expect(page.getByText("Food Compliance")).toBeVisible();
  });

  test("shows release governance and migration health", async ({ page }) => {
    await login(page, USERS.owner, { expectLanding: /\/admin/ });
    await page.goto("/admin/releases");

    await expect(page.getByRole("heading", { name: "Deployment Ledger" })).toBeVisible();
    await expect(page.getByText("Migration Health")).toBeVisible();
    await expect(page.getByText("Post Release Verification")).toBeVisible();
  });

  test("supports audit investigation filters", async ({ page }) => {
    await login(page, USERS.owner, { expectLanding: /\/admin/ });
    await page.goto("/admin/audit?eventType=waste_recorded");

    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(page.getByPlaceholder("waste_recorded")).toHaveValue("waste_recorded");
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  });
});
