// Dev/test seed: auth users, a second branch, profiles, and today's orders.
// Idempotent — safe to run repeatedly against the LOCAL Supabase stack only.
//
// Usage: node scripts/seed-dev.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";
const WINDOW_LUNCH = "00000000-0000-4000-8000-000000000302";
const SEED_BATCH_A = "00000000-0000-4000-8000-000000000601";
export const TEST_PASSWORD = "PlaiceTest123!";

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERS = [
  { email: "owner@ptm.test", role: "owner", branch_id: BRANCH_A, full_name: "Olivia Owner" },
  { email: "manager@ptm.test", role: "manager", branch_id: BRANCH_A, full_name: "Mara Manager" },
  { email: "staff@ptm.test", role: "staff", branch_id: BRANCH_A, full_name: "Sam Staff" },
  { email: "staff.b@ptm.test", role: "staff", branch_id: BRANCH_B, full_name: "Bea BranchB" },
  { email: "inactive@ptm.test", role: "staff", branch_id: BRANCH_A, full_name: "Ina Inactive", is_active: false },
];

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function upsertUser(spec) {
  let user = await findUserByEmail(spec.email);

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: spec.email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  } else {
    await supabase.auth.admin.updateUserById(user.id, { password: TEST_PASSWORD, email_confirm: true });
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: spec.email,
      full_name: spec.full_name,
      role: spec.role,
      branch_id: spec.branch_id,
      is_active: spec.is_active ?? true,
    },
    { onConflict: "id" },
  );
  if (profileError) throw profileError;

  console.log(`  user ${spec.email} (${spec.role}) -> ${user.id}`);
  return user.id;
}

async function ensureBranchB() {
  const { error } = await supabase.from("branches").upsert(
    {
      id: BRANCH_B,
      name: "PlaiceToMeat Kings Heath",
      slug: "kings-heath",
      address: "12 High Street, Kings Heath",
      phone: "+441213550012",
      timezone: "Europe/London",
      is_active: true,
    },
    { onConflict: "id" },
  );
  if (error) throw error;
  console.log("  branch B (kings-heath) ready");
}

