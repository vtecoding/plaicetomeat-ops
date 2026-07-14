// V18 B1 database guard — transactional enqueue, bounded single claim,
// delivered stamp, bounded retry and terminal-visible ambiguous outcomes.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let pass = 0, fail = 0;
const ids = [];
let awayDigestId = null;
const additionalDigestIds = [];
const transientDispatchIds = [];
let settingsTouched = false;
const { data: settingsBefore } = await admin
  .from("branch_operator_settings")
  .select("owner_away,away_since,summary_time,owner_contact,updated_at,updated_by,expected_open_time")
  .eq("branch_id", BRANCH)
  .maybeSingle();
function check(name, condition, detail = "") {
  if (condition) { pass += 1; console.log(`  PASS  ${name}${detail ? `  ::  ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  ::  ${detail}` : ""}`); }
}
async function rpc(name, args) {
  const result = await admin.rpc(name, args);
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  return result.data;
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
async function createCritical(label) {
  const id = crypto.randomUUID(); ids.push(id);
  const { error } = await admin.from("owner_alerts").insert({ id, branch_id: BRANCH, severity: "critical", kind: "operator_help", summary: label, entity_ref: `dispatch-probe:${id}` });
  if (error) throw error;
  const { data } = await admin.from("alert_dispatches").select("*").eq("alert_id", id).single();
  return { alertId: id, dispatch: data };
}

try {
  const atomic = await createCritical("Dispatch atomicity probe");
  check("critical alert atomically creates pending dispatch debt", atomic.dispatch?.status === "pending", atomic.dispatch?.status);
  check("critical dispatch key is stable", atomic.dispatch?.provider_idempotency_key === `critical-alert:${atomic.alertId}`, atomic.dispatch?.provider_idempotency_key);

  const blockedAlertId = crypto.randomUUID();
  const blockedKey = `critical-alert:${blockedAlertId}`;
  const { data: blocker, error: blockerError } = await admin.from("alert_dispatches").insert({
    branch_id: BRANCH, kind: "daily_digest", channel: "disabled", target: "", status: "pending",
    provider_idempotency_key: blockedKey, payload: { message: "blocker" }, next_attempt_at: new Date().toISOString(),
  }).select("id").single();
  if (blockerError) throw blockerError;
  transientDispatchIds.push(blocker.id);
  const { error: rolledBack } = await admin.from("owner_alerts").insert({
    id: blockedAlertId, branch_id: BRANCH, severity: "critical", kind: "operator_help", summary: "must roll back", entity_ref: `dispatch-probe:${blockedAlertId}`,
  });
  const { count: blockedAlertCount } = await admin.from("owner_alerts").select("id", { count: "exact", head: true }).eq("id", blockedAlertId);
  check("outbox constraint failure rolls back the alert insert", Boolean(rolledBack) && blockedAlertCount === 0, rolledBack?.message ?? "no error");

  const { error: orphanError } = await admin.from("alert_dispatches").insert({
    branch_id: BRANCH, kind: "critical_alert", alert_id: null, channel: "disabled", target: "", status: "pending",
    provider_idempotency_key: `orphan:${crypto.randomUUID()}`, payload: { message: "orphan" },
  });
  check("critical dispatch cannot exist without its alert", Boolean(orphanError), orphanError?.message ?? "no error");

  const { error: prioritiseClaimError } = await admin
    .from("alert_dispatches")
    .update({ next_attempt_at: "2000-01-01T00:00:00Z" })
    .eq("id", atomic.dispatch.id);
  if (prioritiseClaimError) throw prioritiseClaimError;
  const firstClaim = await rpc("claim_alert_dispatches_v18", { p_limit: 1 });
  const claimedAtomic = firstClaim.find((row) => row.id === atomic.dispatch.id);
  const secondClaim = psql(String.raw`
BEGIN;
SELECT count(*)
FROM public.claim_alert_dispatches_v18(1)
WHERE id = '${atomic.dispatch.id}'::uuid;
ROLLBACK;
`);
  check(
    "leased row is claimed once",
    Boolean(claimedAtomic) && secondClaim.ok && secondClaim.out.split(/\r?\n/).includes("0"),
    secondClaim.ok ? secondClaim.out : secondClaim.err,
  );
  await rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: atomic.dispatch.id, p_status: "sent", p_last_error: null,
    p_provider_response: "provider-message-1", p_retryable: false, p_ambiguous: false,
  });
  const { data: delivered } = await admin.from("owner_alerts").select("delivered_at").eq("id", atomic.alertId).single();
  check("delivered_at stamps only after confirmed send", Boolean(delivered?.delivered_at), delivered?.delivered_at ?? "null");

  const retry = await createCritical("Retry bound probe");
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await rpc("begin_alert_dispatch_attempt_v18", { p_dispatch_id: retry.dispatch.id });
    await rpc("record_alert_dispatch_result_v18", {
      p_dispatch_id: retry.dispatch.id, p_status: "failed", p_last_error: `definite retryable ${attempt}`,
      p_provider_response: null, p_retryable: true, p_ambiguous: false,
    });
  }
  const { data: terminal } = await admin.from("alert_dispatches").select("status,attempts,next_attempt_at").eq("id", retry.dispatch.id).single();
  check("bounded retry becomes terminal on attempt five", terminal?.status === "failed" && terminal.attempts === 5 && terminal.next_attempt_at === null, JSON.stringify(terminal));

  const ambiguous = await createCritical("Ambiguous result probe");
  await rpc("begin_alert_dispatch_attempt_v18", { p_dispatch_id: ambiguous.dispatch.id });
  await rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: ambiguous.dispatch.id, p_status: "failed", p_last_error: "AMBIGUOUS_PROVIDER_RESULT: timeout",
    p_provider_response: null, p_retryable: false, p_ambiguous: true,
  });
  const { data: uncertain } = await admin.from("alert_dispatches").select("status,attempts,next_attempt_at,send_started_at").eq("id", ambiguous.dispatch.id).single();
  check("ambiguous provider result is terminal-visible and not retried", uncertain?.status === "failed" && uncertain.attempts === 1 && uncertain.next_attempt_at === null && Boolean(uncertain.send_started_at), JSON.stringify(uncertain));

  const { data: ownerProfile } = await admin.from("profiles").select("id").eq("email", "owner@ptm.test").single();
  await rpc("set_owner_away_mode_v18", {
    p_branch_id: BRANCH, p_owner_away: false, p_updated_by: ownerProfile.id, p_now: "2088-06-10T09:00:00Z",
  });
  settingsTouched = true;
  const { count: awayAuditBefore } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "branch_settings_updated")
    .eq("target_type", "branch_operator_settings")
    .eq("target_id", BRANCH);
  const faultKey = `digest-away:${BRANCH}:2088-06-10T09:00:30+00:00`;
  const { data: awayBlocker, error: awayBlockerError } = await admin.from("alert_dispatches").insert({
    branch_id: BRANCH_B, kind: "daily_digest", channel: "disabled", target: "", status: "pending",
    provider_idempotency_key: faultKey, payload: { message: "Owner Away fault blocker" }, next_attempt_at: new Date().toISOString(),
  }).select("id").single();
  if (awayBlockerError) throw awayBlockerError;
  transientDispatchIds.push(awayBlocker.id);
  const { error: awayFault } = await admin.rpc("set_owner_away_mode_with_digest_v18", {
    p_branch_id: BRANCH, p_owner_away: true, p_updated_by: ownerProfile.id,
    p_business_date: "2088-06-10", p_target: "", p_payload: { message: "Must roll back" },
    p_now: "2088-06-10T09:00:30Z",
  });
  const { data: afterAwayFault } = await admin
    .from("branch_operator_settings")
    .select("owner_away,away_since")
    .eq("branch_id", BRANCH)
    .single();
  const { count: auditAfterAwayFault } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "branch_settings_updated")
    .eq("target_type", "branch_operator_settings")
    .eq("target_id", BRANCH);
  check(
    "an immediate-digest outbox failure rolls back the Owner Away toggle and its audit",
    Boolean(awayFault) && (
      afterAwayFault === null
      || (afterAwayFault.owner_away === false && afterAwayFault.away_since === null)
    )
      && auditAfterAwayFault === awayAuditBefore,
    JSON.stringify({ awayFault: awayFault?.message, afterAwayFault, awayAuditBefore, auditAfterAwayFault }),
  );
  await admin.from("alert_dispatches").delete().eq("id", awayBlocker.id);

  const firstAway = await rpc("set_owner_away_mode_with_digest_v18", {
    p_branch_id: BRANCH, p_owner_away: true, p_updated_by: ownerProfile.id,
    p_business_date: "2088-06-10", p_target: "", p_payload: { message: "Owner Away transition probe" },
    p_now: "2088-06-10T09:01:00Z",
  });
  const replayAway = await rpc("set_owner_away_mode_with_digest_v18", {
    p_branch_id: BRANCH, p_owner_away: true, p_updated_by: ownerProfile.id,
    p_business_date: "2088-06-10", p_target: "", p_payload: { message: "Owner Away transition replay" },
    p_now: "2088-06-10T09:02:00Z",
  });
  awayDigestId = firstAway.digest_id;
  const { data: awayDispatch } = await admin
    .from("alert_dispatches")
    .select("provider_idempotency_key")
    .eq("id", awayDigestId)
    .single();
  const awayKey = awayDispatch.provider_idempotency_key;
  const { count: awayDigestCount } = await admin
    .from("alert_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("provider_idempotency_key", awayKey);
  const { count: awayAuditAfter } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "branch_settings_updated")
    .eq("target_type", "branch_operator_settings")
    .eq("target_id", BRANCH);
  check(
    "Owner Away replay preserves away_since, one digest and one atomic transition audit",
    firstAway.changed === true && replayAway.changed === false
      && firstAway.away_since === replayAway.away_since && awayDigestCount === 1
      && firstAway.digest_id === replayAway.digest_id
      && (awayAuditAfter ?? 0) - (awayAuditBefore ?? 0) === 1,
    JSON.stringify({ firstAway, replayAway, awayDigestCount, awayAuditBefore, awayAuditAfter }),
  );

  const paymentTruth = psql(String.raw`
BEGIN;
CREATE TEMP TABLE ptm_away_probe_orders AS
SELECT idx, gen_random_uuid() AS id,
       (idx <= 22) AS recent_paid,
       (idx = 25) AS old_paid
FROM generate_series(1, 25) AS series(idx);

INSERT INTO public.orders(
  id, branch_id, order_ref, customer_name, customer_phone, status,
  pickup_date, subtotal, idempotency_key, created_at, updated_at
)
SELECT
  id,
  '${BRANCH}'::uuid,
  'PTM-AWAY-' || replace(id::text, '-', ''),
  'Owner Away ledger probe',
  '07123456789',
  CASE WHEN idx = 23 THEN 'incoming' WHEN idx = 24 THEN 'ready' ELSE 'collected' END,
  DATE '2199-06-10',
  CASE WHEN idx = 1 THEN 999.99 ELSE 777.77 END,
  'owner-away-order:' || id::text,
  TIMESTAMPTZ '2199-06-10 08:00:00+00',
  TIMESTAMPTZ '2199-06-10 08:00:00+00'
FROM ptm_away_probe_orders;

INSERT INTO public.payment_events(
  branch_id, order_id, direction, method, amount_pence,
  business_date, idempotency_key, created_at
)
SELECT
  '${BRANCH}'::uuid,
  id,
  'sale',
  'card',
  CASE WHEN idx = 1 THEN 2500 WHEN idx = 25 THEN 99900 ELSE 100 END,
  DATE '2199-06-10',
  'owner-away-sale:' || id::text,
  CASE
    WHEN old_paid THEN TIMESTAMPTZ '2199-06-10 08:30:00+00'
    ELSE TIMESTAMPTZ '2199-06-10 10:00:00+00' + make_interval(secs => 100 - idx)
  END
FROM ptm_away_probe_orders
WHERE recent_paid OR old_paid;

INSERT INTO public.payment_events(
  branch_id, order_id, direction, method, amount_pence,
  business_date, idempotency_key, created_at
)
SELECT
  '${BRANCH}'::uuid, id, 'refund', 'card', 500, DATE '2199-06-10',
  'owner-away-refund:' || id::text, TIMESTAMPTZ '2199-06-10 10:03:00+00'
FROM ptm_away_probe_orders
WHERE idx = 1;

DO $guard$
DECLARE
  v_totals jsonb;
  v_preview_count integer;
  v_unpaid_preview_count integer;
  v_frozen_sale numeric;
BEGIN
  SELECT public.owner_away_aggregates_v18(
    '${BRANCH}'::uuid,
    TIMESTAMPTZ '2199-06-10 09:00:00+00'
  ) INTO v_totals;
  IF (v_totals->>'order_count')::integer <> 22 THEN
    RAISE EXCEPTION 'Owner Away order count was %, expected 22', v_totals->>'order_count';
  END IF;
  IF (v_totals->>'revenue')::numeric <> 41.00 THEN
    RAISE EXCEPTION 'Owner Away net takings were %, expected 41.00', v_totals->>'revenue';
  END IF;

  SELECT count(*) INTO v_preview_count
  FROM public.owner_away_latest_sales_v18(
    '${BRANCH}'::uuid,
    TIMESTAMPTZ '2199-06-10 09:00:00+00',
    20
  );
  IF v_preview_count <> 20 THEN
    RAISE EXCEPTION 'Owner Away bounded preview count was %, expected 20', v_preview_count;
  END IF;

  SELECT count(*) INTO v_unpaid_preview_count
  FROM public.owner_away_latest_sales_v18(
    '${BRANCH}'::uuid,
    TIMESTAMPTZ '2199-06-10 09:00:00+00',
    20
  ) preview
  JOIN ptm_away_probe_orders probe ON probe.id = preview.id
  WHERE NOT probe.recent_paid;
  IF v_unpaid_preview_count <> 0 THEN
    RAISE EXCEPTION 'Owner Away preview included % unpaid/old orders', v_unpaid_preview_count;
  END IF;

  SELECT preview.subtotal INTO v_frozen_sale
  FROM public.owner_away_latest_sales_v18(
    '${BRANCH}'::uuid,
    TIMESTAMPTZ '2199-06-10 09:00:00+00',
    20
  ) preview
  WHERE preview.id = (SELECT id FROM ptm_away_probe_orders WHERE idx = 1);
  IF v_frozen_sale <> 25.00 THEN
    RAISE EXCEPTION 'Owner Away preview used mutable order subtotal: %', v_frozen_sale;
  END IF;
END
$guard$;
SELECT 'owner-away-payment-ledger-ok';
ROLLBACK;
`);
  check(
    "Owner Away totals use uncapped payment facts, exclude unpaid orders and net refunds",
    paymentTruth.ok && /owner-away-payment-ledger-ok/.test(paymentTruth.out),
    paymentTruth.ok ? paymentTruth.out : paymentTruth.err,
  );

  // No settings row means there is nothing for SELECT ... FOR UPDATE to lock.
  // The branch advisory lock must still make simultaneous first-time toggles
  // converge instead of letting one request lose a primary-key race.
  const { error: clearSettingsError } = await admin
    .from("branch_operator_settings")
    .delete()
    .eq("branch_id", BRANCH);
  if (clearSettingsError) throw clearSettingsError;
  const firstToggleArgs = {
    p_branch_id: BRANCH,
    p_owner_away: true,
    p_updated_by: ownerProfile.id,
    p_business_date: "2088-06-11",
    p_target: "",
    p_payload: { message: "Concurrent first Owner Away transition" },
    p_now: "2088-06-11T09:00:00Z",
  };
  const [concurrentLeft, concurrentRight] = await Promise.all([
    admin.rpc("set_owner_away_mode_with_digest_v18", firstToggleArgs),
    admin.rpc("set_owner_away_mode_with_digest_v18", firstToggleArgs),
  ]);
  const concurrentStates = [concurrentLeft.data, concurrentRight.data];
  const concurrentDigestId = concurrentStates[0]?.digest_id;
  if (concurrentDigestId) additionalDigestIds.push(concurrentDigestId);
  const { count: concurrentDigestCount } = concurrentDigestId
    ? await admin
      .from("alert_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("id", concurrentDigestId)
    : { count: 0 };
  check(
    "simultaneous first-time Owner Away toggles converge on one state and digest",
    !concurrentLeft.error
      && !concurrentRight.error
      && concurrentStates.every((state) => state?.away_since === "2088-06-11T09:00:00+00:00")
      && concurrentStates[0]?.digest_id === concurrentStates[1]?.digest_id
      && JSON.stringify(concurrentStates.map((state) => state?.changed).sort()) === JSON.stringify([false, true])
      && concurrentDigestCount === 1,
    JSON.stringify({
      leftError: concurrentLeft.error?.message,
      rightError: concurrentRight.error?.message,
      concurrentStates,
      concurrentDigestCount,
    }),
  );

  await admin.from("alert_dispatches").delete().eq("id", blocker.id);
} finally {
  if (awayDigestId) await admin.from("alert_dispatches").delete().eq("id", awayDigestId);
  if (additionalDigestIds.length) await admin.from("alert_dispatches").delete().in("id", additionalDigestIds);
  if (transientDispatchIds.length) await admin.from("alert_dispatches").delete().in("id", transientDispatchIds);
  if (settingsTouched) {
    if (settingsBefore) {
      await admin.from("branch_operator_settings").upsert({ branch_id: BRANCH, ...settingsBefore }, { onConflict: "branch_id" });
    } else {
      await admin.from("branch_operator_settings").delete().eq("branch_id", BRANCH);
    }
  }
  if (ids.length) await admin.from("owner_alerts").delete().in("id", ids);
}

console.log(`\nAlert-dispatch guard: ${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
