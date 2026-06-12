import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.OPERATOR_SERVE_BASE_URL ?? "http://localhost:3002";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";

function loadLocalEnv() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Local env is optional; CI can provide real vars.
  }
}

loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase env missing.");

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

async function one(table, select, query) {
  let q = admin.from(table).select(select);
  q = query(q);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function many(table, select, query) {
  let q = admin.from(table).select(select);
  q = query(q);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function setupData() {
  const branch = await one("branches", "id", (q) => q.eq("is_active", true).order("created_at", { ascending: true }).limit(1));
  if (!branch) throw new Error("No active branch.");

  const supplier = await one("suppliers", "id", (q) => q.eq("branch_id", branch.id).eq("active", true).limit(1));
  if (!supplier) throw new Error("No active supplier.");

  const chicken = await one("products", "id,name,branch_id", (q) =>
    q.eq("branch_id", branch.id).eq("name", "Chicken Breast Fillets").eq("unit_type", "kg"),
  );
  const lamb = await one("products", "id,name,branch_id", (q) =>
    q.eq("branch_id", branch.id).eq("name", "Lamb Leg Steaks").eq("unit_type", "kg"),
  );
  if (!chicken || !lamb) throw new Error("Expected Chicken Breast Fillets and Lamb Leg Steaks.");

  const { data: mutton, error: muttonError } = await admin
    .from("products")
    .upsert(
      {
        branch_id: branch.id,
        name: "Mutton V17 Serve Gate",
        slug: "mutton-v17-serve-gate",
        unit_type: "kg",
        price_per_unit: 12,
        min_order_quantity: 0.1,
        max_order_quantity: 20,
        is_available: true,
        stock_status: "in_stock",
        requires_weight_confirmation: false,
        sort_order: -1000,
      },
      { onConflict: "branch_id,slug" },
    )
    .select("id,name,branch_id")
    .single();
  if (muttonError) throw muttonError;

  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const batches = [chicken, lamb].map((product) => ({
    branch_id: branch.id,
    product_id: product.id,
    supplier_id: supplier.id,
    received_date: today,
    expiry_date: future,
    received_weight_kg: 10,
    remaining_weight_kg: 10,
    invoice_cost: 0,
    cost_per_kg: 1,
    batch_number: `V17SERVE-${product.id.slice(0, 8)}-${Date.now()}`,
    status: "active",
  }));
  const batchInsert = await admin.from("inventory_batches").insert(batches);
  if (batchInsert.error) throw batchInsert.error;

  return { branch, chicken, lamb, mutton };
}

async function login(page) {
  await page.goto(`${BASE_URL}/login?returnTo=%2Foperator%2Fserve`);
  await page.getByLabel("Work email").fill("operator@ptm.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await Promise.all([page.waitForURL("**/operator/serve"), page.getByRole("button", { name: "Sign in" }).click()]);
}

async function tapSale(page, items, pay) {
  const marker = new Date().toISOString();
  await page.goto(`${BASE_URL}/operator/serve`);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    await page.getByRole("button", { name: item.tile }).click();
    if (item.tile === "Other") {
      await page.getByRole("textbox").fill(item.name);
      await page.getByRole("button", { name: "Next" }).click();
    }
    await page.getByRole("button", { name: item.amount }).click();
    await page.getByRole("button", { name: i + 1 < items.length ? "Yes" : "No" }).click();
  }
  await page.getByRole("button", { name: pay }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: "Done" }).waitFor();
  const order = await one("orders", "id,order_ref,status,payment_method,subtotal,idempotency_key", (q) =>
    q.eq("customer_name", "Shop sale").gt("created_at", marker).order("created_at", { ascending: false }).limit(1),
  );
  if (!order) throw new Error("No order was created.");
  return order;
}

async function lineCount(orderId) {
  const rows = await many("order_items", "id", (q) => q.eq("order_id", orderId));
  return rows.length;
}

async function run() {
  await setupData();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(25_000);
    await login(page);

    const known = await tapSale(page, [{ tile: "Chicken", amount: "500g" }], "Cash");
    check("known product order collected", known.status === "collected", known.status);
    check("known product payment saved", known.payment_method === "cash", known.payment_method);
    check("known product one line", (await lineCount(known.id)) === 1);
    check(
      "known product stock row exists",
      !!(await one("order_inventory_depletions", "id,status", (q) => q.eq("order_id", known.id).eq("source_event", "SALE_COLLECT"))),
    );
    check(
      "known product audit exists",
      !!(await one("audit_logs", "id", (q) =>
        q.eq("event_type", "ops_session_completed").eq("target_type", "operator_workflow_run").filter("metadata->>orderId", "eq", known.id).limit(1),
      )),
    );
    check(
      "known product retry key unique",
      (await many("orders", "id", (q) => q.eq("idempotency_key", known.idempotency_key))).length === 1,
    );

    const multi = await tapSale(
      page,
      [
        { tile: "Chicken", amount: "500g" },
        { tile: "Lamb", amount: "1kg" },
      ],
      "Card",
    );
    check("multi order collected", multi.status === "collected", multi.status);
    check("multi order two lines", (await lineCount(multi.id)) === 2);
    check(
      "multi order stock rows",
      (await many("inventory_movements", "id", (q) => q.eq("order_id", multi.id).eq("source_event", "SALE_COLLECT"))).length >= 2,
    );

    const unknown = await tapSale(page, [{ tile: "Other", name: "Mystery Cut", amount: "500g" }], "Cash");
    check("unknown order collected", unknown.status === "collected", unknown.status);
    check(
      "unknown line kept",
      !!(await one("order_items", "id", (q) => q.eq("order_id", unknown.id).is("product_id", null).eq("product_name_snapshot", "Mystery Cut"))),
    );
    check(
      "unknown owner alert",
      !!(await one("owner_alerts", "id", (q) => q.eq("entity_ref", `${unknown.id}:check`).is("resolved_at", null))),
    );

    const low = await tapSale(page, [{ tile: "Mutton", amount: "2kg" }], "Card");
    check("low stock order collected", low.status === "collected", low.status);
    check(
      "low stock short row",
      !!(await one("order_inventory_depletions", "id", (q) =>
        q.eq("order_id", low.id).eq("source_event", "SALE_COLLECT").eq("status", "completed_with_shortfall"),
      )),
    );
    check(
      "low stock owner alert",
      !!(await one("owner_alerts", "id", (q) => q.eq("entity_ref", `${low.id}:count`).is("resolved_at", null))),
    );

    await page.goto(`${BASE_URL}/counter`);
    check("operator stays out of counter", page.url().includes("/operator"), page.url());
  } finally {
    await browser.close();
  }

  console.log("");
  console.log(`Operator serve gate PASSED (${checks.length} checks)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
