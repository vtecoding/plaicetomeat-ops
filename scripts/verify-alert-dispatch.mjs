// V18 B1 (amended) database guard — transactional enqueue, fail-closed alert
// registry, SKIP LOCKED leasing, at-least-once retry of ambiguous outcomes,
// bounded dead-letter, lease recovery, device fan-out/invalidation, manual
// replay, acknowledgement, and the Owner Away digest contract.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";
const PASSWORD = "PlaiceTest123!";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ownerClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let pass = 0, fail = 0;
const ids = [];
const deviceIds = [];
let awayDigestId = null;
const additionalDigestIds = [];
const transientDispatchIds = [];
let settingsTouched = false;
const WORKER = "verify-alert-dispatch:worker-a";
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
  const { data } = await admin.from("alert_dispatches").select("*").eq("alert_id", id).eq("channel", "twilio_whatsapp").single();
  return { alertId: id, dispatch: data };
}
async function leaseOne(dispatchId, worker = WORKER) {
  await admin.from("alert_dispatches").update({ next_attempt_at: "2000-01-01T00:00:00Z" }).eq("id", dispatchId);
  const leased = await rpc("lease_alert_dispatches_v18", { p_worker_id: worker, p_limit: 25, p_lease_seconds: 60 });
  return leased.find((row) => row.id === dispatchId) ?? null;
}
async function recordResult(dispatchId, outcome, extra = {}) {
  return rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: dispatchId,
    p_worker_id: WORKER,
    p_outcome: outcome,
    p_provider_message_id: extra.providerMessageId ?? null,
    p_provider_status_code: extra.providerStatusCode ?? null,
    p_error_code: extra.errorCode ?? null,
    p_error_detail: extra.errorDetail ?? null,
    p_invalidate_device: extra.invalidateDevice ?? false,
  });
}

