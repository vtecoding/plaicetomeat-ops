// V18 B2/B7 database guard — alert lifecycle, atomic critical enqueue,
// claim/resolve compare-and-swap, branch isolation and certificate expiry.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";
const PASSWORD = "PlaiceTest123!";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) throw new Error("Local Supabase credentials are required in .env.local.");

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const manager = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const sessionIds = [];
let baselineAlertIds = new Set();
const supplierIds = [];
const productIds = [];
const batchIds = [];
const evidenceIds = [];
const workflowRunIds = [];
const complianceDocumentIds = [];
let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? `  ::  ${detail}` : ""}`);
  } else {
    fail += 1;
    console.error(`  FAIL  ${name}${detail ? `  ::  ${detail}` : ""}`);
  }
}

function psql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8" },
  );
  return {
    ok: (result.status ?? 1) === 0,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim(),
  };
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function startOpening(businessDate) {
  const id = await rpc(manager, "ops_start_or_resume_session", {
    p_branch_id: BRANCH_A,
    p_kind: "opening",
    p_business_date: businessDate,
    p_source: "verify-owner-jobs",
  });
  sessionIds.push(String(id));
  return String(id);
}

async function recordStep(sessionId, stepKey, state, payload = {}) {
  return rpc(manager, "ops_record_step", {
    p_session_id: sessionId,
    p_step_key: stepKey,
    p_state: state,
    p_payload: payload,
    p_source: "verify-owner-jobs",
    p_idempotency_key: `owner-jobs:${sessionId}:${stepKey}:${state}:${crypto.randomUUID()}`,
  });
}

function datePlus(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function verifyChecklistLifecycle() {
  const sessionId = await startOpening("2088-06-14");
  await recordStep(sessionId, "fridge_temp", "skipped");
  const criticalRef = `checklist:${sessionId}:fridge_temp`;
  const { data: critical } = await admin
    .from("owner_alerts")
    .select("id,severity,resolved_at")
    .eq("branch_id", BRANCH_A)
    .eq("kind", "checklist_skip")
    .eq("entity_ref", criticalRef)
    .single();
  const { data: criticalDispatch } = await admin
    .from("alert_dispatches")
    .select("status,provider_idempotency_key")
    .eq("alert_id", critical.id)
    .single();
  check(
    "critical checklist skip atomically creates a pending dispatch",
    critical.severity === "critical" && criticalDispatch?.status === "pending",
    JSON.stringify({ critical, criticalDispatch }),
  );
  const { data: creationLifecycle } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("event_type", "owner_alert_lifecycle_changed")
    .eq("target_id", critical.id);
  check(
    "checklist skip atomically records exactly one creation audit",
    creationLifecycle?.length === 1
      && creationLifecycle[0]?.metadata?.transition === "created"
      && creationLifecycle[0]?.metadata?.rule === "checklist_skip",
    JSON.stringify(creationLifecycle),
  );

  await recordStep(sessionId, "fridge_temp", "done", { value: 3.5 });
  const { data: criticalResolved } = await admin
    .from("owner_alerts")
    .select("resolved_at,resolution_note")
    .eq("id", critical.id)
    .single();
  check(
    "completing a previously skipped critical step auto-resolves its job",
    Boolean(criticalResolved.resolved_at) && /automatically/i.test(criticalResolved.resolution_note ?? ""),
    JSON.stringify(criticalResolved),
  );
  const { data: criticalLifecycle } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("event_type", "owner_alert_lifecycle_changed")
    .eq("target_id", critical.id);
  check(
    "checklist auto-resolution appends once after the creation transition",
    criticalLifecycle?.length === 2
      && criticalLifecycle.some((row) => row.metadata?.transition === "created" && row.metadata?.rule === "checklist_skip")
      && criticalLifecycle.some((row) => row.metadata?.transition === "auto_resolved" && row.metadata?.rule === "checklist_step_complete"),
    JSON.stringify(criticalLifecycle),
  );

  await recordStep(sessionId, "display_ready", "skipped");
  const warningRef = `checklist:${sessionId}:display_ready`;
  const { data: warning } = await admin
    .from("owner_alerts")
    .select("id,severity,resolved_at")
    .eq("branch_id", BRANCH_A)
    .eq("kind", "checklist_skip")
    .eq("entity_ref", warningRef)
    .single();
  const { count: warningDispatches } = await admin
    .from("alert_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("alert_id", warning.id);
  check(
    "ordinary checklist skip is a tray warning without an urgent dispatch",
    warning.severity === "warning" && warningDispatches === 0,
    JSON.stringify({ warning, warningDispatches }),
  );
  await recordStep(sessionId, "display_ready", "done");
  const { data: warningResolved } = await admin.from("owner_alerts").select("resolved_at").eq("id", warning.id).single();
  check("completing an ordinary skipped step auto-resolves its job", Boolean(warningResolved.resolved_at));

  await recordStep(sessionId, "display_ready", "skipped");
  const { data: repeatedWarnings } = await admin
    .from("owner_alerts")
    .select("id,resolved_at")
    .eq("branch_id", BRANCH_A)
    .eq("kind", "checklist_skip")
    .eq("entity_ref", warningRef)
    .order("created_at", { ascending: true });
  const repeatedOpen = (repeatedWarnings ?? []).filter((row) => !row.resolved_at);
  const { count: repeatedCreationAudits } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "owner_alert_lifecycle_changed")
    .in("target_id", (repeatedWarnings ?? []).map((row) => row.id))
    .contains("metadata", { transition: "created", rule: "checklist_skip" });
  check(
    "skip then done then skip creates one new open job and one new creation audit",
    repeatedWarnings?.length === 2 && repeatedOpen.length === 1 && repeatedOpen[0]?.id !== warning.id
      && repeatedCreationAudits === 2,
    JSON.stringify({ repeatedWarnings, repeatedCreationAudits }),
  );
}

async function verifyNotOpenedLifecycle() {
  const businessDate = "2088-06-15";
  await rpc(admin, "scan_not_opened_by_time_v18", { p_now: `${businessDate}T10:00:00Z` });
  const entityRef = `opening:${businessDate}`;
  const { data: alert } = await admin
    .from("owner_alerts")
    .select("id,severity,resolved_at")
    .eq("branch_id", BRANCH_A)
    .eq("kind", "not_opened_by_time")
    .eq("entity_ref", entityRef)
    .single();
  const { count: dispatches } = await admin
    .from("alert_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("alert_id", alert.id);
  check("not-opened scan creates one critical externally owed job", alert.severity === "critical" && dispatches === 1);

  const sessionId = await startOpening(businessDate);
  await recordStep(sessionId, "fridge_temp", "done", { value: 3.2 });
  await recordStep(sessionId, "display_ready", "done");
  await recordStep(sessionId, "float_ready", "done", { value: 120 });
  await recordStep(sessionId, "open_sign", "done");
  await rpc(manager, "ops_complete_session", { p_session_id: sessionId, p_source: "verify-owner-jobs" });
  const { data: resolved } = await admin
    .from("owner_alerts")
    .select("resolved_at,resolution_note")
    .eq("id", alert.id)
    .single();
  check(
    "saving the opening checks auto-resolves the not-opened job",
    Boolean(resolved.resolved_at) && /opening was completed/i.test(resolved.resolution_note ?? ""),
    JSON.stringify(resolved),
  );
  const { data: lifecycle } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("event_type", "owner_alert_lifecycle_changed")
    .eq("target_id", alert.id);
  check(
    "opening completion writes one observable auto-resolution transition",
    lifecycle?.length === 1 && lifecycle[0]?.metadata?.rule === "opening_complete",
    JSON.stringify(lifecycle),
  );
}

async function verifyClaimConcurrency(profileIds) {
  const alertId = crypto.randomUUID();
  const { error: insertError } = await admin.from("owner_alerts").insert({
    id: alertId,
    branch_id: BRANCH_A,
    severity: "warning",
    kind: "operator_help",
    summary: "Owner-job claim race probe",
    entity_ref: `claim-race:${alertId}`,
  });
  if (insertError) throw insertError;
  const attempts = await Promise.all(profileIds.map((profileId, index) =>
    admin.rpc("resolve_owner_alert_lifecycle_v18", {
      p_branch_id: BRANCH_A,
      p_actor_id: profileId,
      p_alert_id: alertId,
      p_expected_kind: "operator_help",
      p_resolution_note: `Resolved by contender ${index + 1}.`,
    })));
  const winnerIndex = attempts.findIndex((attempt) => !attempt.error);
  const winnerId = profileIds[winnerIndex];
  const winnerNote = `Resolved by contender ${winnerIndex + 1}.`;
  const { data: claimed } = await admin
    .from("owner_alerts")
    .select("claimed_by,claimed_at,seen_at,resolved_at,resolution_note")
    .eq("id", alertId)
    .single();
  const { count: resolutionAuditCount } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "inventory_reconciliation_issue")
    .eq("target_id", alertId)
    .contains("metadata", { resolved: true });
  check(
    "concurrent tray submissions commit one claimant, resolution and audit",
    attempts.filter((attempt) => !attempt.error).length === 1
      && claimed.claimed_by === winnerId
      && claimed.resolution_note === winnerNote
      && Boolean(claimed.claimed_at)
      && Boolean(claimed.seen_at)
      && Boolean(claimed.resolved_at)
      && resolutionAuditCount === 1,
    JSON.stringify({ attempts: attempts.map((attempt) => attempt.error?.message ?? attempt.data), claimed, resolutionAuditCount }),
  );

  const replay = await admin.rpc("resolve_owner_alert_lifecycle_v18", {
    p_branch_id: BRANCH_A,
    p_actor_id: winnerId,
    p_alert_id: alertId,
    p_expected_kind: "operator_help",
    p_resolution_note: winnerNote,
  });
  const { count: auditCountAfterReplay } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "inventory_reconciliation_issue")
    .eq("target_id", alertId)
    .contains("metadata", { resolved: true });
  check(
    "an exact lost-response replay returns the stored tray outcome without another audit",
    !replay.error && replay.data?.replayed === true && auditCountAfterReplay === 1,
    replay.error?.message ?? JSON.stringify({ replay: replay.data, auditCountAfterReplay }),
  );

  const crashedAlertId = crypto.randomUUID();
  const oldClaim = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { error: crashedInsertError } = await admin.from("owner_alerts").insert({
    id: crashedAlertId,
    branch_id: BRANCH_A,
    severity: "warning",
    kind: "operator_help",
    summary: "Stale owner-job lease probe",
    entity_ref: `operator-help:${crypto.randomUUID()}`,
    claimed_by: profileIds[0],
    claimed_at: oldClaim,
  });
  if (crashedInsertError) throw crashedInsertError;
  const reclaimAttempts = await Promise.all(profileIds.map((profileId, index) =>
    admin.rpc("resolve_owner_alert_lifecycle_v18", {
      p_branch_id: BRANCH_A,
      p_actor_id: profileId,
      p_alert_id: crashedAlertId,
      p_expected_kind: "operator_help",
      p_resolution_note: `Recovered stale job ${index + 1}.`,
    })));
  const { data: reclaimed } = await admin
    .from("owner_alerts")
    .select("claimed_by,resolved_at")
    .eq("id", crashedAlertId)
    .single();
  check(
    "a crashed stale tray claim is reclaimed exactly once",
    reclaimAttempts.filter((attempt) => !attempt.error).length === 1
      && Boolean(reclaimed.resolved_at)
      && profileIds.includes(reclaimed.claimed_by),
    JSON.stringify({ attempts: reclaimAttempts.map((attempt) => attempt.error?.message ?? attempt.data), reclaimed }),
  );

  const freshAlertId = crypto.randomUUID();
  const { error: freshInsertError } = await admin.from("owner_alerts").insert({
    id: freshAlertId,
    branch_id: BRANCH_A,
    severity: "warning",
    kind: "operator_help",
    summary: "Fresh owner-job lease probe",
    entity_ref: `operator-help:${crypto.randomUUID()}`,
    claimed_by: profileIds[0],
    claimed_at: new Date().toISOString(),
  });
  if (freshInsertError) throw freshInsertError;
  const blocked = await admin.rpc("resolve_owner_alert_lifecycle_v18", {
    p_branch_id: BRANCH_A,
    p_actor_id: profileIds[1],
    p_alert_id: freshAlertId,
    p_expected_kind: "operator_help",
    p_resolution_note: "Should not steal this job.",
  });
  const holder = await admin.rpc("resolve_owner_alert_lifecycle_v18", {
    p_branch_id: BRANCH_A,
    p_actor_id: profileIds[0],
    p_alert_id: freshAlertId,
    p_expected_kind: "operator_help",
    p_resolution_note: "Original claimant completed this job.",
  });
  check(
    "a fresh tray lease cannot be stolen and its holder can finish",
    Boolean(blocked.error) && /already claimed/i.test(blocked.error.message) && !holder.error,
    JSON.stringify({ blocked: blocked.error?.message, holder: holder.error?.message ?? holder.data }),
  );
}

async function verifyDeliveryCostDedupe(profileId) {
  const entityRef = `${crypto.randomUUID()}:cost`;
  const attempts = await Promise.all([
    rpc(admin, "ensure_delivery_cost_owner_alert_v18", {
      p_branch_id: BRANCH_A,
      p_summary: "Concurrent cost job probe",
      p_entity_ref: entityRef,
      p_created_by: profileId,
    }),
    rpc(admin, "ensure_delivery_cost_owner_alert_v18", {
      p_branch_id: BRANCH_A,
      p_summary: "Concurrent cost job probe",
      p_entity_ref: entityRef,
      p_created_by: profileId,
    }),
  ]);
  const { count } = await admin
    .from("owner_alerts")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", BRANCH_A)
    .eq("kind", "operator_delivery_cost_pending")
    .eq("entity_ref", entityRef)
    .is("resolved_at", null);
  check(
    "concurrent delivery-cost producers converge on one open owner job",
    count === 1 && attempts[0]?.id === attempts[1]?.id && attempts.filter((attempt) => attempt?.created).length === 1,
    JSON.stringify({ attempts, count }),
  );

  const suffix = crypto.randomUUID().slice(0, 8);
  const productId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  productIds.push(productId);
  batchIds.push(batchId);
  let { error } = await admin.from("products").insert({
    id: productId,
    branch_id: BRANCH_A,
    name: `Atomic cost ${suffix}`,
    slug: `atomic-cost-${suffix}`,
    unit_type: "kg",
    price_per_unit: 10,
    is_available: true,
    stock_status: "in_stock",
  });
  if (error) throw error;
  ({ error } = await admin.from("inventory_batches").insert({
    id: batchId,
    branch_id: BRANCH_A,
    product_id: productId,
    received_date: "2088-06-10",
    expiry_date: "2088-06-20",
    received_weight_kg: 5,
    remaining_weight_kg: 5,
    invoice_cost: 0,
    cost_per_kg: 0,
    batch_number: `OP-ATOMIC-${suffix}`,
  }));
  if (error) throw error;
  const costAlert = await rpc(admin, "ensure_delivery_cost_owner_alert_v18", {
    p_branch_id: BRANCH_A,
    p_summary: "Atomic cost resolution probe",
    p_entity_ref: `${batchId}:cost`,
    p_created_by: profileId,
  });
  const races = await Promise.all([
    admin.rpc("resolve_delivery_cost_owner_job_v18", {
      p_branch_id: BRANCH_A, p_actor_id: profileId, p_alert_id: costAlert.id, p_batch_id: batchId, p_invoice_cost: 21,
    }),
    admin.rpc("resolve_delivery_cost_owner_job_v18", {
      p_branch_id: BRANCH_A, p_actor_id: profileId, p_alert_id: costAlert.id, p_batch_id: batchId, p_invoice_cost: 22,
    }),
  ]);
  const { data: savedBatch } = await admin.from("inventory_batches").select("invoice_cost").eq("id", batchId).single();
  const { data: savedAlert } = await admin
    .from("owner_alerts")
    .select("resolved_at,resolution_note,claimed_by")
    .eq("id", costAlert.id)
    .single();
  const winnerCost = Number(savedBatch.invoice_cost);
  const { count: batchAuditCount } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "cost_changed")
    .eq("target_id", batchId);
  const { count: jobAuditCount } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "inventory_reconciliation_issue")
    .eq("target_id", costAlert.id)
    .contains("metadata", { resolved: true });
  check(
    "concurrent rich cost actions commit one cost, one resolution and both audit facts atomically",
    races.filter((result) => !result.error).length === 1
      && [21, 22].includes(winnerCost)
      && Boolean(savedAlert.resolved_at)
      && savedAlert.claimed_by === profileId
      && batchAuditCount === 1
      && jobAuditCount === 1,
    JSON.stringify({ races: races.map((result) => result.error?.message ?? result.data), savedBatch, savedAlert, batchAuditCount, jobAuditCount }),
  );
  const replay = await admin.rpc("resolve_delivery_cost_owner_job_v18", {
    p_branch_id: BRANCH_A, p_actor_id: profileId, p_alert_id: costAlert.id, p_batch_id: batchId, p_invoice_cost: winnerCost,
  });
  check(
    "a lost-response replay returns the original cost without another audit",
    !replay.error && replay.data?.replayed === true,
    replay.error?.message ?? JSON.stringify(replay.data),
  );

  const faultBatchId = crypto.randomUUID();
  batchIds.push(faultBatchId);
  ({ error } = await admin.from("inventory_batches").insert({
    id: faultBatchId,
    branch_id: BRANCH_A,
    product_id: productId,
    received_date: "2088-06-10",
    expiry_date: "2088-06-20",
    received_weight_kg: 4,
    remaining_weight_kg: 4,
    invoice_cost: 0,
    cost_per_kg: 0,
    batch_number: `OP-FAULT-${suffix}`,
  }));
  if (error) throw error;
  const faultAlert = await rpc(admin, "ensure_delivery_cost_owner_alert_v18", {
    p_branch_id: BRANCH_A,
    p_summary: "Atomic cost fault probe",
    p_entity_ref: `${faultBatchId}:cost`,
    p_created_by: profileId,
  });
  const faultSetup = psql(`
    CREATE OR REPLACE FUNCTION public.__v18_owner_job_fault() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''owner job fault injection''; END';
    CREATE TRIGGER __v18_owner_job_fault BEFORE UPDATE ON public.owner_alerts
    FOR EACH ROW WHEN (OLD.id = '${faultAlert.id}'::uuid)
    EXECUTE FUNCTION public.__v18_owner_job_fault();
  `);
  if (!faultSetup.ok) {
    check("meta: docker psql reachable for owner-job fault injection", false, faultSetup.err);
  } else {
    const faultResult = await admin.rpc("resolve_delivery_cost_owner_job_v18", {
      p_branch_id: BRANCH_A, p_actor_id: profileId, p_alert_id: faultAlert.id, p_batch_id: faultBatchId, p_invoice_cost: 18,
    });
    const [{ data: faultBatch }, { data: faultJob }] = await Promise.all([
      admin.from("inventory_batches").select("invoice_cost").eq("id", faultBatchId).single(),
      admin.from("owner_alerts").select("resolved_at,claimed_by").eq("id", faultAlert.id).single(),
    ]);
    check(
      "a forced lifecycle failure rolls back delivery cost, claim, resolution and audits",
      Boolean(faultResult.error) && Number(faultBatch.invoice_cost) === 0 && !faultJob.resolved_at && !faultJob.claimed_by,
      JSON.stringify({ error: faultResult.error?.message, faultBatch, faultJob }),
    );
    psql("DROP TRIGGER IF EXISTS __v18_owner_job_fault ON public.owner_alerts; DROP FUNCTION IF EXISTS public.__v18_owner_job_fault();");
    const recovered = await admin.rpc("resolve_delivery_cost_owner_job_v18", {
      p_branch_id: BRANCH_A, p_actor_id: profileId, p_alert_id: faultAlert.id, p_batch_id: faultBatchId, p_invoice_cost: 18,
    });
    check("the same cost job completes after the injected fault is removed", !recovered.error, recovered.error?.message ?? "");
  }
}

async function verifyHelpOperationIdentity() {
  const operationId = crypto.randomUUID();
  const args = { p_operation_id: operationId, p_problem: "fridge", p_note: "temperature rising" };
  const attempts = await Promise.all([
    manager.rpc("create_operator_help_alert_v18", args),
    manager.rpc("create_operator_help_alert_v18", args),
  ]);
  const receipts = attempts.map((attempt) => attempt.data);
  const alertId = receipts[0]?.id;
  const [{ data: alerts }, { count: dispatches }, { count: audits }] = await Promise.all([
    admin.from("owner_alerts").select("id,operation_fingerprint,resolved_at").eq("branch_id", BRANCH_A).eq("operation_id", operationId),
    admin.from("alert_dispatches").select("id", { count: "exact", head: true }).eq("alert_id", alertId),
    admin.from("audit_logs").select("id", { count: "exact", head: true })
      .eq("event_type", "inventory_reconciliation_issue").eq("target_id", alertId),
  ]);
  check(
    "concurrent urgent-help replay converges on one operation, audit and outbox debt",
    attempts.every((attempt) => !attempt.error)
      && receipts[0]?.id === receipts[1]?.id
      && JSON.stringify(receipts.map((receipt) => receipt?.replayed).sort()) === JSON.stringify([false, true])
      && alerts?.length === 1
      && alerts[0]?.operation_fingerprint?.length === 64
      && dispatches === 1
      && audits === 1,
    JSON.stringify({ receipts, alerts, dispatches, audits, errors: attempts.map((attempt) => attempt.error?.message) }),
  );

  await admin.from("owner_alerts").update({ resolved_at: new Date().toISOString(), resolution_note: "test clear" }).eq("id", alertId);
  const resolvedReplay = await manager.rpc("create_operator_help_alert_v18", args);
  const [{ count: resolvedHistory }, { count: resolvedAudits }] = await Promise.all([
    admin.from("owner_alerts").select("id", { count: "exact", head: true }).eq("branch_id", BRANCH_A).eq("operation_id", operationId),
    admin.from("audit_logs").select("id", { count: "exact", head: true })
      .eq("event_type", "inventory_reconciliation_issue").eq("target_id", alertId),
  ]);
  check(
    "a delayed retry returns the resolved original without new alert, audit or dispatch",
    !resolvedReplay.error
      && resolvedReplay.data?.id === alertId
      && resolvedReplay.data?.replayed === true
      && resolvedReplay.data?.resolved === true
      && resolvedHistory === 1
      && resolvedAudits === 1,
    JSON.stringify({ replay: resolvedReplay.data, error: resolvedReplay.error?.message, resolvedHistory, resolvedAudits }),
  );

  const changed = await manager.rpc("create_operator_help_alert_v18", { ...args, p_note: "different details" });
  check(
    "reusing a help operation id with changed payload is rejected",
    Boolean(changed.error) && /different details/i.test(changed.error?.message ?? ""),
    changed.error?.message ?? "no error",
  );

  const faultOperationId = crypto.randomUUID();
  const faultSetup = psql(`
    CREATE OR REPLACE FUNCTION public.__v18_help_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'help audit fault injection'; END; $$;
    CREATE TRIGGER __v18_help_audit_fault BEFORE INSERT ON public.audit_logs
    FOR EACH ROW WHEN (NEW.event_type = 'inventory_reconciliation_issue'
      AND NEW.metadata->>'operation_id' = '${faultOperationId}')
    EXECUTE FUNCTION public.__v18_help_audit_fault();
  `);
  if (!faultSetup.ok) {
    check("meta: help audit fault trigger installed", false, faultSetup.err);
  } else {
    const fault = await manager.rpc("create_operator_help_alert_v18", {
      p_operation_id: faultOperationId, p_problem: "unsure", p_note: "fault probe",
    });
    const { count: faultAlerts } = await admin.from("owner_alerts").select("id", { count: "exact", head: true })
      .eq("branch_id", BRANCH_A).eq("operation_id", faultOperationId);
    check(
      "an audit failure rolls the help alert back atomically",
      Boolean(fault.error) && faultAlerts === 0,
      JSON.stringify({ error: fault.error?.message, faultAlerts }),
    );
    psql("DROP TRIGGER IF EXISTS __v18_help_audit_fault ON public.audit_logs; DROP FUNCTION IF EXISTS public.__v18_help_audit_fault();");
  }
}

async function verifyMistakeOperationIdentity(profileId) {
  const runId = crypto.randomUUID();
  const resultRef = `order:${crypto.randomUUID()}`;
  workflowRunIds.push(runId);
  const { error: runError } = await admin.from("operator_workflow_runs").insert({
    id: runId,
    branch_id: BRANCH_A,
    operator_id: profileId,
    workflow: "serve",
    status: "completed",
    steps: {},
    result_ref: resultRef,
    completion_fingerprint: `owner-help-${runId}`,
    completion_receipt: { order_id: resultRef.slice("order:".length) },
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (runError) throw runError;

  const operationId = crypto.randomUUID();
  const args = { p_operation_id: operationId, p_problem: "mistake", p_note: "wrong weight" };
  const attempts = await Promise.all([
    manager.rpc("create_operator_help_alert_v18", args),
    manager.rpc("create_operator_help_alert_v18", args),
  ]);
  const receipts = attempts.map((attempt) => attempt.data);
  const alertId = receipts[0]?.id;
  const [{ data: alerts }, { count: audits }] = await Promise.all([
    admin.from("owner_alerts").select("id,entity_ref").eq("branch_id", BRANCH_A).eq("operation_id", operationId),
    admin.from("audit_logs").select("id", { count: "exact", head: true })
      .eq("event_type", "inventory_reconciliation_issue").eq("target_id", alertId),
  ]);
  check(
    "mistake replay atomically freezes the latest completed run target",
    attempts.every((attempt) => !attempt.error)
      && receipts[0]?.id === receipts[1]?.id
      && alerts?.length === 1
      && alerts[0]?.entity_ref === resultRef
      && audits === 1,
    JSON.stringify({ receipts, alerts, audits, errors: attempts.map((attempt) => attempt.error?.message) }),
  );

  const newerRunId = crypto.randomUUID();
  const newerResultRef = `order:${crypto.randomUUID()}`;
  workflowRunIds.push(newerRunId);
  const { error: newerRunError } = await admin.from("operator_workflow_runs").insert({
    id: newerRunId,
    branch_id: BRANCH_A,
    operator_id: profileId,
    workflow: "serve",
    status: "completed",
    steps: {},
    result_ref: newerResultRef,
    completion_fingerprint: `owner-help-${newerRunId}`,
    completion_receipt: { order_id: newerResultRef.slice("order:".length) },
    completed_at: new Date(Date.now() + 1_000).toISOString(),
    updated_at: new Date(Date.now() + 1_000).toISOString(),
  });
  if (newerRunError) throw newerRunError;
  const lostResponseRetry = await manager.rpc("create_operator_help_alert_v18", args);
  check(
    "a newer completed run cannot retarget a lost-response retry",
    !lostResponseRetry.error
      && lostResponseRetry.data?.id === alertId
      && lostResponseRetry.data?.entity_ref === resultRef,
    JSON.stringify({ receipt: lostResponseRetry.data, error: lostResponseRetry.error?.message }),
  );

  const distinctOperations = [crypto.randomUUID(), crypto.randomUUID()];
  const distinct = await Promise.all(distinctOperations.map((id) => manager.rpc("create_operator_help_alert_v18", {
    p_operation_id: id, p_problem: "mistake", p_note: "separate report",
  })));
  const { count: sameTargetCount } = await admin.from("owner_alerts").select("id", { count: "exact", head: true })
    .eq("branch_id", BRANCH_A).eq("kind", "operator_mistake_flag").eq("entity_ref", newerResultRef).is("resolved_at", null);
  check(
    "distinct mistake operations about one run remain distinct owner jobs",
    distinct.every((attempt) => !attempt.error) && sameTargetCount === 2,
    JSON.stringify({ sameTargetCount, errors: distinct.map((attempt) => attempt.error?.message) }),
  );

  const changed = await manager.rpc("create_operator_help_alert_v18", { ...args, p_note: "changed mistake" });
  check(
    "reusing a mistake operation id with changed payload is rejected",
    Boolean(changed.error) && /different details/i.test(changed.error?.message ?? ""),
    changed.error?.message ?? "no error",
  );
}

async function verifyShortfallResolverIsolation() {
  const { error } = await manager.rpc("resolve_inventory_shortfalls_for_product_v18", {
    p_branch_id: BRANCH_B,
    p_product_id: crypto.randomUUID(),
  });
  check(
    "authenticated callers cannot invoke the trigger-internal shortfall resolver across branches",
    Boolean(error) && /permission denied/i.test(error.message),
    error?.message ?? "no error",
  );
}

async function verifyCertificateCompletion(managerProfileId) {
  const runId = crypto.randomUUID();
  const evidenceId = runId;
  evidenceIds.push(evidenceId);
  workflowRunIds.push(runId);
  const objectPath = `${BRANCH_A}/certificate/${runId}.jpg`;
  let { error } = await admin.from("operator_evidence").insert({
    id: evidenceId,
    branch_id: BRANCH_A,
    object_path: objectPath,
    file_name: "certificate.jpg",
    content_type: "image/jpeg",
    size_bytes: 2048,
    evidence_type: "certificate",
    source_type: "operator_workflow_run",
    source_id: runId,
    status: "uploaded",
    uploaded_by: managerProfileId,
  });
  if (error) throw error;

  const completionArgs = {
    p_run_id: runId,
    p_branch_id: BRANCH_A,
    p_evidence_id: evidenceId,
    p_paper_kind: "halal",
  };
  const [first, second] = await Promise.all([
    rpc(manager, "complete_operator_certificate_v18", completionArgs),
    rpc(manager, "complete_operator_certificate_v18", completionArgs),
  ]);
  const documentId = first.document_id;
  complianceDocumentIds.push(documentId);
  const { data: documents, count: documentCount } = await admin
    .from("compliance_documents")
    .select("id,doc_type,status,uploaded_by", { count: "exact" })
    .eq("branch_id", BRANCH_A)
    .eq("document_url", `operator_evidence:${evidenceId}`);
  const { data: jobs, count: jobCount } = await admin
    .from("owner_alerts")
    .select("id,entity_ref,resolved_at", { count: "exact" })
    .eq("branch_id", BRANCH_A)
    .eq("kind", "operator_document_review")
    .eq("entity_ref", documentId);
  const { data: run } = await admin
    .from("operator_workflow_runs")
    .select("status,result_ref,completion_receipt")
    .eq("id", runId)
    .single();
  const { data: evidence } = await admin
    .from("operator_evidence")
    .select("source_type,source_id,status,review_required,object_path")
    .eq("id", evidenceId)
    .single();
  const replayFlags = [first.replayed, second.replayed].sort();
  check(
    "concurrent certificate completion converges on one document, one owner job and one terminal run",
    JSON.stringify(replayFlags) === JSON.stringify([false, true])
      && first.document_id === second.document_id
      && documentCount === 1
      && documents?.[0]?.doc_type === "halal"
      && documents?.[0]?.uploaded_by === managerProfileId
      && jobCount === 1
      && jobs?.[0]?.resolved_at === null
      && run?.status === "completed"
      && run?.result_ref === `compliance_document:${documentId}`
      && run?.completion_receipt?.document_id === documentId
      && evidence?.source_type === "compliance_document"
      && evidence?.source_id === documentId
      && evidence?.status === "needs_owner_review"
      && evidence?.review_required === true
      && evidence?.object_path === objectPath,
    JSON.stringify({ first, second, documentCount, documents, jobCount, jobs, run, evidence }),
  );

  const wrongRunId = crypto.randomUUID();
  const wrongEvidenceId = wrongRunId;
  evidenceIds.push(wrongEvidenceId);
  workflowRunIds.push(wrongRunId);
  ({ error } = await admin.from("operator_evidence").insert({
    id: wrongEvidenceId,
    branch_id: BRANCH_A,
    object_path: `${BRANCH_A}/certificate/${wrongRunId}.jpg`,
    file_name: "wrong-type.jpg",
    content_type: "image/jpeg",
    size_bytes: 1024,
    evidence_type: "fridge_check",
    source_type: "operator_workflow_run",
    source_id: wrongRunId,
    status: "uploaded",
    uploaded_by: managerProfileId,
  }));
  if (error) throw error;
  const { error: wrongTypeError } = await manager.rpc("complete_operator_certificate_v18", {
    p_run_id: wrongRunId,
    p_branch_id: BRANCH_A,
    p_evidence_id: wrongEvidenceId,
    p_paper_kind: "supplier",
  });
  const { count: wrongRunCount } = await admin
    .from("operator_workflow_runs")
    .select("id", { count: "exact", head: true })
    .eq("id", wrongRunId);
  const { count: wrongDocumentCount } = await admin
    .from("compliance_documents")
    .select("id", { count: "exact", head: true })
    .eq("document_url", `operator_evidence:${wrongEvidenceId}`);
  const { data: wrongEvidence } = await admin
    .from("operator_evidence")
    .select("source_type,source_id,status")
    .eq("id", wrongEvidenceId)
    .single();
  check(
    "certificate completion rejects a mismatched evidence type and rolls back its draft run",
    Boolean(wrongTypeError)
      && /not available/i.test(wrongTypeError.message)
      && wrongRunCount === 0
      && wrongDocumentCount === 0
      && wrongEvidence.source_type === "operator_workflow_run"
      && wrongEvidence.source_id === wrongRunId
      && wrongEvidence.status === "uploaded",
    JSON.stringify({ wrongTypeError: wrongTypeError?.message, wrongRunCount, wrongDocumentCount, wrongEvidence }),
  );
}

async function verifyCertificateLifecycle() {
  const asOf = new Date().toISOString().slice(0, 10);
  const supplierId = crypto.randomUUID();
  supplierIds.push(supplierId);
  const documentId = crypto.randomUUID();
  const renewalId = crypto.randomUUID();
  let { error } = await admin.from("suppliers").insert({
    id: supplierId,
    branch_id: BRANCH_A,
    name: `Expiry probe ${supplierId.slice(0, 8)}`,
    active: true,
  });
  if (error) throw error;
  ({ error } = await admin.from("supplier_documents").insert({
    id: documentId,
    supplier_id: supplierId,
    document_type: "halal_cert",
    issued_date: datePlus(asOf, -300),
    expiry_date: datePlus(asOf, 20),
    document_url: `https://example.invalid/${documentId}`,
  }));
  if (error) throw error;

  const branchBSupplierId = crypto.randomUUID();
  const branchBDocumentId = crypto.randomUUID();
  supplierIds.push(branchBSupplierId);
  ({ error } = await admin.from("suppliers").insert({
    id: branchBSupplierId,
    branch_id: BRANCH_B,
    name: `Opposite-date expiry probe ${branchBSupplierId.slice(0, 8)}`,
    active: true,
  }));
  if (error) throw error;
  ({ error } = await admin.from("supplier_documents").insert({
    id: branchBDocumentId,
    supplier_id: branchBSupplierId,
    document_type: "health_cert",
    issued_date: datePlus(asOf, -300),
    expiry_date: datePlus(asOf, 20),
    document_url: `https://example.invalid/${branchBDocumentId}`,
  }));
  if (error) throw error;

  await rpc(admin, "scan_branch_certificate_expiry_alerts_v18", { p_branch_id: BRANCH_A, p_as_of: asOf });
  const branchBRef = `supplier_document:${branchBDocumentId}`;
  let { count: branchBCount } = await admin
    .from("owner_alerts")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", BRANCH_B)
    .eq("kind", "certificate_expiring")
    .eq("entity_ref", branchBRef);
  check("a branch-A expiry scan never writes branch-B certificate jobs", branchBCount === 0, `count=${branchBCount}`);
  await rpc(admin, "scan_branch_certificate_expiry_alerts_v18", {
    p_branch_id: BRANCH_B,
    p_as_of: datePlus(asOf, -1),
  });
  const { data: branchBAlert } = await admin
    .from("owner_alerts")
    .select("summary")
    .eq("branch_id", BRANCH_B)
    .eq("kind", "certificate_expiring")
    .eq("entity_ref", branchBRef)
    .single();
  check(
    "each branch scan uses that branch's own local business date",
    /21 days/.test(branchBAlert.summary),
    branchBAlert.summary,
  );
  const entityRef = `supplier_document:${documentId}`;
  let { data: alert } = await admin
    .from("owner_alerts")
    .select("id,severity,resolved_at")
    .eq("branch_id", BRANCH_A)
    .eq("kind", "certificate_expiring")
    .eq("entity_ref", entityRef)
    .single();
  check("certificate at 20 days creates one warning owner job", alert.severity === "warning" && !alert.resolved_at);
  let { data: certificateLifecycle } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("event_type", "owner_alert_lifecycle_changed")
    .eq("target_id", alert.id);
  check(
    "certificate creation writes exactly one lifecycle transition",
    certificateLifecycle?.length === 1 && certificateLifecycle[0]?.metadata?.transition === "created",
    JSON.stringify(certificateLifecycle),
  );

  await rpc(admin, "scan_branch_certificate_expiry_alerts_v18", { p_branch_id: BRANCH_A, p_as_of: asOf });
  const { data: lifecycleAfterNoop } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("event_type", "owner_alert_lifecycle_changed")
    .eq("target_id", alert.id);
  check(
    "an unchanged certificate scan writes no duplicate lifecycle audit",
    lifecycleAfterNoop?.length === 1 && lifecycleAfterNoop[0]?.metadata?.transition === "created",
    JSON.stringify(lifecycleAfterNoop),
  );

  // Forward-heal any historically note-cleared certificate job. New UI/server
  // code forbids that bypass, but shipped data must still reopen and escalate.
  ({ error } = await admin
    .from("owner_alerts")
    .update({ resolved_at: new Date().toISOString(), resolution_note: "Legacy manual clear probe" })
    .eq("id", alert.id));
  if (error) throw error;
  ({ error } = await admin.from("supplier_documents").update({ expiry_date: datePlus(asOf, 5) }).eq("id", documentId));
  if (error) throw error;
  await rpc(admin, "scan_branch_certificate_expiry_alerts_v18", { p_branch_id: BRANCH_A, p_as_of: asOf });
  ({ data: alert } = await admin
    .from("owner_alerts")
    .select("id,severity,resolved_at")
    .eq("id", alert.id)
    .single());
  const { count: dispatches } = await admin
    .from("alert_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("alert_id", alert.id);
  check(
    "an improperly cleared certificate job reopens, escalates the same row and enqueues urgent delivery",
    alert.severity === "critical" && !alert.resolved_at && dispatches === 1,
  );
  ({ data: certificateLifecycle } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("event_type", "owner_alert_lifecycle_changed")
    .eq("target_id", alert.id));
  const riskTransitions = (certificateLifecycle ?? []).map((row) => row.metadata?.transition).sort();
  check(
    "certificate reopen and escalation are each append-only lifecycle facts",
    JSON.stringify(riskTransitions) === JSON.stringify(["created", "escalated", "reopened"]),
    JSON.stringify(certificateLifecycle),
  );

  ({ error } = await admin.from("supplier_documents").insert({
    id: renewalId,
    supplier_id: supplierId,
    document_type: "halal_cert",
    issued_date: asOf,
    expiry_date: datePlus(asOf, 365),
    document_url: `https://example.invalid/${renewalId}`,
  }));
  if (error) throw error;
  await rpc(admin, "scan_branch_certificate_expiry_alerts_v18", { p_branch_id: BRANCH_A, p_as_of: asOf });
  const { data: resolved } = await admin
    .from("owner_alerts")
    .select("resolved_at,resolution_note")
    .eq("id", alert.id)
    .single();
  check(
    "a renewed certificate auto-resolves the superseded document job",
    Boolean(resolved.resolved_at) && /renewed/i.test(resolved.resolution_note ?? ""),
    JSON.stringify(resolved),
  );
  ({ data: certificateLifecycle } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("event_type", "owner_alert_lifecycle_changed")
    .eq("target_id", alert.id));
  const finalTransitions = (certificateLifecycle ?? []).map((row) => row.metadata?.transition).sort();
  check(
    "certificate renewal appends exactly one auto-resolution transition",
    JSON.stringify(finalTransitions) === JSON.stringify(["auto_resolved", "created", "escalated", "reopened"]),
    JSON.stringify(certificateLifecycle),
  );
}

