// V18 B1 interim scheduled dispatcher: scan certificate expiry, enqueue due
// daily digests, recover expired leases, then lease and deliver a bounded
// outbox sweep. The same lease/record contract is shared with the Supabase
// Edge Function dispatcher; this runner remains only until Phase 7 cutover
// (and afterwards for non-urgent reconciliation).
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import alertDispatch from "../src/lib/domain/alert-dispatch.ts";
import ownerAlertChannel from "../src/lib/domain/owner-alert-channel.ts";
import ownerDigest from "../src/lib/domain/owner-digest.ts";

const {
  ALERT_DISPATCH_LEASE_SECONDS,
  boundDispatchBatch,
  fieldProofSucceeded,
  mergeAlertBranchSchedules,
  processLeasedAlertDispatches,
} = alertDispatch;
const {
  CHANNEL_DISABLED,
  OwnerAlertProviderError,
  localBusinessClock,
  ownerAlertChannelConfigured,
  ownerDigestInputFromSnapshot,
  resolveOwnerAlertChannel,
  sendOwnerAlertViaTwilio,
} = ownerAlertChannel;
const { buildOwnerDigest } = ownerDigest;

if (existsSync(new URL("../.env.local", import.meta.url))) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    if (!(key in process.env)) process.env[key] = line.slice(index + 1).trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const channel = resolveOwnerAlertChannel(process.env);
const workerId = `scheduled-worker:${process.env.GITHUB_RUN_ID ?? "local"}:${crypto.randomUUID().slice(0, 8)}`;
let workerSchedules = [];

async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function enqueueDueDigests(now = new Date()) {
  await callRpc("scan_not_opened_by_time_v18", { p_now: now.toISOString() });
  const { data: branches, error: branchError } = await supabase
    .from("branches")
    .select("id,timezone");
  if (branchError) throw new Error(`load branches for certificate scan: ${branchError.message}`);
  const { data: settings, error } = await supabase
    .from("branch_operator_settings")
    .select("branch_id,summary_time,owner_contact");
  if (error) throw new Error(`load digest settings: ${error.message}`);
  let enqueued = 0;

  workerSchedules = mergeAlertBranchSchedules(branches ?? [], settings ?? []);
  for (const schedule of workerSchedules) {
    const clock = localBusinessClock(now, schedule.timezone);
    await callRpc("scan_branch_certificate_expiry_alerts_v18", {
      p_branch_id: schedule.branchId,
      p_as_of: clock.businessDate,
    });
    const [hour = "19", minute = "00"] = schedule.summaryTime.split(":");
    const dueMinute = Number(hour) * 60 + Number(minute);
    if (clock.minuteOfDay < dueMinute) continue;

    const snapshot = await callRpc("owner_digest_snapshot_v18", {
      p_branch_id: schedule.branchId,
      p_business_date: clock.businessDate,
    });
    const message = buildOwnerDigest(ownerDigestInputFromSnapshot(snapshot));
    await callRpc("enqueue_owner_digest_dispatch_v18", {
      p_branch_id: schedule.branchId,
      p_business_date: clock.businessDate,
      p_target: schedule.ownerContact,
      p_payload: { message, business_date: clock.businessDate },
      p_dispatch_key: null,
    });
    enqueued += 1;
  }
  return enqueued;
}

async function sweep() {
  await callRpc("recover_expired_alert_dispatch_leases_v18", {});
  const rows = (await callRpc("lease_alert_dispatches_for_channels_v18", {
    p_worker_id: workerId,
    p_channels: ["twilio_whatsapp"],
    p_limit: boundDispatchBatch(Number(process.env.ALERT_DISPATCH_BATCH_SIZE ?? 20)),
    p_lease_seconds: ALERT_DISPATCH_LEASE_SECONDS,
  })) ?? [];
  const channelReady = ownerAlertChannelConfigured(channel);
  return processLeasedAlertDispatches({
    rows,
    channelConfigured: (row) => row.channel === "twilio_whatsapp" && channelReady && Boolean(row.target.trim()),
    disabledReason: CHANNEL_DISABLED,
    send: async (row) => {
      const message = typeof row.payload?.message === "string" ? row.payload.message : "";
      return sendOwnerAlertViaTwilio({
        config: channel,
        target: row.target,
        message: row.kind === "critical_alert" ? `Urgent from PlaiceToMeat\n${message}` : message,
      });
    },
    record: (dispatchId, result) => callRpc("record_alert_dispatch_result_v18", {
      p_dispatch_id: dispatchId,
      p_worker_id: workerId,
      p_outcome: result.outcome,
      p_provider_message_id: result.providerMessageId,
      p_provider_status_code: result.providerStatusCode,
      p_error_code: result.errorCode,
      p_error_detail: result.errorDetail,
      p_invalidate_device: result.invalidateDevice,
    }).then(() => undefined),
    classifySendError: (error) => {
      const providerError = error instanceof OwnerAlertProviderError ? error : null;
      return {
        message: error instanceof Error ? error.message : "Provider send failed",
        outcome: providerError?.outcome ?? "ambiguous",
        errorCode: providerError?.errorCode ?? null,
        invalidateDevice: providerError?.invalidateDevice ?? false,
      };
    },
    onSkipped: (row) => console.warn(`OWNER_ALERT_DISPATCH_SKIPPED id=${row.id} reason=${CHANNEL_DISABLED}`),
    onFailed: (row, message) => console.error(`OWNER_ALERT_DISPATCH_FAILED id=${row.id} error=${message}`),
  });
}

async function recordWorkerHeartbeat(lastRunOk, totals, error = null) {
  if (workerSchedules.length === 0) return;
  const checkedAt = new Date().toISOString();
  const { error: heartbeatError } = await supabase.from("owner_alert_worker_status").upsert(
    workerSchedules.map((schedule) => ({
      branch_id: schedule.branchId,
      checked_at: checkedAt,
      channel_configured: ownerAlertChannelConfigured(channel),
      target_configured: Boolean(schedule.ownerContact.trim()),
      last_run_ok: lastRunOk,
      last_error: error == null ? null : String(error).slice(0, 1000),
      last_totals: totals ?? {},
      updated_at: checkedAt,
    })),
    { onConflict: "branch_id" },
  );
  if (heartbeatError) throw new Error(`record owner-alert worker heartbeat: ${heartbeatError.message}`);
}

try {
  const digests = await enqueueDueDigests();
  const totals = await sweep();
  await recordWorkerHeartbeat(true, totals);
  console.log(JSON.stringify({ digestCandidates: digests, ...totals }));

  if (process.env.OWNER_ALERT_FIELD_PROOF === "true" && !fieldProofSucceeded(totals)) {
    throw new Error(
      `Field proof requested but only ${totals.accepted} of ${totals.claimed} claimed owner alerts were provider-accepted.`,
    );
  }
} catch (error) {
  try {
    await recordWorkerHeartbeat(false, null, error instanceof Error ? error.message : "Worker failed");
  } catch (heartbeatError) {
    console.error(heartbeatError);
  }
  throw error;
}
