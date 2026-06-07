// V12.5 adversarial verification - Inventory Concurrency Integrity.
//
// Runs against the local Supabase stack with authenticated manager sessions and
// service-role setup/cleanup. Proves stale stock-count applies are hard-rejected
// without clobbering newer inventory truth or writing misleading success evidence.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";
const PASSWORD = "PlaiceTest123!";
const RUN = randomUUID().slice(0, 8);

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
const cleanup = { batchIds: new Set(), sessionIds: new Set() };

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
}

async function sessionClient(email) {
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

function todayIso(offsetDays = 0) {
  const n = new Date();
  n.setDate(n.getDate() + offsetDays);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

async function ensureSupplier(manager, branchId) {
  const existing = await service
    .from("suppliers")
    .select("id")
    .eq("branch_id", branchId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (existing.data) return existing.data.id;

  const created = await manager.rpc("admin_upsert_supplier_cert", {
    p_supplier_id: null,
    p_branch_id: branchId,
    p_name: `V12.5 Supplier ${RUN}`,
    p_certifying_body: "HMC",
    p_cert_number: `V125-${RUN}`,
    p_cert_expiry: "2030-01-01",
    p_active: true,
    p_document_url: null,
    p_verified: true,
    p_notes: null,
  });
  if (created.error) throw new Error(`supplier create failed: ${created.error.message}`);
  return String(created.data);
}

async function createBatch(manager, label, { branchId = BRANCH_A, received = 10, remaining = 10 } = {}) {
  const { data: product, error: productError } = await service
    .from("products")
    .select("id")
    .eq("branch_id", branchId)
    .limit(1)
    .maybeSingle();
  if (productError || !product) throw new Error(`no product found for branch ${branchId}`);

  const supplierId = await ensureSupplier(manager, branchId);
  const intakeKey = `verify-v12-5-${RUN}-${label}`;
  await service.from("inventory_batches").delete().eq("intake_idempotency_key", intakeKey);

  const { data: batchId, error } = await manager.rpc("admin_create_inventory_batch", {
    p_branch_id: branchId,
    p_product_id: product.id,
    p_supplier_id: supplierId,
    p_received_date: todayIso(),
    p_expiry_date: "2030-01-01",
    p_received_weight_kg: received,
    p_remaining_weight_kg: remaining,
    p_invoice_cost: received * 5,
    p_halal_cert_ref: null,
    p_country_of_origin: null,
    p_slaughter_date: null,
    p_storage_location: null,
    p_batch_number: `V12.5-${label}`,
    p_intake_idempotency_key: intakeKey,
    p_expected_weight_kg: null,
    p_actual_review_note: null,
  });
  if (error) throw new Error(`batch create failed (${label}): ${error.message}`);
  cleanup.batchIds.add(String(batchId));
  return String(batchId);
}

async function startStockCount(manager, dayOffset = 0) {
  const { data, error } = await manager.rpc("ops_start_or_resume_session", {
    p_branch_id: BRANCH_A,
    p_kind: "stock_count",
    p_business_date: todayIso(dayOffset),
    p_source: `verify-v12-5-${RUN}`,
  });
  if (error) throw new Error(`stock-count start failed: ${error.message}`);
  cleanup.sessionIds.add(String(data));
  return String(data);
}

async function recordLine(manager, sessionId, batchId, countedWeightKg) {
  const { data, error } = await manager.rpc("ops_record_stock_count_line", {
    p_session_id: sessionId,
    p_batch_id: batchId,
    p_counted_weight_kg: countedWeightKg,
  });
  if (error) throw new Error(`stock-count line failed: ${error.message}`);
  return String(data);
}

async function remainingKg(batchId) {
  const { data, error } = await service.from("inventory_batches").select("remaining_weight_kg").eq("id", batchId).single();
  if (error) throw new Error(`batch read failed: ${error.message}`);
  return Number(data.remaining_weight_kg);
}

async function countRows(table, filters) {
  let query = service.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

async function lineState(lineId) {
  const { data, error } = await service
    .from("stock_count_lines")
    .select("applied_at, correction_movement_id")
    .eq("id", lineId)
    .single();
  if (error) throw new Error(`line read failed: ${error.message}`);
  return data;
}

async function cleanupRows() {
  for (const sessionId of cleanup.sessionIds) {
    await service.from("ops_checklist_sessions").delete().eq("id", sessionId);
  }
  for (const batchId of cleanup.batchIds) {
    await service.from("inventory_movements").delete().eq("batch_id", batchId);
    await service.from("inventory_waste_events").delete().eq("batch_id", batchId);
    await service.from("inventory_batches").delete().eq("id", batchId);
  }
}

async function staleAfterWaste(manager) {
  const batchId = await createBatch(manager, "waste");
  const sessionId = await startStockCount(manager, 0);
  const lineId = await recordLine(manager, sessionId, batchId, 8);

  const waste = await manager.rpc("admin_record_inventory_waste", {
    p_batch_id: batchId,
    p_quantity_kg: 2,
    p_reason: "expired",
  });
  check("waste after count succeeds", !waste.error, waste.error?.message);

  const beforeRemaining = await remainingKg(batchId);
  const beforeAdjustmentMovements = await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" });
  const beforeApplyAudits = await countRows("audit_logs", { event_type: "stock_count_line_applied", target_id: batchId });

  const apply = await manager.rpc("ops_apply_stock_count_line", { p_session_id: sessionId, p_line_id: lineId });
  check("waste after count then apply is stale-rejected", !!apply.error && /STALE_STOCK_COUNT/.test(apply.error.message), apply.error?.message);
  check("stale rejection does not change inventory after waste", (await remainingKg(batchId)) === beforeRemaining, `before=${beforeRemaining} after=${await remainingKg(batchId)}`);
  check(
    "stale rejection writes no correction movement after waste",
    (await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" })) === beforeAdjustmentMovements,
  );
  check(
    "stale rejection emits no success audit after waste",
    (await countRows("audit_logs", { event_type: "stock_count_line_applied", target_id: batchId })) === beforeApplyAudits,
  );

  const line = await lineState(lineId);
  check("stale rejection leaves count line unapplied after waste", line.applied_at === null && line.correction_movement_id === null, JSON.stringify(line));
}

async function staleAfterAdjustment(manager) {
  const batchId = await createBatch(manager, "adjust");
  const sessionId = await startStockCount(manager, 1);
  const lineId = await recordLine(manager, sessionId, batchId, 8);

  const adjustment = await manager.rpc("admin_adjust_inventory_remaining", {
    p_batch_id: batchId,
    p_new_remaining_kg: 9,
    p_reason: `manual v12.5 ${RUN}`,
  });
  check("manual adjustment after count succeeds", !adjustment.error, adjustment.error?.message);

  const beforeRemaining = await remainingKg(batchId);
  const beforeAdjustmentMovements = await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" });
  const beforeApplyAudits = await countRows("audit_logs", { event_type: "stock_count_line_applied", target_id: batchId });

  const apply = await manager.rpc("ops_apply_stock_count_line", { p_session_id: sessionId, p_line_id: lineId });
  check("adjustment after count then apply is stale-rejected", !!apply.error && /STALE_STOCK_COUNT/.test(apply.error.message), apply.error?.message);
  check("stale rejection does not change inventory after adjustment", (await remainingKg(batchId)) === beforeRemaining, `before=${beforeRemaining}`);
  check(
    "stale rejection writes no extra adjustment movement",
    (await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" })) === beforeAdjustmentMovements,
  );
  check(
    "stale rejection emits no success audit after adjustment",
    (await countRows("audit_logs", { event_type: "stock_count_line_applied", target_id: batchId })) === beforeApplyAudits,
  );
}

async function concurrentSameLine(manager, owner) {
  const batchId = await createBatch(manager, "concurrent");
  const sessionId = await startStockCount(manager, 2);
  const lineId = await recordLine(manager, sessionId, batchId, 7);

  const beforeMovements = await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" });
  const results = await Promise.all([
    manager.rpc("ops_apply_stock_count_line", { p_session_id: sessionId, p_line_id: lineId }),
    owner.rpc("ops_apply_stock_count_line", { p_session_id: sessionId, p_line_id: lineId }),
  ]);

  const successCount = results.filter((result) => !result.error && result.data === lineId).length;
  const afterMovements = await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" });
  check("concurrent same-line applies return deterministic success", successCount === 2, results.map((r) => r.error?.message ?? r.data).join(" | "));
  check("concurrent same-line applies create exactly one correction movement", afterMovements === beforeMovements + 1, `before=${beforeMovements} after=${afterMovements}`);
  check("concurrent same-line applies do not clobber final stock", (await remainingKg(batchId)) === 7, `remaining=${await remainingKg(batchId)}`);
}

async function branchMismatchDenied(manager, branchBManager) {
  const batchId = await createBatch(manager, "branch");
  const sessionId = await startStockCount(manager, 3);
  const lineId = await recordLine(manager, sessionId, batchId, 8);

  const apply = await branchBManager.rpc("ops_apply_stock_count_line", { p_session_id: sessionId, p_line_id: lineId });
  check("branch mismatch remains denied", !!apply.error && /Not authorised/.test(apply.error.message), apply.error?.message);
  check("branch-denied apply does not change inventory", (await remainingKg(batchId)) === 10, `remaining=${await remainingKg(batchId)}`);
}

async function negativeStockImpossible(manager) {
  const batchId = await createBatch(manager, "negative", { remaining: 3 });
  const waste = await manager.rpc("admin_record_inventory_waste", {
    p_batch_id: batchId,
    p_quantity_kg: 4,
    p_reason: "expired",
  });
  check("negative stock remains impossible", !!waste.error && /cannot exceed remaining/i.test(waste.error.message), waste.error?.message);
  check("negative stock rejection leaves inventory unchanged", (await remainingKg(batchId)) === 3, `remaining=${await remainingKg(batchId)}`);
}

async function existingWorkflowStillPasses(manager) {
  const batchId = await createBatch(manager, "happy");
  const sessionId = await startStockCount(manager, 4);
  const lineId = await recordLine(manager, sessionId, batchId, 6);
  const apply = await manager.rpc("ops_apply_stock_count_line", { p_session_id: sessionId, p_line_id: lineId });
  check("fresh stock-count apply still succeeds", !apply.error && apply.data === lineId, apply.error?.message);
  check("fresh stock-count apply corrects stock", (await remainingKg(batchId)) === 6, `remaining=${await remainingKg(batchId)}`);

  const beforeMovements = await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" });
  const applyAgain = await manager.rpc("ops_apply_stock_count_line", { p_session_id: sessionId, p_line_id: lineId });
  const afterMovements = await countRows("inventory_movements", { batch_id: batchId, movement_type: "ADJUSTMENT" });
  check("fresh stock-count re-apply remains idempotent", !applyAgain.error && afterMovements === beforeMovements, `before=${beforeMovements} after=${afterMovements}`);
}

async function main() {
  const manager = await sessionClient("manager@ptm.test");
  const owner = await sessionClient("owner@ptm.test");
  const branchBManager = await sessionClient("staff.b@ptm.test");

  const { data: branchBProfile } = await service.from("profiles").select("id, role, branch_id").eq("email", "staff.b@ptm.test").single();
  if (!branchBProfile || branchBProfile.branch_id !== BRANCH_B) {
    throw new Error("staff.b@ptm.test branch-B profile is required for branch mismatch verification");
  }

  await service.from("profiles").update({ role: "manager" }).eq("id", branchBProfile.id);

  try {
    await staleAfterWaste(manager);
    await staleAfterAdjustment(manager);
    await concurrentSameLine(manager, owner);
    await branchMismatchDenied(manager, branchBManager);
    await negativeStockImpossible(manager);
    await existingWorkflowStillPasses(manager);
  } finally {
    await service.from("profiles").update({ role: branchBProfile.role }).eq("id", branchBProfile.id);
    await cleanupRows();
  }

  console.log(failures === 0 ? "\nALL INVENTORY INTEGRITY CHECKS PASSED" : `\n${failures} INVENTORY INTEGRITY CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("verify-inventory-integrity crashed:", error.message ?? error);
  await cleanupRows().catch(() => {});
  process.exit(1);
});
