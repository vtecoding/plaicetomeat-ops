// V12.3 adversarial verification — Checkout Integrity.
//
// DB/RPC layer (always): proves server price authority, duplicate-SKU merge +
// per-product max enforcement, distinct-SKU cap, pickup-window capacity under
// concurrency (no overbooking), idempotency (one order per key), same-key/
// different-payload rejection, and the V12.1 direct-RPC denial (anon cannot call
// create_checkout_order).
//
// HTTP layer (optional, if CHECKOUT_BASE_URL / localhost reachable): proves the
// public /api/checkout enforces the same rate limit, body cap, and validation as
// the storefront action. Skips (does not fail) when no server is reachable.
//
// Exits non-zero on any unmet expectation.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const BASE_URL = process.env.CHECKOUT_BASE_URL ?? "http://127.0.0.1:3000";
const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const PRODUCT = "00000000-0000-4000-8000-000000000207"; // Family Curry Pack: min 1, max 4, GBP 35
const PRODUCT_PRICE = 35;
const PRODUCT_MAX = 4;
const RUN = randomUUID().slice(0, 8);

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
let skipped = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
}
function skip(name, why) {
  skipped += 1;
  console.log(`  SKIP ${name} (${why})`);
}

function datePlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PICKUP_DATE = datePlus(3);
let testWindowId = null; // generous capacity — functional checks
let capWindowId = null; // max_orders = 3 — concurrency proof only

function key(suffix) {
  return `vci-${RUN}-${suffix}`;
}

async function rpc(args) {
  return service.rpc("create_checkout_order", {
    p_branch_id: BRANCH_A,
    p_customer_name: "Integrity Tester",
    p_customer_phone: "+447700900123",
    p_customer_email: null,
    p_pickup_date: PICKUP_DATE,
    p_pickup_window_id: args.windowId ?? testWindowId,
    p_notes: null,
    p_idempotency_key: args.key,
    p_items: args.items,
    p_is_test: false,
  });
}

async function makeWindow(maxOrders, label) {
  const { data: tpl, error: tplErr } = await service
    .from("pickup_windows")
    .select("*")
    .eq("id", "00000000-0000-4000-8000-000000000302")
    .single();
  if (tplErr) throw new Error(`template window fetch failed: ${tplErr.message}`);

  const id = randomUUID();
  const row = { ...tpl };
  delete row.created_at;
  delete row.updated_at;
  row.id = id;
  row.label = `VCI ${RUN} ${label}`;
  row.days_of_week = [1, 2, 3, 4, 5, 6, 7];
  row.max_orders = maxOrders;
  row.is_active = true;

  const { error } = await service.from("pickup_windows").insert(row);
  if (error) throw new Error(`test window insert failed: ${error.message}`);
  return id;
}

async function setup() {
  testWindowId = await makeWindow(1000, "shared");
  capWindowId = await makeWindow(3, "capacity");
}

async function cleanup() {
  await service.from("orders").delete().like("idempotency_key", `vci-${RUN}-%`);
  for (const id of [testWindowId, capWindowId]) {
    if (id) await service.from("pickup_windows").delete().eq("id", id);
  }
  // Reset the checkout throttle bucket so other suites aren't affected.
  await service.from("public_rate_limits").delete().eq("bucket", "checkout");
}

async function orderItemsFor(orderRef) {
  const { data: order } = await service.from("orders").select("id, subtotal").eq("order_ref", orderRef).single();
  const { data: items } = await service
    .from("order_items")
    .select("product_id, quantity, unit_price_snapshot, line_total")
    .eq("order_id", order.id);
  return { order, items };
}

