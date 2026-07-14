import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  return Object.fromEntries(
    text.split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
}

const env = loadLocalEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) throw new Error("Local Supabase keys are missing from .env.local.");

const BRANCH = "00000000-0000-4000-8000-000000000001";
const MANAGER_EMAIL = "manager@ptm.test";
const MANAGER_PASSWORD = "PlaiceTest123!";
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const manager = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const productIds = [];
const batchIds = [];
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function insertProduct(values) {
  const id = crypto.randomUUID();
  const { error } = await admin.from("products").insert({
    id,
    branch_id: BRANCH,
    name: `V18 policy ${suffix} ${values.unit_type}`,
    slug: `v18-policy-${suffix}-${id.slice(0, 8)}`,
    price_per_unit: 5,
    is_available: true,
    stock_status: "in_stock",
    ...values,
  });
  if (!error) productIds.push(id);
  return { id, error };
}

async function main() {
  const signIn = await manager.auth.signInWithPassword({ email: MANAGER_EMAIL, password: MANAGER_PASSWORD });
  if (signIn.error) throw new Error(`Manager sign-in failed: ${signIn.error.message}`);

  const missingPolicy = await insertProduct({ unit_type: "each" });
  check("direct each write cannot inherit the kg_batch default", !!missingPolicy.error, missingPolicy.error?.message ?? "unexpected success");

  const wrongPolicy = await insertProduct({ unit_type: "box", inventory_policy: "kg_batch" });
  check("unit-policy constraint rejects counted stock for a box", !!wrongPolicy.error, wrongPolicy.error?.message ?? "unexpected success");

  const each = await insertProduct({ unit_type: "each", inventory_policy: "untracked_manual", stock_status: "low_stock" });
  check("direct each write accepts untracked_manual", !each.error, each.error?.message ?? "");
  const box = await insertProduct({ unit_type: "box", inventory_policy: "untracked_manual" });
  check("direct box write accepts untracked_manual", !box.error, box.error?.message ?? "");
  const manualKg = await insertProduct({ unit_type: "kg", inventory_policy: "untracked_manual" });
  check("a deliberately manual kg product is allowed", !manualKg.error, manualKg.error?.message ?? "");
  const trackedKg = await insertProduct({ unit_type: "kg", inventory_policy: "kg_batch" });
  check("kg_batch remains the counted kg path", !trackedKg.error, trackedKg.error?.message ?? "");

  const blockedBatch = await admin.from("inventory_batches").insert({
    id: crypto.randomUUID(),
    branch_id: BRANCH,
    product_id: each.id,
    received_date: new Date().toISOString().slice(0, 10),
    expiry_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    received_weight_kg: 5,
    remaining_weight_kg: 5,
    invoice_cost: 10,
    cost_per_kg: 2,
    status: "active",
  });
  check("batch trigger blocks an untracked product", !!blockedBatch.error && /not counted/i.test(blockedBatch.error.message), blockedBatch.error?.message ?? "unexpected success");

  const trackedBatchId = crypto.randomUUID();
  const trackedBatch = await admin.from("inventory_batches").insert({
    id: trackedBatchId,
    branch_id: BRANCH,
    product_id: trackedKg.id,
    received_date: new Date().toISOString().slice(0, 10),
    expiry_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    received_weight_kg: 5,
    remaining_weight_kg: 5,
    invoice_cost: 10,
    cost_per_kg: 2,
    status: "active",
  });
  if (!trackedBatch.error) batchIds.push(trackedBatchId);
  check("batch trigger preserves the tracked kg path", !trackedBatch.error, trackedBatch.error?.message ?? "");

  const category = await admin.from("product_categories").select("id").eq("branch_id", BRANCH).limit(1).maybeSingle();
  const created = await manager.rpc("admin_create_product", {
    p_branch_id: BRANCH,
    p_name: `V18 RPC each ${suffix}`,
    p_description: "policy verifier",
    p_price: 7.5,
    p_category_id: category.data?.id ?? null,
    p_unit_type: "each",
    p_stock_status: "in_stock",
  });
  if (created.data) productIds.push(String(created.data));
  const createdRow = created.data
    ? await admin.from("products").select("unit_type,inventory_policy").eq("id", created.data).maybeSingle()
    : { data: null };
  check(
    "admin_create_product derives untracked_manual without a policy input",
    !created.error && createdRow.data?.unit_type === "each" && createdRow.data?.inventory_policy === "untracked_manual",
    created.error?.message ?? JSON.stringify(createdRow.data),
  );

  const ownerChosenKg = await manager.rpc("admin_create_product_v18", {
    p_branch_id: BRANCH,
    p_name: `V18 owner untracked kg ${suffix}`,
    p_description: "explicit owner stock choice",
    p_price: 8.25,
    p_category_id: category.data?.id ?? null,
    p_unit_type: "kg",
    p_stock_status: "in_stock",
    p_untracked_kg: true,
  });
  if (ownerChosenKg.data) productIds.push(String(ownerChosenKg.data));
  const ownerChosenRow = ownerChosenKg.data
    ? await admin.from("products").select("unit_type,inventory_policy").eq("id", ownerChosenKg.data).maybeSingle()
    : { data: null };
  check(
    "owner can atomically create a deliberately uncounted kg product",
    !ownerChosenKg.error && ownerChosenRow.data?.unit_type === "kg" && ownerChosenRow.data?.inventory_policy === "untracked_manual",
    ownerChosenKg.error?.message ?? JSON.stringify(ownerChosenRow.data),
  );
  const ownerChoiceAudit = ownerChosenKg.data
    ? await admin.from("audit_logs").select("id").eq("target_id", ownerChosenKg.data).contains("metadata", { action: "stock_counting_changed" })
    : { data: [] };
  check("owner kg stock choice is audited", (ownerChoiceAudit.data?.length ?? 0) === 1, JSON.stringify(ownerChoiceAudit.data));

  const invalidChoiceName = `V18 invalid untracked each ${suffix}`;
  const invalidChoice = await manager.rpc("admin_create_product_v18", {
    p_branch_id: BRANCH,
    p_name: invalidChoiceName,
    p_description: null,
    p_price: 4,
    p_category_id: category.data?.id ?? null,
    p_unit_type: "each",
    p_stock_status: "in_stock",
    p_untracked_kg: true,
  });
  const invalidChoiceRows = await admin.from("products").select("id", { count: "exact", head: true }).eq("branch_id", BRANCH).eq("name", invalidChoiceName);
  check(
    "invalid create choice rolls back without a partial product",
    !!invalidChoice.error && (invalidChoiceRows.count ?? 0) === 0,
    invalidChoice.error?.message ?? `rows=${invalidChoiceRows.count}`,
  );

  const stopCounting = await manager.rpc("admin_set_product_stock_counting_v18", {
    p_product_id: trackedKg.id,
    p_stock_counted: false,
  });
  const stoppedRow = await admin.from("products").select("inventory_policy").eq("id", trackedKg.id).maybeSingle();
  check(
    "owner can explicitly stop counting an existing kg product",
    !stopCounting.error && stoppedRow.data?.inventory_policy === "untracked_manual",
    stopCounting.error?.message ?? JSON.stringify(stoppedRow.data),
  );
  const staleWaste = await manager.rpc("admin_record_inventory_waste", {
    p_batch_id: trackedBatchId,
    p_quantity_kg: 0.25,
    p_reason: "other",
  });
  const staleAdjust = await manager.rpc("admin_adjust_inventory_remaining", {
    p_batch_id: trackedBatchId,
    p_new_remaining_kg: 4.5,
    p_reason: "stale screen",
  });
  const staleCost = await manager.rpc("admin_set_delivery_cost", {
    p_batch_id: trackedBatchId,
    p_invoice_cost: 12,
  });
  const frozenBatch = await admin
    .from("inventory_batches")
    .select("remaining_weight_kg,invoice_cost")
    .eq("id", trackedBatchId)
    .maybeSingle();
  const staleWasteFacts = await admin
    .from("inventory_waste_events")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", trackedBatchId);
  check(
    "stale stock forms cannot mutate a newly untracked kg batch",
    !!staleWaste.error &&
      !!staleAdjust.error &&
      !!staleCost.error &&
      Number(frozenBatch.data?.remaining_weight_kg) === 5 &&
      Number(frozenBatch.data?.invoice_cost) === 10 &&
      (staleWasteFacts.count ?? 0) === 0,
    [staleWaste.error?.message, staleAdjust.error?.message, staleCost.error?.message].filter(Boolean).join(" | "),
  );
  const unsafeRestart = await manager.rpc("admin_set_product_stock_counting_v18", {
    p_product_id: trackedKg.id,
    p_stock_counted: true,
  });
  check(
    "old batch history cannot be silently reactivated",
    !!unsafeRestart.error && /old batch history/i.test(unsafeRestart.error.message),
    unsafeRestart.error?.message ?? "unexpected success",
  );

  const changeUntrackedToEach = await manager.rpc("admin_update_product", {
    p_product_id: trackedKg.id,
    p_name: `V18 history guard each ${suffix}`,
    p_description: "unit path history guard",
    p_category_id: category.data?.id ?? null,
    p_unit_type: "each",
  });
  const unsafeUnitRestart = await manager.rpc("admin_update_product", {
    p_product_id: trackedKg.id,
    p_name: `V18 history guard kg ${suffix}`,
    p_description: "unit path history guard",
    p_category_id: category.data?.id ?? null,
    p_unit_type: "kg",
  });
  check(
    "unit edits cannot bypass the old-batch reactivation guard",
    !changeUntrackedToEach.error && !!unsafeUnitRestart.error && /old batch history/i.test(unsafeUnitRestart.error.message),
    changeUntrackedToEach.error?.message ?? unsafeUnitRestart.error?.message ?? "unexpected success",
  );

  const safeRestart = await manager.rpc("admin_set_product_stock_counting_v18", {
    p_product_id: manualKg.id,
    p_stock_counted: true,
  });
  const restartedRow = await admin.from("products").select("inventory_policy").eq("id", manualKg.id).maybeSingle();
  check(
    "stock counting can start when no stale batch history exists",
    !safeRestart.error && restartedRow.data?.inventory_policy === "kg_batch",
    safeRestart.error?.message ?? JSON.stringify(restartedRow.data),
  );

  if (created.data) {
    const toKg = await manager.rpc("admin_update_product", {
      p_product_id: created.data,
      p_name: `V18 RPC kg ${suffix}`,
      p_description: "policy verifier",
      p_category_id: category.data?.id ?? null,
      p_unit_type: "kg",
    });
    const kgRow = await admin.from("products").select("unit_type,inventory_policy").eq("id", created.data).maybeSingle();
    check("admin_update_product derives kg_batch when changing to kg", !toKg.error && kgRow.data?.inventory_policy === "kg_batch", toKg.error?.message ?? JSON.stringify(kgRow.data));

    const toBox = await manager.rpc("admin_update_product", {
      p_product_id: created.data,
      p_name: `V18 RPC box ${suffix}`,
      p_description: "policy verifier",
      p_category_id: category.data?.id ?? null,
      p_unit_type: "box",
    });
    const boxRow = await admin.from("products").select("unit_type,inventory_policy").eq("id", created.data).maybeSingle();
    check("admin_update_product derives untracked_manual when changing to box", !toBox.error && boxRow.data?.inventory_policy === "untracked_manual", toBox.error?.message ?? JSON.stringify(boxRow.data));
  }

  const manualAvailability = await admin.from("products").select("stock_status").eq("id", each.id).maybeSingle();
  check("untracked public availability remains manually set", manualAvailability.data?.stock_status === "low_stock", JSON.stringify(manualAvailability.data));
}

try {
  await main();
} finally {
  if (batchIds.length > 0) await admin.from("inventory_batches").delete().in("id", batchIds);
  if (productIds.length > 0) await admin.from("products").delete().in("id", productIds);
  await manager.auth.signOut();
}

console.log(`Inventory policy verification: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
