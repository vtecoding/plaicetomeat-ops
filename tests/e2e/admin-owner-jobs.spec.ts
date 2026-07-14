import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";

function localEnv() {
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
}

test.describe("V18 Owner jobs", () => {
  resetStateBeforeEach();

  test("one tray resolves every action class without cross-branch hydration", async ({ page }) => {
    const env = localEnv();
    const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const suffix = crypto.randomUUID().slice(0, 8);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const productId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const foreignProductId = crypto.randomUUID();
    const foreignBatchId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();
    const wasteAlertId = crypto.randomUUID();
    const generalAlertId = crypto.randomUUID();
    const automaticAlertId = crypto.randomUUID();
    const foreignProductName = `PRIVATE BRANCH B PRODUCT ${suffix}`;

    const { data: operator, error: operatorError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", USERS.operator)
      .single();
    expect(operatorError?.message).toBeUndefined();
    if (!operator) throw new Error("Seeded operator profile is required.");

    const { error: productError } = await admin.from("products").insert([
      {
        id: productId,
        branch_id: BRANCH_A,
        name: `Owner jobs product ${suffix}`,
        slug: `owner-jobs-${suffix}`,
        unit_type: "kg",
        price_per_unit: 10,
        is_available: true,
        stock_status: "in_stock",
      },
      {
        id: foreignProductId,
        branch_id: BRANCH_B,
        name: foreignProductName,
        slug: `owner-jobs-foreign-${suffix}`,
        unit_type: "kg",
        price_per_unit: 99,
        is_available: true,
        stock_status: "in_stock",
      },
    ]);
    expect(productError?.message).toBeUndefined();
    const { error: batchError } = await admin.from("inventory_batches").insert([
      {
        id: batchId,
        branch_id: BRANCH_A,
        product_id: productId,
        received_date: today,
        expiry_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        received_weight_kg: 5,
        remaining_weight_kg: 5,
        invoice_cost: 0,
        cost_per_kg: 0,
        batch_number: `OP-E2E-${suffix}`,
      },
      {
        id: foreignBatchId,
        branch_id: BRANCH_B,
        product_id: foreignProductId,
        received_date: today,
        expiry_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        received_weight_kg: 5,
        remaining_weight_kg: 5,
        invoice_cost: 0,
        cost_per_kg: 0,
        batch_number: `OP-E2E-FOREIGN-${suffix}`,
      },
    ]);
    expect(batchError?.message).toBeUndefined();

    const { data: costAlert, error: costAlertError } = await admin.rpc("ensure_delivery_cost_owner_alert_v18", {
      p_branch_id: BRANCH_A,
      p_summary: `Add the ${suffix} invoice cost.`,
      p_entity_ref: `${batchId}:cost`,
      p_created_by: operator.id,
    });
    expect(costAlertError?.message).toBeUndefined();
    const { data: foreignAlert, error: foreignAlertError } = await admin.rpc("ensure_delivery_cost_owner_alert_v18", {
      p_branch_id: BRANCH_A,
      p_summary: `Cross-branch hydration probe ${suffix}.`,
      p_entity_ref: `${foreignBatchId}:cost`,
      p_created_by: operator.id,
    });
    expect(foreignAlertError?.message).toBeUndefined();

    const { error: workflowError } = await admin.from("operator_workflow_runs").insert({
      id: workflowId,
      branch_id: BRANCH_A,
      operator_id: operator.id,
      workflow: "waste",
      status: "completed",
      steps: { quantity: 0.75, reason: "damaged" },
      result_ref: `inventory_batch:${batchId}`,
    });
    expect(workflowError?.message).toBeUndefined();
    const { error: alertError } = await admin.from("owner_alerts").insert([
      {
        id: wasteAlertId,
        branch_id: BRANCH_A,
        severity: "warning",
        kind: "operator_waste_reason_check",
        summary: `Review waste ${suffix}.`,
        entity_ref: workflowId,
        created_by: operator.id,
      },
      {
        id: generalAlertId,
        branch_id: BRANCH_A,
        severity: "warning",
        kind: "operator_delivery_check_needed",
        summary: `Review delivery ${suffix}.`,
        entity_ref: `delivery:${suffix}`,
        created_by: operator.id,
      },
      {
        id: automaticAlertId,
        branch_id: BRANCH_A,
        severity: "warning",
        kind: "inventory_shortfall",
        summary: `Count the missing stock ${suffix}.`,
        entity_ref: `product:${productId}`,
        created_by: operator.id,
      },
    ]);
    expect(alertError?.message).toBeUndefined();

    try {
      await login(page, USERS.owner, { expectLanding: /\/admin/ });
      await page.goto("/admin/reconcile");
      await expect(page.getByRole("heading", { name: "Jobs waiting for you" })).toBeVisible();
      await expect(page.getByTestId("owner-job-group-operator_delivery_cost_pending")).toContainText("2 jobs");
      await expect(page.getByText(foreignProductName)).toHaveCount(0);
      const automaticGroup = page.getByTestId("owner-job-group-inventory_shortfall");
      await expect(automaticGroup).toContainText("This job will clear automatically.");
      await expect(automaticGroup.getByRole("button", { name: "Resolve with note" })).toHaveCount(0);

      const costInput = page.getByTestId(`reconcile-cost-${costAlert.id}`);
      await costInput.fill("25.50");
      const costCard = page.locator("li").filter({ has: costInput });
      await costCard.getByRole("button", { name: "Save & Resolve" }).click();
      await expect(costInput).toHaveCount(0);

      const wasteGroup = page.getByTestId("owner-job-group-operator_waste_reason_check");
      await wasteGroup.getByRole("button", { name: "Confirm & Resolve" }).click();
      await expect(wasteGroup).toHaveCount(0);

      await page.getByTestId(`owner-job-note-${generalAlertId}`).fill("Checked the delivery paperwork.");
      await page.getByTestId(`owner-job-resolve-${generalAlertId}`).click();
      await expect(page.getByTestId(`owner-job-resolve-${generalAlertId}`)).toHaveCount(0);

      const [{ data: savedBatch }, { data: resolved }, { data: automatic }] = await Promise.all([
        admin.from("inventory_batches").select("invoice_cost").eq("id", batchId).single(),
        admin.from("owner_alerts").select("id,resolved_at,resolution_note").in("id", [costAlert.id, wasteAlertId, generalAlertId]),
        admin.from("owner_alerts").select("resolved_at").eq("id", automaticAlertId).single(),
      ]);
      expect(Number(savedBatch?.invoice_cost)).toBe(25.5);
      expect(resolved).toHaveLength(3);
      expect(resolved?.every((alert) => alert.resolved_at && alert.resolution_note)).toBe(true);
      expect(automatic?.resolved_at).toBeNull();
    } finally {
      await admin.from("owner_alerts").delete().in("id", [
        costAlert.id,
        foreignAlert.id,
        wasteAlertId,
        generalAlertId,
        automaticAlertId,
      ]);
      await admin.from("operator_workflow_runs").delete().eq("id", workflowId);
      await admin.from("inventory_batches").delete().in("id", [batchId, foreignBatchId]);
      await admin.from("products").delete().in("id", [productId, foreignProductId]);
    }
  });
});