async function dbChecks() {
  // --- price authority: client cannot influence price (not even a param) -------
  {
    const r = await rpc({ key: key("price"), items: [{ productId: PRODUCT, quantity: 2 }] });
    check("checkout RPC succeeds for a valid order", !r.error && r.data?.orderRef, r.error?.message);
    if (r.data?.orderRef) {
      const { order, items } = await orderItemsFor(r.data.orderRef);
      check(
        "line price recomputed from product price (forged client price impossible)",
        items.length === 1 && Number(items[0].unit_price_snapshot) === PRODUCT_PRICE,
        `unit=${items[0]?.unit_price_snapshot}`,
      );
      check("subtotal recomputed server-side", Number(order.subtotal) === PRODUCT_PRICE * 2, `subtotal=${order.subtotal}`);
    }
  }

  // --- duplicate SKUs merge into one line, summed quantity --------------------
  {
    const r = await rpc({ key: key("merge"), items: [{ productId: PRODUCT, quantity: 1 }, { productId: PRODUCT, quantity: 2 }] });
    check("duplicate SKUs accepted and merged", !r.error && r.data?.orderRef, r.error?.message);
    if (r.data?.orderRef) {
      const { items } = await orderItemsFor(r.data.orderRef);
      check(
        "duplicate SKUs collapse to ONE line with summed quantity",
        items.length === 1 && Number(items[0].quantity) === 3,
        `lines=${items.length} qty=${items[0]?.quantity}`,
      );
    }
  }

  // --- duplicate SKUs cannot bypass per-product max (3+2=5 > max 4) -----------
  {
    const r = await rpc({ key: key("maxbypass"), items: [{ productId: PRODUCT, quantity: 3 }, { productId: PRODUCT, quantity: 2 }] });
    check(
      "merged quantity over per-product max is rejected (no dup-line bypass)",
      !!r.error && /no longer available/i.test(r.error.message),
      r.error ? r.error.message : `CREATED max=${PRODUCT_MAX}`,
    );
  }

  // --- distinct-SKU cap (31 distinct > 30) ------------------------------------
  {
    const many = Array.from({ length: 31 }, () => ({ productId: randomUUID(), quantity: 1 }));
    const r = await rpc({ key: key("toomany"), items: many });
    check("over-30 distinct SKUs rejected", !!r.error && /too many different items/i.test(r.error.message), r.error?.message ?? "CREATED");
  }

  // --- idempotency: same key + identical payload = one order ------------------
  {
    const k = key("idem");
    const items = [{ productId: PRODUCT, quantity: 1 }];
    const a = await rpc({ key: k, items });
    const b = await rpc({ key: k, items });
    check("idempotent retry returns the same order ref", !a.error && !b.error && a.data?.orderRef === b.data?.orderRef, `a=${a.data?.orderRef} b=${b.data?.orderRef}`);
    const { count } = await service.from("orders").select("id", { count: "exact", head: true }).eq("idempotency_key", k);
    check("idempotent retry creates exactly one order row", count === 1, `count=${count}`);
  }

  // --- same key + DIFFERENT payload is rejected ------------------------------
  {
    const k = key("idem-diff");
    const a = await rpc({ key: k, items: [{ productId: PRODUCT, quantity: 1 }] });
    const b = await rpc({ key: k, items: [{ productId: PRODUCT, quantity: 2 }] });
    check("same idempotency key with different payload is rejected", !a.error && !!b.error && /different details/i.test(b.error.message), b.error ? b.error.message : "ACCEPTED");
  }

  // --- capacity under concurrency: exactly max_orders, never more -------------
  {
    const N = 8;
    const calls = Array.from({ length: N }, (_, i) => rpc({ key: key(`cap-${i}`), windowId: capWindowId, items: [{ productId: PRODUCT, quantity: 1 }] }));
    const results = await Promise.all(calls);
    const ok = results.filter((r) => !r.error && r.data?.orderRef).length;
    const full = results.filter((r) => r.error && /full/i.test(r.error.message)).length;
    const { count } = await service
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("pickup_window_id", capWindowId)
      .neq("status", "cancelled");
    check("concurrent checkouts create EXACTLY max_orders (no overbooking)", count === 3, `committed=${count} ok=${ok} full=${full}`);
    check("overflow attempts rejected with 'full'", full === N - 3, `full=${full} expected=${N - 3}`);
  }

  // --- V12.1 seal: anon cannot call the mutation RPC -------------------------
  {
    const r = await anon.rpc("create_checkout_order", {
      p_branch_id: BRANCH_A,
      p_customer_name: "x",
      p_customer_phone: "+447700900123",
      p_customer_email: null,
      p_pickup_date: PICKUP_DATE,
      p_pickup_window_id: testWindowId,
      p_notes: null,
      p_idempotency_key: key("anon"),
      p_items: [{ productId: PRODUCT, quantity: 1 }],
      p_is_test: false,
    });
    check("anon direct create_checkout_order is DENIED (V12.1 seal intact)", !!r.error, r.error ? "(permission error)" : "CALLABLE!");
  }
}

