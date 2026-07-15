import "server-only";

import {
  ALERT_DISPATCH_LEASE_SECONDS,
  boundDispatchBatch,
  processLeasedAlertDispatches,
  type LeasedAlertDispatch,
} from "@/lib/domain/alert-dispatch";
import {
  CHANNEL_DISABLED,
  OwnerAlertProviderError,
  ownerAlertChannelConfigured,
  ownerDigestInputFromSnapshot,
  resolveOwnerAlertChannel,
  sendOwnerAlertViaTwilio,
  type OwnerDigestSnapshot,
} from "@/lib/domain/owner-alert-channel";
import { buildOwnerDigest } from "@/lib/domain/owner-digest";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export { CHANNEL_DISABLED } from "@/lib/domain/owner-alert-channel";

const IN_FLIGHT_STATUSES = ["pending", "leased", "retry_wait", "delivery_unknown"] as const;

export type OwnerAlertDeliveryHealth = {
  configured: boolean;
  configurationIssue: string | null;
  workerCheckedAt: string | null;
  ownerContact: string | null;
  pendingCount: number;
  deadLetterCount: number;
  latestError: string | null;
};

export function isOwnerAlertProviderConfigured() {
  return ownerAlertChannelConfigured(resolveOwnerAlertChannel(process.env));
}

export async function getOwnerContact(branchId: string): Promise<string | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const { data } = await createSupabaseServiceClient()
    .from("branch_operator_settings")
    .select("owner_contact")
    .eq("branch_id", branchId)
    .maybeSingle<{ owner_contact: string | null }>();
  return data?.owner_contact?.trim() || null;
}

export async function getOwnerAlertDeliveryHealth(branchId: string): Promise<OwnerAlertDeliveryHealth> {
  if (!hasSupabaseServiceEnv()) {
    return {
      configured: false,
      configurationIssue: "Delivery status is unavailable because the live database connection is not configured.",
      workerCheckedAt: null,
      ownerContact: null,
      pendingCount: 0,
      deadLetterCount: 0,
      latestError: null,
    };
  }
  const supabase = createSupabaseServiceClient();
  const [ownerContact, pending, deadLetters, latest, worker] = await Promise.all([
    getOwnerContact(branchId),
    supabase
      .from("alert_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .in("status", [...IN_FLIGHT_STATUSES]),
    supabase
      .from("alert_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .eq("status", "dead_letter"),
    supabase
      .from("alert_dispatches")
      .select("last_error")
      .eq("branch_id", branchId)
      .eq("status", "dead_letter")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ last_error: string | null }>(),
    supabase
      .from("owner_alert_worker_status")
      .select("checked_at,channel_configured,target_configured,last_run_ok,last_error")
      .eq("branch_id", branchId)
      .maybeSingle<{
        checked_at: string;
        channel_configured: boolean;
        target_configured: boolean;
        last_run_ok: boolean;
        last_error: string | null;
      }>(),
  ]);
  const workerStatus = worker.data;
  const checkedAtMs = workerStatus?.checked_at ? Date.parse(workerStatus.checked_at) : Number.NaN;
  const heartbeatFresh = Number.isFinite(checkedAtMs)
    && checkedAtMs >= Date.now() - 20 * 60 * 1000
    && checkedAtMs <= Date.now() + 5 * 60 * 1000;
  let configurationIssue: string | null = null;
  if (!workerStatus) configurationIssue = "The phone-alert worker has not checked in yet.";
  else if (!heartbeatFresh) configurationIssue = "The phone-alert worker has not checked in recently.";
  else if (!workerStatus.last_run_ok) configurationIssue = "The phone-alert worker reports that its latest run failed.";
  else if (!workerStatus.channel_configured) configurationIssue = "The phone-alert worker reports that its delivery channel is not configured.";
  else if (!workerStatus.target_configured || !ownerContact) configurationIssue = "The phone-alert worker reports that no owner phone target is configured.";
  return {
    configured: configurationIssue === null,
    configurationIssue,
    workerCheckedAt: workerStatus?.checked_at ?? null,
    ownerContact,
    pendingCount: pending.count ?? 0,
    deadLetterCount: deadLetters.count ?? 0,
    latestError: latest.data?.last_error ?? workerStatus?.last_error ?? null,
  };
}

export async function composeOwnerDigest(branchId: string, businessDate: string): Promise<string> {
  const { data, error } = await createSupabaseServiceClient().rpc("owner_digest_snapshot_v18", {
    p_branch_id: branchId,
    p_business_date: businessDate,
  });
  if (error || !data) throw new Error(`Could not compose owner digest: ${error?.message ?? "no snapshot"}`);
  return buildOwnerDigest(ownerDigestInputFromSnapshot(data as OwnerDigestSnapshot));
}

export async function enqueueOwnerDigest(input: {
  branchId: string;
  businessDate?: string;
  dispatchKey?: string | null;
}): Promise<{ id: string } | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createSupabaseServiceClient();
  let businessDate = input.businessDate;
  if (!businessDate) {
    const { data, error } = await supabase.rpc("branch_business_date", {
      p_branch_id: input.branchId,
      p_at: new Date().toISOString(),
    });
    if (error || !data) throw new Error(`Could not resolve branch day: ${error?.message ?? "no date"}`);
    businessDate = String(data);
  }
  const [target, message] = await Promise.all([
    getOwnerContact(input.branchId),
    composeOwnerDigest(input.branchId, businessDate),
  ]);
  const { data, error } = await supabase.rpc("enqueue_owner_digest_dispatch_v18", {
    p_branch_id: input.branchId,
    p_business_date: businessDate,
    p_target: target ?? "",
    p_payload: { message, business_date: businessDate },
    p_dispatch_key: input.dispatchKey ?? null,
  });
  if (error || !data) throw new Error(`Could not enqueue owner digest: ${error?.message ?? "no row"}`);
  return { id: String((data as { id: string }).id) };
}

