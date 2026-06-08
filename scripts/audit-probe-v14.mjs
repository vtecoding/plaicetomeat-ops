// V14.1 sale -> stock truth probe.
// Drives the REAL authenticated RPC path against the local Supabase stack and
// proves: collected order depletes stock, SALE movement written, idempotent,
// concurrency-safe, oversell allowed+flagged, each/box not depleted, FEFO order.
//
// Run: node scripts/audit-probe-v14.mjs   (local Supabase must be running)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const CHICKEN_CATEGORY = "00000000-0000-4000-8000-000000000101";
const STAFF_EMAIL = "staff@ptm.test";
const STAFF_PASSWORD = "PlaiceTest123!";

// --- env ---
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

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

async function newProduct(unitType) {
  const id = crypto.randomUUID();
  const slug = `probe-${unitType}-${uniq()}`;
  const { error } = await admin.from("products").insert({
    id,
    branch_id: BRANCH,
    category_id: CHICKEN_CATEGORY,
    name: `Probe ${unitType} ${slug}`,
    slug,
    unit_type: unitType,
    price_per_unit: 10,
    is_available: true,
    stock_status: "in_stock",
  });
  if (error) throw new Error(`product insert: ${error.message}`);
  return id;
}

async function newBatch(productId, remainingKg, expiryOffsetDays) {
  const id = crypto.randomUUID();
  const today = new Date();
  const exp = new Date(today.getTime() + expiryOffsetDays * 86400000);
  const { error } = await admin.from("inventory_batches").insert({
    id,
    branch_id: BRANCH,
    product_id: productId,
    received_date: today.toISOString().slice(0, 10),
    expiry_date: exp.toISOString().slice(0, 10),
    received_weight_kg: remainingKg,
    remaining_weight_kg: remainingKg,
    cost_per_kg: 5,
    status: "active",
  });
  if (error) throw new Error(`batch insert: ${error.message}`);
  return id;
}

async function newReadyOrder(lines) {
  const id = crypto.randomUUID();
  const ref = `PROBE-${Date.now()}-${uniq()}`;
  const { error } = await admin.from("orders").insert({
    id,
    branch_id: BRANCH,
    order_ref: ref,
    customer_name: "Probe Customer",
    customer_phone: "+441210000000",
    status: "ready",
    pickup_date: new Date().toISOString().slice(0, 10),
    subtotal: 10,
    idempotency_key: `probe-${id}`,
  });
  if (error) throw new Error(`order insert: ${error.message}`);
  for (const ln of lines) {
    const { error: e2 } = await admin.from("order_items").insert({
      branch_id: BRANCH,
      order_id: id,
      product_id: ln.productId,
      product_name_snapshot: ln.name ?? "Probe item",
      quantity: ln.qty,
      unit_type: ln.unitType,
      unit_price_snapshot: 10,
      line_total: 10,
    });
    if (e2) throw new Error(`order_item insert: ${e2.message}`);
  }
  return id;
}

const remainingOf = async (batchId) => {
  const { data } = await admin.from("inventory_batches").select("remaining_weight_kg,status").eq("id", batchId).single();
  return data;
};
const saleMovements = async (orderId) => {
  const { data } = await admin
    .from("inventory_movements")
    .select("delta_kg,balance_before_kg,balance_after_kg,quantity_kg,source_event,batch_id")
    .eq("order_id", orderId)
    .eq("source_event", "SALE_COLLECT");
  return data ?? [];
};
const guardOf = async (orderId) => {
  const { data } = await admin
    .from("order_inventory_depletions")
    .select("*")
    .eq("order_id", orderId)
    .eq("source_event", "SALE_COLLECT")
    .maybeSingle();
  return data;
};
const auditCount = async (orderId, type) => {
  const { count } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("target_id", orderId)
    .eq("event_type", type);
  return count ?? 0;
};

