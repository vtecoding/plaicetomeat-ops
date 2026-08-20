import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

const TRUTH_TABLES = ["orders", "payment_events", "till_events", "inventory_movements", "inventory_batches", "inventory_waste_events", "compliance_logs", "compliance_readings", "operator_evidence", "owner_alerts", "alert_dispatches"] as const;

function localEnv() {
  return Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
}

async function truthSnapshot() {
  const env = localEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const snapshot: Record<string, { count: number; hash: string }> = {};
  for (const table of TRUTH_TABLES) {
    const { data, error } = await admin.from(table).select("*");
    expect(error?.message, `read ${table}`).toBeUndefined();
    const rows = [...(data ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    snapshot[table] = { count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  return snapshot;
}

// Two seconds is deliberately slower than the minimum needed by automation.
// It represents a person locating the highlight, reading the short instruction,
// and deciding what to press; this journey must not fit inside the old 60s race.
const HUMAN_READING_MS = Number(process.env.PTM_HUMAN_READING_MS ?? 2000);
const HUMAN_TYPING_MS = Number(process.env.PTM_HUMAN_TYPING_MS ?? 180);

async function readStep(page: Page, current: number) {
  await expect(page.getByText(`Step ${current} of 35`, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("This step is not ready", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(HUMAN_READING_MS);
}

async function clickTarget(page: Page, target: string, current?: number) {
  if (current) await readStep(page, current);
  const control = page.locator(`[data-tutorial="${target}"]`);
  await expect(control).toBeVisible({ timeout: 15_000 });
  await control.click();
}

async function fillTarget(page: Page, target: string, value: string, current?: number) {
  if (current) await readStep(page, current);
  const control = page.locator(`[data-tutorial="${target}"]`);
  await expect(control).toBeVisible({ timeout: 15_000 });
  await control.click();
  await control.pressSequentially(value, { delay: HUMAN_TYPING_MS });
}

async function nextAfterReading(page: Page, current: number, label: "Next" | "Finish" = "Next") {
  await readStep(page, current);
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function runCompleteShopDay(page: Page) {
  await nextAfterReading(page, 1);
  await clickTarget(page, "nav-open", 2);
  await clickTarget(page, "open-checklist", 3);
  await fillTarget(page, "open-temperature", "3.2", 4);
  await fillTarget(page, "open-float", "100", 5);
  await clickTarget(page, "open-confirm", 6);
  await nextAfterReading(page, 7);
  await clickTarget(page, "nav-serve", 8);
  await clickTarget(page, "serve-product-chicken", 9);
  await clickTarget(page, "serve-weight", 10);
  await clickTarget(page, "serve-payment-cash", 11);
  await page.reload();
  await clickTarget(page, "serve-confirm", 12);
  await nextAfterReading(page, 13);
  await clickTarget(page, "nav-stock", 14);
  await clickTarget(page, "stock-received", 15);
  await clickTarget(page, "stock-product-lamb", 16);
  await fillTarget(page, "stock-weight", "12.5", 17);
  await clickTarget(page, "stock-expiry", 18);
  await clickTarget(page, "stock-evidence", 19);
  await clickTarget(page, "stock-confirm", 20);
  await clickTarget(page, "nav-waste", 21);
  await clickTarget(page, "waste-product-chicken", 22);
  await fillTarget(page, "waste-weight", "0.5", 23);
  await clickTarget(page, "waste-reason", 24);
  await clickTarget(page, "waste-confirm", 25);
  await clickTarget(page, "nav-till", 26);
  await fillTarget(page, "till-count", "114", 27);
  await clickTarget(page, "till-confirm", 28);
  await clickTarget(page, "nav-help", 29);
  await clickTarget(page, "nav-close", 30);
  await clickTarget(page, "close-checklist", 31);
  await fillTarget(page, "close-temperature", "3.8", 32);
  await fillTarget(page, "close-till", "114", 33);
  await clickTarget(page, "close-confirm", 34);
  await nextAfterReading(page, 35, "Finish");
}

test.describe("PTM Guided Dry Run", () => {
  test("starts, resumes, changes language, contains navigation and exits without truth actions", async ({ page }) => {
    await login(page, USERS.operator, { expectLanding: /\/operator$/ });
    await page.getByRole("button", { name: "Start Dry Run", exact: true }).click();
    await expect(page.getByTestId("dry-run-banner")).toBeVisible();
    await expect(page.getByText("Step 1 of 35", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.locator('[data-tutorial="nav-serve"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Step 2 of 35", { exact: true })).toBeVisible();
    await page.locator('[data-tutorial="nav-open"]').click();
    await expect(page).toHaveURL(/\/operator\/open$/);
    await page.reload();
    await expect(page.getByTestId("dry-run-banner")).toBeVisible();

    await page.goto("/operator/serve");
    await expect(page).toHaveURL(/\/operator\/open$/);
    await page.goto("/admin/today");
    await expect(page).toHaveURL(/\/operator\/open$/);
    await page.getByRole("button", { name: "پښتو", exact: true }).click();
    await expect(page.locator('[data-operator-locale="ps-AF"]')).toHaveAttribute("dir", "rtl");
    await expect(page.getByText(/ګام 3 له 35/)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "له تمرینه ووځه" }).click();
    await expect(page.getByTestId("dry-run-banner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "تمرین پیل کړه", exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("ptm_operator_dry_run_v2"))).toBeNull();
  });

  test("owner walkthrough is deterministic and contains no mutation controls", async ({ page }) => {
    await login(page, USERS.owner, { expectLanding: /\/admin\/today/ });
    await page.goto("/admin/tutorial");
    await expect(page.getByTestId("owner-tutorial")).toHaveAttribute("data-owner-execution-mode", "dry-run");
    await page.locator('[data-tutorial="owner-today"]').click();
    await page.goto("/operator");
    await expect(page).toHaveURL(/\/admin\/tutorial$/);
    for (const target of ["owner-alerts", "owner-stock", "owner-money", "owner-compliance"]) {
      await page.locator(`[data-tutorial="${target}"]`).click();
    }
    await expect(page.getByTestId("owner-tutorial-complete")).toContainText("No real shop records changed");
    await expect(page.getByTestId("owner-tutorial").locator("form")).toHaveCount(0);
  });

  test("a human-paced mobile operator can read and complete all 35 steps with zero truth-table writes", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const before = await truthSnapshot();
    await login(page, USERS.operator, { expectLanding: /\/operator$/ });
    await page.getByRole("button", { name: "Start Dry Run", exact: true }).click();
    await runCompleteShopDay(page);
    await expect(page.getByTestId("dry-run-complete")).toContainText("No real shop records changed");
    expect(await truthSnapshot()).toEqual(before);
  });
});