export async function runAlertDispatchSweep(
  limit = 20,
  workerId = `web-sweep:${crypto.randomUUID().slice(0, 8)}`,
): Promise<{ claimed: number; accepted: number; failed: number; skipped: number }> {
  if (!hasSupabaseServiceEnv()) return { claimed: 0, accepted: 0, failed: 0, skipped: 0 };
  const supabase = createSupabaseServiceClient();
  const { error: recoveryError } = await supabase.rpc("recover_expired_alert_dispatch_leases_v18");
  if (recoveryError) throw new Error(`Could not recover expired dispatch leases: ${recoveryError.message}`);
  const { data, error } = await supabase.rpc("lease_alert_dispatches_for_channels_v18", {
    p_worker_id: workerId,
    p_channels: ["twilio_whatsapp"],
    p_limit: boundDispatchBatch(limit),
    p_lease_seconds: ALERT_DISPATCH_LEASE_SECONDS,
  });
  if (error) throw new Error(`Could not lease alert dispatches: ${error.message}`);
  const rows = (data ?? []) as LeasedAlertDispatch[];
  const config = resolveOwnerAlertChannel(process.env);
  const channelReady = ownerAlertChannelConfigured(config);
  return processLeasedAlertDispatches({
    rows,
    channelConfigured: (row) => row.channel === "twilio_whatsapp" && channelReady && Boolean(row.target.trim()),
    disabledReason: CHANNEL_DISABLED,
    send: async (row) => {
      const message = typeof row.payload?.message === "string" ? row.payload.message : "";
      return sendOwnerAlertViaTwilio({
        config,
        target: row.target,
        message: row.kind === "critical_alert" ? `Urgent from PlaiceToMeat\n${message}` : message,
      });
    },
    record: async (dispatchId, result) => {
      const { error: recordError } = await supabase.rpc("record_alert_dispatch_result_v18", {
        p_dispatch_id: dispatchId,
        p_worker_id: workerId,
        p_outcome: result.outcome,
        p_provider_message_id: result.providerMessageId,
        p_provider_status_code: result.providerStatusCode,
        p_error_code: result.errorCode,
        p_error_detail: result.errorDetail,
        p_invalidate_device: result.invalidateDevice,
      });
      if (recordError) throw new Error(`Could not record ${result.outcome} alert dispatch: ${recordError.message}`);
    },
    classifySendError: (sendError) => {
      const providerError = sendError instanceof OwnerAlertProviderError ? sendError : null;
      return {
        message: sendError instanceof Error ? sendError.message : "Provider send failed",
        outcome: providerError?.outcome ?? "ambiguous",
        errorCode: providerError?.errorCode ?? null,
        invalidateDevice: providerError?.invalidateDevice ?? false,
      };
    },
  });
}