async function verifyOpeningDefinition() {
  const { data: definition } = await admin
    .from("ops_checklist_definitions")
    .select("id,version")
    .eq("kind", "opening")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  const { data: steps } = await admin
    .from("ops_checklist_definition_steps")
    .select("step_key")
    .eq("definition_id", definition.id)
    .order("sort_order");
  const keys = (steps ?? []).map((step) => step.step_key);
  check(
    "active opening definition is v2 and contains no certificate ritual",
    definition.version === 2 && JSON.stringify(keys) === JSON.stringify(["fridge_temp", "display_ready", "float_ready", "open_sign"]),
    JSON.stringify({ definition, keys }),
  );
}

async function cleanup() {
  for (const sessionId of sessionIds) await admin.from("ops_checklist_sessions").delete().eq("id", sessionId);
  for (const supplierId of supplierIds) await admin.from("suppliers").delete().eq("id", supplierId);
  const { data: currentAlerts } = await admin.from("owner_alerts").select("id");
  const newIds = (currentAlerts ?? []).map((row) => row.id).filter((id) => !baselineAlertIds.has(id));
  for (let index = 0; index < newIds.length; index += 100) {
    await admin.from("owner_alerts").delete().in("id", newIds.slice(index, index + 100));
  }
  if (complianceDocumentIds.length) await admin.from("compliance_documents").delete().in("id", complianceDocumentIds);
  if (evidenceIds.length) await admin.from("operator_evidence").delete().in("id", evidenceIds);
  if (workflowRunIds.length) await admin.from("operator_workflow_runs").delete().in("id", workflowRunIds);
  if (batchIds.length) await admin.from("inventory_batches").delete().in("id", batchIds);
  if (productIds.length) await admin.from("products").delete().in("id", productIds);
}

