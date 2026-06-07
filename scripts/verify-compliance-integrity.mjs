// Adversarial verification — Compliance Temperature Capture.
//
// Runs against the LOCAL Supabase stack. Proves the food-safety temperature log is
// real and hardened (no fabricated evidence, no forgeable direct writes):
//   1.  anon cannot call record_compliance_reading / complete_compliance_log.
//   2.  branch staff CAN record a reading via the RPC.
//   3.  an unknown reading type is rejected.
//   4.  an out-of-range temperature is rejected.
//   5.  a branch-B staff member cannot record for branch A (cross-branch denied).
//   6.  completion is refused without both an opening and a closing reading.
//   7.  completion is refused unless all daily checks are done.
//   8.  completion succeeds with opening+closing + all checks, and is idempotent.
//   9.  authenticated staff cannot INSERT directly into the compliance tables
//       (the forgeable direct-write hole is closed).
//   10. a 'compliance_reading_recorded' audit row is emitted.
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

function today() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

async function resetToday() {
  // Service role retains write capability (only client roles were revoked).
  await service.from("compliance_logs").delete().eq("branch_id", BRANCH_A).eq("log_date", today());
}

function record(client, args) {
  return client.rpc("record_compliance_reading", {
    p_branch_id: args.branchId ?? BRANCH_A,
    p_reading_type: args.readingType,
    p_chiller_temp_c: args.chiller,
    p_freezer_temp_c: args.freezer,
    p_display_temp_c: args.display ?? null,
  });
}

function complete(client, args = {}) {
  return client.rpc("complete_compliance_log", {
    p_branch_id: args.branchId ?? BRANCH_A,
    p_cleaning_completed: args.cleaning ?? true,
    p_sanitisation_completed: args.sanitisation ?? true,
    p_waste_checked: args.waste ?? true,
    p_notes: null,
  });
}

async function main() {
  console.log(`compliance-integrity adversarial checks (run ${randomUUID().slice(0, 8)})`);

  const staffA = await sessionClient("staff@ptm.test");
  const staffB = await sessionClient("staff.b@ptm.test");

  await resetToday();

  // 1. anon denied
  {
    const r = await record(anon, { readingType: "opening", chiller: 3, freezer: -18 });
    check("anon record_compliance_reading DENIED", !!r.error, r.error ? "" : "CALLABLE!");
    const c = await complete(anon);
    check("anon complete_compliance_log DENIED", !!c.error, c.error ? "" : "CALLABLE!");
  }

  // 2. staff can record
  {
    const r = await record(staffA, { readingType: "opening", chiller: 3.2, freezer: -18.5, display: 4.0 });
    check("branch staff can record an opening reading", !r.error && !!r.data, r.error?.message);
  }

  // 3. unknown reading type rejected
  {
    const r = await record(staffA, { readingType: "midnight", chiller: 3, freezer: -18 });
    check("unknown reading type rejected", !!r.error && /Unknown reading type/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  // 4. out-of-range temperature rejected
  {
    const r = await record(staffA, { readingType: "midday", chiller: 999, freezer: -18 });
    check("out-of-range temperature rejected", !!r.error && /out of range/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  // 5. cross-branch denied
  {
    const r = await record(staffB, { branchId: BRANCH_A, readingType: "midday", chiller: 3, freezer: -18 });
    check("cross-branch staff record DENIED", !!r.error && /Not authorised/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  // 6. completion refused without a closing reading (only opening exists so far)
  {
    const c = await complete(staffA);
    check("completion refused without opening+closing", !!c.error && /opening and a closing/i.test(c.error.message), c.error?.message ?? "COMPLETED");
  }

  // 7. completion refused unless all checks done (add closing first)
  {
    const r = await record(staffA, { readingType: "closing", chiller: 3.6, freezer: -18.2 });
    check("branch staff can record a closing reading", !r.error && !!r.data, r.error?.message);
    const c = await complete(staffA, { waste: false });
    check("completion refused unless all checks done", !!c.error && /must all be completed/i.test(c.error.message), c.error?.message ?? "COMPLETED");
  }

  // 8. completion succeeds + idempotent
  {
    const c = await complete(staffA);
    check("completion succeeds with opening+closing + all checks", !c.error && !!c.data, c.error?.message);
    const again = await complete(staffA);
    check("completion is idempotent", !again.error && String(again.data) === String(c.data), again.error?.message);
    const { data } = await service.from("compliance_logs").select("status").eq("branch_id", BRANCH_A).eq("log_date", today()).single();
    check("log is marked completed", data?.status === "completed", `status=${data?.status}`);
  }

  // 9. direct table insert by authenticated staff is denied (write hole closed)
  {
    const { data: logRow } = await service.from("compliance_logs").select("id").eq("branch_id", BRANCH_A).eq("log_date", today()).single();
    const r = await staffA.from("compliance_readings").insert({
      branch_id: BRANCH_A,
      compliance_log_id: logRow.id,
      reading_type: "ad_hoc",
      chiller_temp_c: 3,
      freezer_temp_c: -18,
      recorded_by: "00000000-0000-4000-8000-000000000001",
    });
    check("direct staff INSERT into compliance_readings DENIED", !!r.error, r.error ? "" : "INSERTED!");
  }

  // 10. audit evidence emitted
  {
    const { count } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "compliance_reading_recorded")
      .eq("branch_id", BRANCH_A);
    check("compliance_reading_recorded audit row(s) exist", (count ?? 0) > 0, `count=${count}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} compliance-integrity check(s) FAILED`);
    process.exit(1);
  }
  console.log("RESULT: all compliance-integrity checks PASSED");
}

main().catch((err) => {
  console.error("verify-compliance-integrity crashed:", err);
  process.exit(1);
});
