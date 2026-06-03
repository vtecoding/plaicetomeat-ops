import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

test.describe("V4 operations intelligence", () => {
  resetStateBeforeEach();

  test("shows the business insight panels", async ({ page }) => {
    await login(page, USERS.manager, { expectLanding: /\/admin/ });
    await page.goto("/admin");

    // Panel titles render as headings in the desktop grid (plain-English wording).
    await expect(page.getByRole("heading", { name: "What expires soon?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What am I losing money on?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What money can I make?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Product Performance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What makes me money?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Customer Loyalty" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What Customers Buy Together" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What certificates expire soon?" })).toBeVisible();
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