async function main() {
  const { error: signInError } = await manager.auth.signInWithPassword({ email: "manager@ptm.test", password: PASSWORD });
  if (signInError) throw new Error(`manager sign-in failed: ${signInError.message}`);
  const { data: initialAlerts, error: initialError } = await admin.from("owner_alerts").select("id");
  if (initialError) throw initialError;
  baselineAlertIds = new Set((initialAlerts ?? []).map((row) => row.id));
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id,email")
    .in("email", ["owner@ptm.test", "manager@ptm.test"]);
  if (profilesError || profiles?.length !== 2) throw new Error(profilesError?.message ?? "Seeded owner and manager profiles are required.");

  try {
    await verifyOpeningDefinition();
    await verifyChecklistLifecycle();
    await verifyNotOpenedLifecycle();
    await verifyClaimConcurrency(profiles.map((profile) => profile.id));
    await verifyDeliveryCostDedupe(profiles[0].id);
    await verifyHelpOperationIdentity();
    await verifyMistakeOperationIdentity(profiles.find((profile) => profile.email === "manager@ptm.test").id);
    await verifyShortfallResolverIsolation();
    await verifyCertificateCompletion(profiles.find((profile) => profile.email === "manager@ptm.test").id);
    await verifyCertificateLifecycle();
  } finally {
    await cleanup();
  }

  console.log(`\nOwner-jobs guard: ${pass} passed, ${fail} failed.`);
  if (fail) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(2);
});
