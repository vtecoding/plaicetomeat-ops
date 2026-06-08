// Server-side rule verification for the V10 guided-capture RPCs. Runs against the
// LOCAL Supabase stack and exercises the opening/closing/stock-count session RPCs the
// way the app does (authenticated user sessions, RLS enforced). Proves the Phase 2
// non-negotiables: idempotent, audit-logged, role-gated, recoverable, and that stock
// only ever changes through the existing correction-evidence path. Exits non-zero on
// any unmet expectation.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const PASSWORD = "PlaiceTest123!";

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
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

function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Create a throwaway inventory batch in branch A for the stock-count checks. */
async function ensureTestBatch(manager) {
  const { data: product } = await service.from("products").select("id").eq("branch_id", BRANCH_A).limit(1).maybeSingle();
  if (!product) return null;

  let { data: supplier } = await service
    .from("suppliers")
    .select("id")
    .eq("branch_id", BRANCH_A)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!supplier) {
    const created = await manager.rpc("admin_upsert_supplier_cert", {
      p_supplier_id: null,
      p_branch_id: BRANCH_A,
      p_name: "Verify Capture Supplier",
      p_certifying_body: "HMC",
      p_cert_number: "VC-1",
      p_cert_expiry: "2030-01-01",
      p_active: true,
      p_document_url: null,
      p_verified: true,
      p_notes: null,
    });
    if (created.error) throw new Error(`supplier create failed: ${created.error.message}`);
    supplier = { id: String(created.data) };
  }

  // Fresh batch every run: clear the prior throwaway, then create 10kg received / 10kg remaining.
  await service.from("inventory_batches").delete().eq("intake_idempotency_key", "verify-capture-batch");
  const { data: batchId, error } = await manager.rpc("admin_create_inventory_batch", {
    p_branch_id: BRANCH_A,
    p_product_id: product.id,
    p_supplier_id: supplier.id,
    p_received_date: todayIso(),
    p_expiry_date: "2030-01-01",
    p_received_weight_kg: 10,
    p_remaining_weight_kg: 10,
    p_invoice_cost: 50,
    p_halal_cert_ref: null,
    p_country_of_origin: null,
    p_slaughter_date: null,
    p_storage_location: null,
    p_batch_number: null,
    p_intake_idempotency_key: "verify-capture-batch",
    p_expected_weight_kg: null,
    p_actual_review_note: null,
  });
  if (error) throw new Error(`batch create failed: ${error.message}`);
  return String(batchId);
}

