// Adversarial verification — V13.1 Butcher Pricing Validation.
//
// Runs against the LOCAL Supabase stack. Proves the butcher pricing sign-off is real
// and hardened (manager-gated, no forgeable direct writes, server-computed variance,
// audit-logged):
//   1.  anon cannot call record_pricing_validation.
//   2.  non-manager staff cannot call it (manager gate, not just any staff).
//   3.  a manager CAN record a 'pending' row.
//   4.  'approved'/'changes_required' without butcher figures is rejected.
//   5.  an unknown species is rejected.
//   6.  an unknown decision is rejected.
//   7.  a manager cannot record for a branch they don't manage (cross-branch denied).
//   8.  variance_pct is computed server-side (client cannot supply it).
//   9.  the row is upserted per (branch, species, cut) — re-recording updates, not dupes.
//   10. authenticated users cannot INSERT directly into pricing_validations.
//   11. a 'pricing_validation_recorded' audit row is emitted.
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

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-000000000002";
const PASSWORD = "PlaiceTest123!";

const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else {
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

function record(client, args) {
  return client.rpc("record_pricing_validation", {
    p_branch_id: args.branchId ?? BRANCH_A,
    p_species: args.species ?? "lamb",
    p_cut_id: args.cutId ?? "leg",
    p_cut_name: args.cutName ?? "Leg",
    p_system_yield_pct: args.systemYield ?? 0.31,
    p_system_cost_per_kg: args.systemCost ?? 10,
    p_system_price_per_kg: args.systemPrice ?? 15,
    p_system_margin_pct: args.systemMargin ?? 0.33,
    p_butcher_yield_pct: args.butcherYield ?? null,
    p_butcher_price_per_kg: args.butcherPrice ?? null,
    p_decision: args.decision ?? "pending",
    p_notes: args.notes ?? null,
    p_butcher_name: args.butcherName ?? null,
  });
}

async function reset() {
  for (const branch of [BRANCH_A, BRANCH_B]) {
    await service.from("pricing_validations").delete().eq("branch_id", branch).eq("species", "lamb").eq("cut_id", "leg");
  }
}

async function main() {
  console.log(`pricing-validation-integrity adversarial checks (run ${randomUUID().slice(0, 8)})`);

  const manager = await sessionClient("manager@ptm.test");
  const staff = await sessionClient("staff@ptm.test");

  await reset();

  // 1. anon denied
  {
    const r = await record(anon, {});
    check("anon record_pricing_validation DENIED", !!r.error, r.error ? "" : "CALLABLE!");
  }

  // 2. non-manager staff denied (manager gate)
  {
    const r = await record(staff, {});
    check("non-manager staff DENIED", !!r.error && /Not authorised/i.test(r.error.message), r.error?.message ?? "ALLOWED");
  }

  // 3. manager can record a pending row
  {
    const r = await record(manager, { decision: "pending" });
    check("manager can record a pending validation", !r.error && !!r.data, r.error?.message);
  }

  // 4. approving without butcher figures rejected
  {
    const r = await record(manager, { decision: "approved" });
    check("approve without butcher figures rejected", !!r.error && /butcher yield and price/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  // 5. unknown species rejected
  {
    const r = await record(manager, { species: "pork" });
    check("unknown species rejected", !!r.error && /Unknown species/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  // 6. unknown decision rejected
  {
    const r = await record(manager, { decision: "maybe" });
    check("unknown decision rejected", !!r.error && /Unknown decision/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  // 7. cross-branch (manager of A targeting B) denied
  {
    const r = await record(manager, { branchId: BRANCH_B });
    check("cross-branch record DENIED", !!r.error && /Not authorised/i.test(r.error.message), r.error?.message ?? "ALLOWED");
  }

  // 8. variance computed server-side
  {
    const r = await record(manager, { decision: "approved", systemPrice: 15, butcherPrice: 18, butcherYield: 0.31 });
    check("approve with figures succeeds", !r.error && !!r.data, r.error?.message);
    const { data } = await service
      .from("pricing_validations")
      .select("variance_pct, decision")
      .eq("branch_id", BRANCH_A).eq("species", "lamb").eq("cut_id", "leg").single();
    check("variance_pct computed server-side (+20%)", Number(data?.variance_pct) === 20, `variance=${data?.variance_pct}`);
  }

  // 9. upsert per (branch, species, cut) — re-record updates the same row
  {
    await record(manager, { decision: "changes_required", systemPrice: 15, butcherPrice: 12, butcherYield: 0.29, notes: "too high" });
    const { count } = await service
      .from("pricing_validations")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", BRANCH_A).eq("species", "lamb").eq("cut_id", "leg");
    check("re-recording upserts (no duplicate rows)", count === 1, `count=${count}`);
    const { data } = await service
      .from("pricing_validations")
      .select("decision, variance_pct")
      .eq("branch_id", BRANCH_A).eq("species", "lamb").eq("cut_id", "leg").single();
    check("upsert updated decision + variance", data?.decision === "changes_required" && Number(data?.variance_pct) === -20, `decision=${data?.decision} variance=${data?.variance_pct}`);
  }

  // 10. direct INSERT by authenticated user denied (write hole closed)
  {
    const r = await manager.from("pricing_validations").insert({
      branch_id: BRANCH_A,
      species: "beef",
      cut_id: "sirloin",
      cut_name: "Sirloin",
      system_yield_pct: 0.07,
      system_cost_per_kg: 20,
      system_price_per_kg: 40,
      system_margin_pct: 0.5,
      decision: "approved",
    });
    check("direct authenticated INSERT DENIED", !!r.error, r.error ? "" : "INSERTED!");
  }

  // 11. audit evidence emitted
  {
    const { count } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "pricing_validation_recorded")
      .eq("branch_id", BRANCH_A);
    check("pricing_validation_recorded audit row(s) exist", (count ?? 0) > 0, `count=${count}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} pricing-validation-integrity check(s) FAILED`);
    process.exit(1);
  }
  console.log("RESULT: all pricing-validation-integrity checks PASSED");
}

main().catch((err) => {
  console.error("verify-pricing-validation-integrity crashed:", err);
  process.exit(1);
});