async function main() {
  const staff = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await staff.auth.signInWithPassword({ email: STAFF_EMAIL, password: STAFF_PASSWORD });
  if (signErr) throw new Error(`staff sign-in failed: ${signErr.message}`);
  const collect = (orderId) => staff.rpc("transition_order_status", { p_order_id: orderId, p_next_status: "collected" });

  // ── Scenario A: basic sale -> stock + SALE movement + audit ──────────────
  log("\n[A] Collected order depletes stock");
  {
    const product = await newProduct("kg");
    const batch = await newBatch(product, 5.0, 3);
    const order = await newReadyOrder([{ productId: product, name: "Probe Chicken", qty: 1.0, unitType: "kg" }]);
    const before = await remainingOf(batch);
    const { error } = await collect(order);
    check("transition to collected succeeds", !error, error ? error.message : "");
    const after = await remainingOf(batch);
    log(`      stock before=${before.remaining_weight_kg}kg  after=${after.remaining_weight_kg}kg`);
    check("stock dropped by exactly 1.000kg", Number(before.remaining_weight_kg) - Number(after.remaining_weight_kg) === 1.0);
    const mv = await saleMovements(order);
    check("exactly one SALE movement written", mv.length === 1, `count=${mv.length}`);
    check("movement is signed -1.000 with balances", mv[0] && Number(mv[0].delta_kg) === -1.0 && Number(mv[0].balance_before_kg) === 5.0 && Number(mv[0].balance_after_kg) === 4.0);
    const g = await guardOf(order);
    check("depletion summary recorded 'completed'", g && g.status === "completed" && Number(g.total_depleted_kg) === 1.0);
    check("audit 'inventory_depleted_for_order' written", (await auditCount(order, "inventory_depleted_for_order")) === 1);
  }

  // ── Scenario B: idempotency (repeat collect does not double-deplete) ─────
  log("\n[B] Repeated depletion does not double-deplete");
  {
    const product = await newProduct("kg");
    const batch = await newBatch(product, 5.0, 3);
    const order = await newReadyOrder([{ productId: product, name: "Probe Chicken", qty: 1.0, unitType: "kg" }]);
    await collect(order);
    const afterFirst = await remainingOf(batch);
    // Re-run the depletion engine directly (idempotency guard must short-circuit).
    const { error: e2 } = await staff.rpc("deplete_order_inventory", { p_order_id: order });
    check("second depletion call returns without error", !e2, e2 ? e2.message : "");
    const afterSecond = await remainingOf(batch);
    check("stock unchanged after repeat", Number(afterFirst.remaining_weight_kg) === Number(afterSecond.remaining_weight_kg), `${afterFirst.remaining_weight_kg} == ${afterSecond.remaining_weight_kg}`);
    const mv = await saleMovements(order);
    check("still exactly one SALE movement", mv.length === 1, `count=${mv.length}`);
  }

  // ── Scenario C: concurrency (two collects race, one depletion only) ──────
  log("\n[C] Concurrent collection depletes once");
  {
    const product = await newProduct("kg");
    const batch = await newBatch(product, 5.0, 3);
    const order = await newReadyOrder([{ productId: product, name: "Probe Chicken", qty: 1.0, unitType: "kg" }]);
    const before = await remainingOf(batch);
    const results = await Promise.allSettled([collect(order), collect(order)]);
    const ok = results.filter((r) => r.status === "fulfilled" && !r.value.error).length;
    const after = await remainingOf(batch);
    log(`      concurrent successes=${ok}  stock ${before.remaining_weight_kg}->${after.remaining_weight_kg}`);
    check("stock dropped by exactly 1.000kg (not 2)", Number(before.remaining_weight_kg) - Number(after.remaining_weight_kg) === 1.0);
    const mv = await saleMovements(order);
    check("exactly one SALE movement after race", mv.length === 1, `count=${mv.length}`);
    const { data: guards } = await admin.from("order_inventory_depletions").select("id").eq("order_id", order);
    check("exactly one depletion guard row", guards.length === 1, `count=${guards.length}`);
  }

  // ── Scenario D: oversell -> allow + flag, never negative ─────────────────
  log("\n[D] Oversell allowed and flagged, never negative");
  {
    const product = await newProduct("kg");
    const batch = await newBatch(product, 0.3, 3);
    const order = await newReadyOrder([{ productId: product, name: "Probe Chicken", qty: 1.0, unitType: "kg" }]);
    const { error } = await collect(order);
    check("collection still completes (handover not blocked)", !error, error ? error.message : "");
    const after = await remainingOf(batch);
    check("stock floored at 0 (never negative)", Number(after.remaining_weight_kg) === 0 && after.status === "depleted", `remaining=${after.remaining_weight_kg} status=${after.status}`);
    const g = await guardOf(order);
    check("shortfall recorded (0.700kg)", g && g.status === "completed_with_shortfall" && Number(g.shortfall_kg) === 0.7, g ? `shortfall=${g.shortfall_kg}` : "no guard");
    check("audit 'inventory_depletion_shortfall' written", (await auditCount(order, "inventory_depletion_shortfall")) === 1);
    const { data: ord } = await admin.from("orders").select("status").eq("id", order).single();
    check("order is collected", ord.status === "collected");
  }

  // ── Scenario E: each/box products are not weight-tracked ─────────────────
  log("\n[E] Each/box products stay sellable, not depleted");
  {
    const product = await newProduct("each");
    const order = await newReadyOrder([{ productId: product, name: "Probe Whole Chicken", qty: 2, unitType: "each" }]);
    const { error } = await collect(order);
    check("collection completes", !error, error ? error.message : "");
    const mv = await saleMovements(order);
    check("no SALE movement for an each product", mv.length === 0, `count=${mv.length}`);
    const g = await guardOf(order);
    check("recorded as non-weight-tracked line", g && g.non_weight_tracked_lines === 1 && g.weight_tracked_lines === 0);
  }

  // ── Scenario F: FEFO - soonest expiry depletes first ─────────────────────
  log("\n[F] FEFO: soonest-expiry batch consumed first");
  {
    const product = await newProduct("kg");
    const soon = await newBatch(product, 1.0, 1); // expires tomorrow
    const later = await newBatch(product, 5.0, 10); // expires in 10 days
    const order = await newReadyOrder([{ productId: product, name: "Probe Chicken", qty: 1.5, unitType: "kg" }]);
    await collect(order);
    const soonAfter = await remainingOf(soon);
    const laterAfter = await remainingOf(later);
    log(`      soon(exp+1)=${soonAfter.remaining_weight_kg}  later(exp+10)=${laterAfter.remaining_weight_kg}`);
    check("soonest-expiry batch fully consumed first", Number(soonAfter.remaining_weight_kg) === 0 && soonAfter.status === "depleted");
    check("remainder taken from later batch (5.0 -> 4.5)", Number(laterAfter.remaining_weight_kg) === 4.5);
    const mv = await saleMovements(order);
    check("one SALE movement per batch touched (2)", mv.length === 2, `count=${mv.length}`);
  }

  log(`\n==== V14.1 probe: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e.message);
  process.exit(1);
});
