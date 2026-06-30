// Phase 0 / F1 - Truth-table write-lock guard (regression for audit C1).
//
// Proves that after the 202606290900 lock migration, a normal authenticated
// app role (manager) CANNOT directly mutate the core truth tables through
// PostgREST, while the controlled RPC / service paths still work.
//
// Highest-value regression test in the hardening sprint.
//
// Run: node scripts/verify-truth-table-lock.mjs   (local Supabase must be running + seeded)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const CHICKEN_CATEGORY = "00000000-0000-4000-8000-000000000101";
const MANAGER_EMAIL = "manager@ptm.test";
const MANAGER_PASSWORD = "PlaiceTest123!";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !ANON || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE in .env.local");
  process.exit(2);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0;
let fail = 0;
const log = (s) => console.log(s);
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    log(`  PASS  ${name}${detail ? "  ::  " + detail : ""}`);
  } else {
    fail++;
    log(`  FAIL  ${name}${detail ? "  ::  " + detail : ""}`);
  }
}

const uniq = () => Math.random().toString(36).slice(2, 10);

// A write is "rejected" if it errors OR silently affects zero rows (RLS hiding
// the row from a write also counts as not-mutated). We verify by re-reading
// the value with the admin client.
async function newProduct() {
  const id = crypto.randomUUID();
  const slug = `lock-${uniq()}`;
  const { error } = await admin.from("products").insert({
    id,
    branch_id: BRANCH,
    category_id: CHICKEN_CATEGORY,
    name: `Lock ${slug}`,
    slug,
    unit_type: "kg",
    price_per_unit: 10,
    is_available: true,
    stock_status: "in_stock",
  });
  if (error) throw new Error(`product insert: ${error.message}`);
  return id;
}

async function newBatch(productId, remainingKg) {
  const id = crypto.randomUUID();
  const today = new Date();
  const exp = new Date(today.getTime() + 30 * 86400000);
  const { error } = await admin.from("inventory_batches").insert({
    id,
    branch_id: BRANCH,
    product_id: productId,
    received_date: today.toISOString().slice(0, 10),
    expiry_date: exp.toISOString().slice(0, 10),
    received_weight_kg: remainingKg,
    remaining_weight_kg: remainingKg,
    cost_per_kg: 5,
  });
  if (error) throw new Error(`batch insert: ${error.message}`);
  return id;
}

async function newOrder() {
  const id = crypto.randomUUID();
  const { error } = await admin.from("orders").insert({
    id,
    branch_id: BRANCH,
    order_ref: `LOCK-${uniq()}`,
    customer_name: "Lock probe",
    customer_phone: "07000000000",
    status: "incoming",
    pickup_date: new Date().toISOString().slice(0, 10),
    subtotal: 10,
    is_test: true,
    idempotency_key: `lock-${uniq()}`,
    idempotency_fingerprint: `lock-${uniq()}`,
  });
  if (error) throw new Error(`order insert: ${error.message}`);
  const itemId = crypto.randomUUID();
  const { error: iErr } = await admin.from("order_items").insert({
    id: itemId,
    branch_id: BRANCH,
    order_id: id,
    product_name_snapshot: "Lock item",
    quantity: 1,
    unit_type: "kg",
    unit_price_snapshot: 10,
    line_total: 10,
  });
  if (iErr) throw new Error(`order_item insert: ${iErr.message}`);
  return { orderId: id, itemId };
}

async function main() {
  const manager = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await manager.auth.signInWithPassword({
    email: MANAGER_EMAIL,
    password: MANAGER_PASSWORD,
  });
  if (signErr) throw new Error(`manager sign-in failed: ${signErr.message}`);

  const productId = await newProduct();
  const batchId = await newBatch(productId, 5);
  const { orderId, itemId } = await newOrder();

  // --- inventory_batches: direct UPDATE must NOT change stock ---
  await manager.from("inventory_batches").update({ remaining_weight_kg: 4.123 }).eq("id", batchId);
  let { data: b } = await admin.from("inventory_batches").select("remaining_weight_kg").eq("id", batchId).single();
  check("inventory_batches.remaining_weight_kg direct UPDATE rejected", Number(b.remaining_weight_kg) === 5, `remaining=${b.remaining_weight_kg}`);

  // --- inventory_batches: direct INSERT must NOT create a row ---
  const ghostBatch = crypto.randomUUID();
  await manager.from("inventory_batches").insert({
    id: ghostBatch,
    branch_id: BRANCH,
    product_id: productId,
    received_date: new Date().toISOString().slice(0, 10),
    received_weight_kg: 9,
    remaining_weight_kg: 9,
    cost_per_kg: 1,
  });
  let { data: ghost } = await admin.from("inventory_batches").select("id").eq("id", ghostBatch).maybeSingle();
  check("inventory_batches direct INSERT rejected", ghost === null);

  // --- inventory_batches: direct DELETE must NOT remove the row ---
  await manager.from("inventory_batches").delete().eq("id", batchId);
  ({ data: b } = await admin.from("inventory_batches").select("id").eq("id", batchId).maybeSingle());
  check("inventory_batches direct DELETE rejected", b !== null);

  // --- orders: direct status PATCH to 'collected' must be rejected ---
  await manager.from("orders").update({ status: "collected" }).eq("id", orderId);
  let { data: o } = await admin.from("orders").select("status").eq("id", orderId).single();
  check("orders.status direct UPDATE -> collected rejected", o.status === "incoming", `status=${o.status}`);

  // --- order_items: direct quantity PATCH must be rejected ---
  await manager.from("order_items").update({ quantity: 99 }).eq("id", itemId);
  let { data: it } = await admin.from("order_items").select("quantity,unit_price_snapshot").eq("id", itemId).single();
  check("order_items.quantity direct UPDATE rejected", Number(it.quantity) === 1, `quantity=${it.quantity}`);

  // --- order_items: direct unit_price PATCH must be rejected ---
  await manager.from("order_items").update({ unit_price_snapshot: 0.01 }).eq("id", itemId);
  ({ data: it } = await admin.from("order_items").select("unit_price_snapshot").eq("id", itemId).single());
  check("order_items.unit_price direct UPDATE rejected", Number(it.unit_price_snapshot) === 10, `price=${it.unit_price_snapshot}`);

  // --- controlled path still works: transition_order_status via RPC ---
  // (manager is branch staff; the SECURITY DEFINER RPC validates and moves state)
  const { error: tErr } = await manager.rpc("transition_order_status", {
    p_order_id: orderId,
    p_next_status: "prepping",
    p_note: "lock probe controlled path",
  });
  ({ data: o } = await admin.from("orders").select("status").eq("id", orderId).single());
  check("controlled RPC transition_order_status still works", !tErr && o.status === "prepping", tErr ? tErr.message : `status=${o.status}`);

  // cleanup
  await admin.from("orders").delete().eq("id", orderId);
  await admin.from("inventory_batches").delete().eq("id", batchId);
  await admin.from("products").delete().eq("id", productId);

  log("");
  log(`Truth-table lock guard: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