async function reachable() {
  try {
    const res = await fetch(`${BASE_URL}/`, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

function httpBody(overrides = {}) {
  return JSON.stringify({
    branchId: BRANCH_A,
    customerName: "HTTP Tester",
    customerPhone: "07700900123",
    pickupDate: PICKUP_DATE,
    pickupWindowId: testWindowId,
    idempotencyKey: key(`http-${randomUUID().slice(0, 6)}`),
    basket: [{ productId: PRODUCT, productSlug: "family-curry-pack", name: "Family Curry Pack", quantity: 1, unitType: "box", unitPriceSnapshot: 35 }],
    ...overrides,
  });
}

async function httpChecks() {
  // Only run against an explicitly-provided app URL, so we never probe an
  // unrelated service that happens to occupy a default port.
  if (!process.env.CHECKOUT_BASE_URL) {
    skip("HTTP /api/checkout suite", "set CHECKOUT_BASE_URL to the running app to enable");
    return;
  }
  if (!(await reachable())) {
    skip("HTTP /api/checkout suite", `${BASE_URL} not reachable`);
    return;
  }

  async function post(body) {
    return fetch(`${BASE_URL}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body });
  }

  // body cap (413) for oversized payloads
  {
    const huge = JSON.stringify({ pad: "x".repeat(40 * 1024) });
    const res = await post(huge);
    check("/api/checkout rejects oversized body (413)", res.status === 413, `status=${res.status}`);
  }

  // malformed JSON (400)
  {
    const res = await post("{not json");
    check("/api/checkout rejects malformed JSON (400)", res.status === 400, `status=${res.status}`);
  }

  // forged price ignored: submit absurd unitPriceSnapshot, confirm stored price is DB price
  {
    const k = key(`http-forge-${randomUUID().slice(0, 6)}`);
    const res = await post(httpBody({ idempotencyKey: k, basket: [{ productId: PRODUCT, productSlug: "p", name: "p", quantity: 1, unitType: "box", unitPriceSnapshot: 0.01 }] }));
    const ok = res.status === 201;
    let priceOk = false;
    if (ok) {
      const body = await res.json();
      const { items } = await orderItemsFor(body.orderRef);
      priceOk = items.length === 1 && Number(items[0].unit_price_snapshot) === PRODUCT_PRICE;
    }
    check("/api/checkout ignores forged client price", ok && priceOk, `status=${res.status}`);
  }

  // rate limit trips before mutation after the bucket max (12/300s)
  {
    let saw429 = false;
    let created = 0;
    for (let i = 0; i < 16; i += 1) {
      const res = await post(httpBody());
      if (res.status === 429) saw429 = true;
      else if (res.status === 201) created += 1;
    }
    check("/api/checkout throttles abuse (429) using the checkout bucket", saw429, `created=${created}`);
    check("throttle stops mutation (created <= bucket max 12)", created <= 12, `created=${created}`);
  }
}

async function main() {
  console.log(`V12.3 checkout-integrity adversarial checks (run ${RUN})`);
  await setup();
  try {
    await dbChecks();
    await httpChecks();
  } finally {
    await cleanup();
  }

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} checkout-integrity check(s) FAILED (${skipped} skipped)`);
    process.exit(1);
  }
  console.log(`RESULT: all checkout-integrity checks PASSED (${skipped} skipped)`);
}

main().catch((err) => {
  console.error("verify-checkout-integrity crashed:", err);
  process.exit(1);
});