async function main() {
  const manager = await sessionClient("manager@ptm.test");
  const staff = await sessionClient("staff@ptm.test");
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });

  // Clean slate for today's rituals so resume/idempotency assertions are deterministic.
  await service.from("ops_checklist_sessions").delete().eq("branch_id", BRANCH_A).eq("business_date", todayIso());

  // 1. Unauthenticated start rejected.
  {
    const { error } = await anon.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH_A, p_kind: "opening" });
    check("unauthenticated start rejected", !!error, error?.message);
  }

  // 2. Staff start rejected (manager/owner-gated).
  {
    const { error } = await staff.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH_A, p_kind: "opening" });
    check("staff start rejected (manager-gated)", !!error && /Not authorised/.test(error.message), error?.message);
  }

  // 3. Manager start, and a second call RESUMES the same session (idempotent + recoverable).
  let openingId;
  {
    const first = await manager.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH_A, p_kind: "opening", p_source: "verify" });
    check("manager start succeeds", !first.error && !!first.data, first.error?.message);
    openingId = first.data;
    const second = await manager.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH_A, p_kind: "opening" });
    check("second start resumes same session", second.data === openingId, `first=${openingId} second=${second.data}`);
  }

  // 4. Step recording: idempotent on key, append-only, audit-logged, real skipped/na states.
  {
    const r1 = await manager.rpc("ops_record_step", {
      p_session_id: openingId,
      p_step_key: "fridge_temp",
      p_state: "done",
      p_payload: { value: 3.5 },
      p_idempotency_key: "k-fridge",
    });
    check("step recorded", !r1.error && !!r1.data, r1.error?.message);

    const r2 = await manager.rpc("ops_record_step", {
      p_session_id: openingId,
      p_step_key: "fridge_temp",
      p_state: "done",
      p_payload: { value: 3.5 },
      p_idempotency_key: "k-fridge",
    });
    check("step idempotent on key (same event id)", r2.data === r1.data, `r1=${r1.data} r2=${r2.data}`);

    const skip = await manager.rpc("ops_record_step", { p_session_id: openingId, p_step_key: "display_ready", p_state: "skipped" });
    check("skipped is a real recorded state", !skip.error && !!skip.data, skip.error?.message);

    const bad = await manager.rpc("ops_record_step", { p_session_id: openingId, p_step_key: "x", p_state: "maybe" });
    check("invalid step state rejected", !!bad.error, bad.error?.message);

    const { count: evtCount } = await service
      .from("ops_checklist_events")
      .select("id", { count: "exact", head: true })
      .eq("session_id", openingId);
    check("only intended events appended (idempotent retry not duplicated)", evtCount === 2, `count=${evtCount}`);

    const { count: auditCount } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("target_id", openingId)
      .eq("event_type", "ops_step_recorded");
    check("step writes audit row", (auditCount ?? 0) >= 1, `count=${auditCount}`);
  }

  // 5. Complete is idempotent, and steps can't be recorded afterwards.
  {
    for (const [stepKey, payload] of [
      ["certs_visible", {}],
      ["float_ready", { value: 120 }],
      ["open_sign", {}],
    ]) {
      const r = await manager.rpc("ops_record_step", {
        p_session_id: openingId,
        p_step_key: stepKey,
        p_state: "done",
        p_payload: payload,
        p_idempotency_key: `k-${stepKey}`,
      });
      check(`required step recorded before completion: ${stepKey}`, !r.error && !!r.data, r.error?.message);
    }

    const c1 = await manager.rpc("ops_complete_session", { p_session_id: openingId });
    check("complete succeeds", !c1.error && c1.data === openingId, c1.error?.message);
    const c2 = await manager.rpc("ops_complete_session", { p_session_id: openingId });
    check("complete idempotent", !c2.error && c2.data === openingId, c2.error?.message);
    const after = await manager.rpc("ops_record_step", { p_session_id: openingId, p_step_key: "late", p_state: "done" });
    check("no step after completion", !!after.error && /finished/i.test(after.error.message), after.error?.message);

    // A new start after completion opens a FRESH session (not the completed one).
    const fresh = await manager.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH_A, p_kind: "opening" });
    check("new start after completion is a new session", fresh.data !== openingId, `completed=${openingId} fresh=${fresh.data}`);
    await service.from("ops_checklist_sessions").delete().eq("id", fresh.data);
  }

  // 6. Stock count: evidence-only recording, then correction ONLY via the existing path.
  const batchId = await ensureTestBatch(manager);
  if (!batchId) {
    console.log("  SKIP stock-count checks (no product in branch A to attach a batch to)");
  } else {
    const sc = await manager.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH_A, p_kind: "stock_count" });
    const countSession = sc.data;
    check("stock-count session started", !sc.error && !!countSession, sc.error?.message);

    // Record a count of 8kg against a batch the system thinks is 10kg.
    const line = await manager.rpc("ops_record_stock_count_line", {
      p_session_id: countSession,
      p_batch_id: batchId,
      p_counted_weight_kg: 8,
    });
    check("stock count line recorded", !line.error && !!line.data, line.error?.message);

    let { data: batchAfterCount } = await service.from("inventory_batches").select("remaining_weight_kg").eq("id", batchId).single();
    check("counting does NOT change stock", Number(batchAfterCount.remaining_weight_kg) === 10, `remaining=${batchAfterCount?.remaining_weight_kg}`);

    const { count: movementsBefore } = await service
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("movement_type", "ADJUSTMENT");

    // Apply the line — this is the only place stock changes, via admin_adjust_inventory_remaining.
    const apply = await manager.rpc("ops_apply_stock_count_line", { p_session_id: countSession, p_line_id: line.data });
    check("apply succeeds", !apply.error && apply.data === line.data, apply.error?.message);

    ({ data: batchAfterCount } = await service.from("inventory_batches").select("remaining_weight_kg").eq("id", batchId).single());
    check("apply corrects stock to counted weight", Number(batchAfterCount.remaining_weight_kg) === 8, `remaining=${batchAfterCount?.remaining_weight_kg}`);

    const { count: movementsAfter } = await service
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("movement_type", "ADJUSTMENT");
    check("apply creates exactly one correction movement", (movementsAfter ?? 0) === (movementsBefore ?? 0) + 1, `before=${movementsBefore} after=${movementsAfter}`);

    const { data: appliedLine } = await service.from("stock_count_lines").select("applied_at, correction_movement_id").eq("id", line.data).single();
    check("line links to correction evidence", !!appliedLine.applied_at && !!appliedLine.correction_movement_id, JSON.stringify(appliedLine));

    // Apply again — idempotent, no second movement.
    const apply2 = await manager.rpc("ops_apply_stock_count_line", { p_session_id: countSession, p_line_id: line.data });
    const { count: movementsFinal } = await service
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("movement_type", "ADJUSTMENT");
    check("re-apply is idempotent (no extra movement)", !apply2.error && (movementsFinal ?? 0) === (movementsAfter ?? 0), `final=${movementsFinal}`);

    // Recording against an already-applied line is rejected (applied lines are immutable).
    const reEdit = await manager.rpc("ops_record_stock_count_line", { p_session_id: countSession, p_batch_id: batchId, p_counted_weight_kg: 5 });
    check("applied line is immutable", !!reEdit.error && /already applied/i.test(reEdit.error.message), reEdit.error?.message);

    // Cleanup throwaway count session + batch (cascades lines; movements/audit are history).
    await service.from("ops_checklist_sessions").delete().eq("id", countSession);
    await service.from("inventory_movements").delete().eq("batch_id", batchId);
    await service.from("inventory_batches").delete().eq("id", batchId);
  }

  // 7. Waste still feeds the existing intelligence path (closing ritual reuses this RPC).
  {
    const wasteBatch = await ensureTestBatch(manager);
    if (wasteBatch) {
      const w = await manager.rpc("admin_record_inventory_waste", { p_batch_id: wasteBatch, p_quantity_kg: 2, p_reason: "expired" });
      check("waste recorded via existing path", !w.error && !!w.data, w.error?.message);
      const { count: wasteMovements } = await service
        .from("inventory_movements")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", wasteBatch)
        .eq("movement_type", "WASTE");
      check("waste lands in inventory_movements (feeds intelligence)", (wasteMovements ?? 0) >= 1, `count=${wasteMovements}`);
      await service.from("inventory_movements").delete().eq("batch_id", wasteBatch);
      await service.from("inventory_batches").delete().eq("id", wasteBatch);
    }
  }

  // Final cleanup of any sessions we opened today.
  await service.from("ops_checklist_sessions").delete().eq("branch_id", BRANCH_A).eq("business_date", todayIso());

  console.log(failures === 0 ? "\nALL CAPTURE CHECKS PASSED" : `\n${failures} CAPTURE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-ops-capture crashed:", error.message ?? error);
  process.exit(1);
});