try {
  // 1. Fail-closed registry.
  const { error: unknownKindError } = await admin.from("owner_alerts").insert({
    branch_id: BRANCH, severity: "warning", kind: "made_up_probe_kind", summary: "must fail", entity_ref: "probe:registry",
  });
  check(
    "an unregistered alert kind fails closed at insert",
    Boolean(unknownKindError) && /UNREGISTERED_ALERT_KIND/.test(unknownKindError?.message ?? ""),
    unknownKindError?.message ?? "no error",
  );

  // 2. Transactional enqueue with a stable dispatch identity.
  const atomic = await createCritical("Dispatch atomicity probe");
  check(
    "critical alert atomically creates pending priority-100 dispatch debt",
    atomic.dispatch?.status === "pending" && atomic.dispatch?.priority === 100,
    JSON.stringify({ status: atomic.dispatch?.status, priority: atomic.dispatch?.priority }),
  );
  check("critical dispatch key is stable", atomic.dispatch?.dispatch_key === `critical-alert:${atomic.alertId}`, atomic.dispatch?.dispatch_key);

  const blockedAlertId = crypto.randomUUID();
  const blockedKey = `critical-alert:${blockedAlertId}`;
  const { data: blocker, error: blockerError } = await admin.from("alert_dispatches").insert({
    branch_id: BRANCH, kind: "daily_digest", channel: "disabled", target: "", status: "pending",
    dispatch_key: blockedKey, payload: { message: "blocker" }, next_attempt_at: new Date().toISOString(),
  }).select("id").single();
  if (blockerError) throw blockerError;
  transientDispatchIds.push(blocker.id);
  const { error: rolledBack } = await admin.from("owner_alerts").insert({
    id: blockedAlertId, branch_id: BRANCH, severity: "critical", kind: "operator_help", summary: "must roll back", entity_ref: `dispatch-probe:${blockedAlertId}`,
  });
  const { count: blockedAlertCount } = await admin.from("owner_alerts").select("id", { count: "exact", head: true }).eq("id", blockedAlertId);
  check(
    "outbox constraint failure rolls back the alert insert",
    Boolean(rolledBack) && blockedAlertCount === 0,
    rolledBack?.message ?? "no error",
  );

  const { error: orphanError } = await admin.from("alert_dispatches").insert({
    branch_id: BRANCH, kind: "critical_alert", alert_id: null, channel: "disabled", target: "", status: "pending",
    dispatch_key: `orphan:${crypto.randomUUID()}`, payload: { message: "orphan" },
  });
  check("critical dispatch cannot exist without its alert", Boolean(orphanError), orphanError?.message ?? "no error");

  // 3. SKIP LOCKED lease exclusivity + attempt record.
  const leasedAtomic = await leaseOne(atomic.dispatch.id);
  const secondLease = psql(String.raw`
BEGIN;
SELECT count(*)
FROM public.lease_alert_dispatches_v18('verify-alert-dispatch:worker-b', 25, 60)
WHERE id = '${atomic.dispatch.id}'::uuid;
ROLLBACK;
`);
  const { data: openAttempt } = await admin
    .from("alert_delivery_attempts")
    .select("attempt_number,worker_id,completed_at,request_fingerprint")
    .eq("dispatch_id", atomic.dispatch.id)
    .eq("attempt_number", 1)
    .single();
  check(
    "leased row is claimed once and opens its physical attempt record",
    Boolean(leasedAtomic) && leasedAtomic.status === "leased"
      && secondLease.ok && secondLease.out.split(/\r?\n/).includes("0")
      && openAttempt?.worker_id === WORKER && openAttempt.completed_at === null
      && Boolean(openAttempt.request_fingerprint),
    secondLease.ok ? JSON.stringify({ leased: leasedAtomic?.status, openAttempt }) : secondLease.err,
  );

  const { error: wrongWorkerError } = await admin.rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: atomic.dispatch.id, p_worker_id: "verify-alert-dispatch:imposter", p_outcome: "accepted",
  });
  check("a worker cannot record a result for a lease it does not hold", Boolean(wrongWorkerError), wrongWorkerError?.message ?? "no error");

  const accepted = await recordResult(atomic.dispatch.id, "accepted", { providerMessageId: "SM-probe-1", providerStatusCode: "201" });
  const { data: acceptedAttempt } = await admin
    .from("alert_delivery_attempts")
    .select("outcome,completed_at,provider_message_id")
    .eq("dispatch_id", atomic.dispatch.id)
    .eq("attempt_number", 1)
    .single();
  check(
    "provider acceptance stamps provider_accepted_at and closes the attempt",
    accepted.status === "accepted" && Boolean(accepted.provider_accepted_at)
      && accepted.provider_message_id === "SM-probe-1" && accepted.lease_owner === null
      && acceptedAttempt?.outcome === "accepted" && Boolean(acceptedAttempt.completed_at),
    JSON.stringify({ status: accepted.status, attempt: acceptedAttempt }),
  );
  const replayAccepted = await recordResult(atomic.dispatch.id, "accepted");
  check("re-recording a terminal dispatch is idempotent", replayAccepted.status === "accepted" && replayAccepted.provider_message_id === "SM-probe-1");

  // 4. Transient failure backs off on the attempt-relative schedule.
  const transient = await createCritical("Transient retry probe");
  await leaseOne(transient.dispatch.id);
  const afterTransient = await recordResult(transient.dispatch.id, "failed_transient", { errorCode: "429", errorDetail: "rate limited" });
  const delaySeconds = (new Date(afterTransient.next_attempt_at).getTime() - Date.now()) / 1000;
  check(
    "transient failure becomes retry_wait with the attempt-2 delay (~15s plus bounded jitter)",
    afterTransient.status === "retry_wait" && delaySeconds > 10 && delaySeconds < 25,
    JSON.stringify({ status: afterTransient.status, delaySeconds: Math.round(delaySeconds) }),
  );

  // 5. Ambiguous outcomes stay retryable under the same dispatch identity.
  const ambiguous = await createCritical("Ambiguous result probe");
  await leaseOne(ambiguous.dispatch.id);
  const afterAmbiguous = await recordResult(ambiguous.dispatch.id, "ambiguous", { errorCode: "TRANSPORT_FAILED", errorDetail: "timeout after send" });
  const releasedAmbiguous = await leaseOne(ambiguous.dispatch.id);
  check(
    "an ambiguous provider result is delivery_unknown and retries with the same dispatch id",
    afterAmbiguous.status === "delivery_unknown"
      && releasedAmbiguous?.id === ambiguous.dispatch.id
      && releasedAmbiguous.attempt_count === 2
      && releasedAmbiguous.dispatch_key === `critical-alert:${ambiguous.alertId}`,
    JSON.stringify({ status: afterAmbiguous.status, attempt: releasedAmbiguous?.attempt_count }),
  );
  await recordResult(ambiguous.dispatch.id, "accepted");

  // 6. Bounded budget dead-letters visibly with full attempt history.
  const bounded = await createCritical("Retry bound probe");
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const leased = await leaseOne(bounded.dispatch.id);
    if (!leased) throw new Error(`bounded probe could not lease attempt ${attempt}`);
    await recordResult(bounded.dispatch.id, "failed_transient", { errorCode: "500", errorDetail: `definite retryable ${attempt}` });
  }
  const { data: deadLetter } = await admin
    .from("alert_dispatches")
    .select("status,attempt_count")
    .eq("id", bounded.dispatch.id)
    .single();
  const { count: attemptHistory } = await admin
    .from("alert_delivery_attempts")
    .select("id", { count: "exact", head: true })
    .eq("dispatch_id", bounded.dispatch.id);
  const { error: exhaustedLeaseError, data: exhaustedLease } = await admin.rpc("lease_alert_dispatches_v18", {
    p_worker_id: WORKER, p_limit: 25, p_lease_seconds: 60,
  });
  check(
    "the bounded budget dead-letters on attempt six and preserves every attempt",
    deadLetter?.status === "dead_letter" && deadLetter.attempt_count === 6 && attemptHistory === 6
      && !exhaustedLeaseError && !(exhaustedLease ?? []).some((row) => row.id === bounded.dispatch.id),
    JSON.stringify({ deadLetter, attemptHistory }),
  );

  // 7. Manual replay re-arms the same dispatch, never a new alert.
  const replayed = await rpc("replay_alert_dispatch_v18", { p_dispatch_id: bounded.dispatch.id });
  const { count: alertCountAfterReplay } = await admin
    .from("owner_alerts").select("id", { count: "exact", head: true }).eq("id", bounded.alertId);
  const replayLease = await leaseOne(bounded.dispatch.id);
  check(
    "manual replay re-arms the same dispatch with a fresh bounded budget",
    replayed.status === "pending" && replayed.attempt_budget === 12 && alertCountAfterReplay === 1
      && replayLease?.attempt_count === 7,
    JSON.stringify({ replayed: { status: replayed.status, budget: replayed.attempt_budget }, replayLease: replayLease?.attempt_count }),
  );
  await recordResult(bounded.dispatch.id, "accepted");

  // 8. Expired leases recover as delivery_unknown, never terminal.
  const abandoned = await createCritical("Lease recovery probe");
  await leaseOne(abandoned.dispatch.id);
  await admin.from("alert_dispatches")
    .update({ lease_expires_at: "2000-01-01T00:00:00Z" })
    .eq("id", abandoned.dispatch.id);
  await rpc("recover_expired_alert_dispatch_leases_v18", {});
  const { data: recovered } = await admin
    .from("alert_dispatches").select("status,lease_owner,last_error_code").eq("id", abandoned.dispatch.id).single();
  const { data: abandonedAttempt } = await admin
    .from("alert_delivery_attempts")
    .select("outcome")
    .eq("dispatch_id", abandoned.dispatch.id)
    .eq("attempt_number", 1)
    .single();
  check(
    "an expired lease recovers as delivery_unknown with a worker_abandoned attempt",
    recovered?.status === "delivery_unknown" && recovered.lease_owner === null
      && recovered.last_error_code === "WORKER_ABANDONED" && abandonedAttempt?.outcome === "worker_abandoned",
    JSON.stringify({ recovered, abandonedAttempt }),
  );
  await leaseOne(abandoned.dispatch.id);
  await recordResult(abandoned.dispatch.id, "accepted");

  // 9. Device fan-out and visible invalidation.
  const { data: ownerProfile } = await admin.from("profiles").select("id").eq("email", "owner@ptm.test").single();
  const installationId = crypto.randomUUID();
  const { data: device, error: deviceError } = await admin.from("owner_notification_devices").insert({
    branch_id: BRANCH, owner_id: ownerProfile.id, installation_id: installationId,
    channel: "web_push", endpoint_ciphertext: "probe-ciphertext", enabled: true,
    verified_at: new Date().toISOString(), device_label: "Probe handset",
  }).select("id").single();
  if (deviceError) throw deviceError;
  deviceIds.push(device.id);
  const fanned = await createCritical("Device fan-out probe");
  const { data: fannedDispatches } = await admin
    .from("alert_dispatches")
    .select("id,channel,device_id,dispatch_key")
    .eq("alert_id", fanned.alertId)
    .order("channel");
  const deviceDispatch = (fannedDispatches ?? []).find((row) => row.device_id === device.id);
  check(
    "a critical alert fans out to the legacy channel plus every verified device",
    (fannedDispatches ?? []).length === 2 && Boolean(deviceDispatch)
      && deviceDispatch.channel === "web_push"
      && deviceDispatch.dispatch_key === `critical-alert:${fanned.alertId}:web_push:${device.id}`,
    JSON.stringify(fannedDispatches),
  );
  await leaseOne(deviceDispatch.id);
  await recordResult(deviceDispatch.id, "rejected_permanent", { errorCode: "410", errorDetail: "subscription gone", invalidateDevice: true });
  const { data: invalidated } = await admin
    .from("owner_notification_devices")
    .select("enabled,invalidated_at,invalidation_reason,consecutive_failures")
    .eq("id", device.id)
    .single();
  const { data: deviceDead } = await admin
    .from("alert_dispatches").select("status").eq("id", deviceDispatch.id).single();
  check(
    "an invalid subscription disables the device visibly instead of deleting it",
    invalidated?.enabled === false && Boolean(invalidated.invalidated_at)
      && invalidated.invalidation_reason === "410" && invalidated.consecutive_failures === 1
      && deviceDead?.status === "dead_letter",
    JSON.stringify({ invalidated, deviceDead }),
  );
  await leaseOne(fanned.dispatch.id);
  await recordResult(fanned.dispatch.id, "accepted");

  // 10. Acknowledgement is a distinct, idempotent owner fact.
  const ackSignIn = await ownerClient.auth.signInWithPassword({ email: "owner@ptm.test", password: PASSWORD });
  if (ackSignIn.error) throw new Error(`owner sign-in: ${ackSignIn.error.message}`);
  const firstAck = await ownerClient.rpc("acknowledge_owner_alert_v18", { p_alert_id: fanned.alertId });
  const secondAck = await ownerClient.rpc("acknowledge_owner_alert_v18", { p_alert_id: fanned.alertId });
  check(
    "owner acknowledgement is recorded once and replays idempotently",
    !firstAck.error && !secondAck.error
      && firstAck.data?.changed === true && secondAck.data?.changed === false
      && firstAck.data?.acknowledged_at === secondAck.data?.acknowledged_at,
    JSON.stringify({ first: firstAck.data, second: secondAck.data, error: firstAck.error?.message ?? secondAck.error?.message }),
  );
  await ownerClient.auth.signOut();

  // 11. Owner Away digest contract (unchanged semantics on the new schema).
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
    dispatch_key: faultKey, payload: { message: "Owner Away fault blocker" }, next_attempt_at: new Date().toISOString(),
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
    .select("dispatch_key,priority")
    .eq("id", awayDigestId)
    .single();
  const awayKey = awayDispatch.dispatch_key;
  const { count: awayDigestCount } = await admin
    .from("alert_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("dispatch_key", awayKey);
  const { count: awayAuditAfter } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "branch_settings_updated")
    .eq("target_type", "branch_operator_settings")
    .eq("target_id", BRANCH);
  check(
    "Owner Away replay preserves away_since, one priority-10 digest and one atomic transition audit",
    firstAway.changed === true && replayAway.changed === false
      && firstAway.away_since === replayAway.away_since && awayDigestCount === 1
      && firstAway.digest_id === replayAway.digest_id && awayDispatch.priority === 10
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
  if (deviceIds.length) await admin.from("owner_notification_devices").delete().in("id", deviceIds);
}

console.log(`\nAlert-dispatch guard: ${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