async function seedOrders() {
  const pickupDate = todayIso();
  // Remove previously seeded orders (idempotency keys are stable below).
  const keys = ["seed-incoming-1", "seed-prepping-1", "seed-ready-1", "seed-winback-1", "seed-winback-2", "seed-winback-3"];
  const { data: existing } = await supabase.from("orders").select("id, idempotency_key").in("idempotency_key", keys);
  for (const row of existing ?? []) {
    await supabase.from("orders").delete().eq("id", row.id);
  }

  const orders = [
    { ref: "PTM-2026-90001", key: "seed-incoming-1", name: "Aisha Khan", phone: "+447700900111", status: "incoming", subtotal: 24.98 },
    { ref: "PTM-2026-90002", key: "seed-prepping-1", name: "Imran Patel", phone: "+447700900222", status: "prepping", subtotal: 35.0 },
    { ref: "PTM-2026-90003", key: "seed-ready-1", name: "Sarah Mahmood", phone: "+447700900333", status: "ready", subtotal: 18.49 },
  ];

  for (const o of orders) {
    const { data: inserted, error } = await supabase
      .from("orders")
      .insert({
        branch_id: BRANCH_A,
        order_ref: o.ref,
        customer_name: o.name,
        customer_phone: o.phone,
        status: o.status,
        pickup_window_id: WINDOW_LUNCH,
        pickup_date: pickupDate,
        subtotal: o.subtotal,
        idempotency_key: o.key,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { error: itemError } = await supabase.from("order_items").insert({
      branch_id: BRANCH_A,
      order_id: inserted.id,
      product_name_snapshot: "Chicken Breast Fillets",
      quantity: 1,
      unit_type: "kg",
      unit_price_snapshot: 8.99,
      line_total: 8.99,
    });
    if (itemError) throw itemError;

    await supabase.from("order_status_events").insert({
      branch_id: BRANCH_A,
      order_id: inserted.id,
      status: o.status,
      note: "Seeded for development.",
    });

    console.log(`  order ${o.ref} (${o.status}) -> ${inserted.id}`);
  }

  await seedLapsedRegular();
}

/**
 * A lapsed regular: Yusuf ordered three times at a weekly cadence and then went quiet ~31
 * days ago. This makes the V16 customer win-back action ("Win back Yusuf Ali") demonstrable
 * on TODAY. created_at is backdated relative to now so it stays valid whenever the seed runs.
 */
async function seedLapsedRegular() {
  const dayMs = 86_400_000;
  const isoDaysAgo = (n) => new Date(Date.now() - n * dayMs).toISOString();
  const history = [
    { ref: "PTM-2026-90801", key: "seed-winback-1", daysAgo: 45, subtotal: 32.0 },
    { ref: "PTM-2026-90802", key: "seed-winback-2", daysAgo: 38, subtotal: 28.0 },
    { ref: "PTM-2026-90803", key: "seed-winback-3", daysAgo: 31, subtotal: 30.0 },
  ];

  for (const h of history) {
    const createdAt = isoDaysAgo(h.daysAgo);
    const { data: inserted, error } = await supabase
      .from("orders")
      .insert({
        branch_id: BRANCH_A,
        order_ref: h.ref,
        customer_name: "Yusuf Ali",
        customer_phone: "+447700900444",
        status: "collected",
        pickup_window_id: WINDOW_LUNCH,
        pickup_date: createdAt.slice(0, 10),
        subtotal: h.subtotal,
        idempotency_key: h.key,
        created_at: createdAt,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { error: itemError } = await supabase.from("order_items").insert({
      branch_id: BRANCH_A,
      order_id: inserted.id,
      product_name_snapshot: "Lamb Shoulder",
      quantity: 1,
      unit_type: "kg",
      unit_price_snapshot: h.subtotal,
      line_total: h.subtotal,
      created_at: createdAt,
    });
    if (itemError) throw itemError;
  }
  console.log("  lapsed regular Yusuf Ali (3 orders, last ~31 days ago) -> win-back fixture");
}

async function clearOpsSessions() {
  // Reset the V10 opening/closing/stock-count rituals so each run starts with a clean day.
  // Cascades to ops_checklist_events and stock_count_lines.
  const { error } = await supabase.from("ops_checklist_sessions").delete().in("branch_id", [BRANCH_A, BRANCH_B]);
  if (error) throw error;
  console.log("  ops checklist sessions cleared");
}

async function restoreSeedBatch() {
  // Stock-count tests apply corrections to the seeded batch. The movements ledger is
  // append-only, so a dev reset restores the cache by appending a new correction row
  // instead of deleting historical adjustments.
  const { data: batch, error: readError } = await supabase
    .from("inventory_batches")
    .select("branch_id, remaining_weight_kg")
    .eq("id", SEED_BATCH_A)
    .single();
  if (readError) throw readError;

  const beforeKg = Number(batch.remaining_weight_kg);
  const targetKg = 18.5;

  const { error } = await supabase
    .from("inventory_batches")
    .update({ remaining_weight_kg: targetKg, status: "active", manual_adjustment_reason: "Dev seed reset" })
    .eq("id", SEED_BATCH_A);
  if (error) throw error;

  const deltaKg = Number((targetKg - beforeKg).toFixed(3));
  if (deltaKg !== 0) {
    const { error: movementError } = await supabase.from("inventory_movements").insert({
      batch_id: SEED_BATCH_A,
      branch_id: batch.branch_id,
      movement_type: "ADJUSTMENT",
      quantity_kg: Math.abs(deltaKg),
      delta_kg: deltaKg,
      balance_before_kg: beforeKg,
      balance_after_kg: targetKg,
      source_event: "DEV_SEED_RESET",
      reason: "Dev seed reset",
      idempotency_key: `dev-seed-reset:${SEED_BATCH_A}:${Date.now()}`,
    });
    if (movementError) throw movementError;
  }
  console.log("  seed inventory batch restored");
}

async function main() {
  console.log("Seeding auth users...");
  await ensureBranchB();
  for (const spec of USERS) {
    await upsertUser(spec);
  }
  console.log("Seeding today's orders...");
  await seedOrders();
  await clearOpsSessions();
  await restoreSeedBatch();
  console.log("Done. Test password for all users:", TEST_PASSWORD);
}

main().catch((error) => {
  console.error("Seed failed:", error.message ?? error);
  process.exit(1);
});
