export const MAX_ALERT_DISPATCH_ATTEMPTS = 6;
export const MAX_ALERT_DISPATCH_BATCH = 25;
export const ALERT_DISPATCH_LEASE_SECONDS = 60;

/** Delay in seconds before attempt N (attempt-relative, per the B1 redesign).
 * The dispatcher wakes every 30 seconds, so a scheduled retry actually runs on
 * the first sweep at or after next_attempt_at — tests assert the schedule, not
 * a wall-clock promise. */
export const ALERT_DISPATCH_RETRY_DELAY_SECONDS = [0, 15, 30, 60, 120, 240] as const;

export type AlertDispatchOutcome =
  | "accepted"
  | "skipped"
  | "rejected_permanent"
  | "failed_transient"
  | "ambiguous";

export type ProviderSendResult = {
  providerMessageId: string | null;
  providerStatusCode: string | null;
};

export type LeasedAlertDispatch = {
  id: string;
  kind: "critical_alert" | "daily_digest";
  channel: string;
  device_id: string | null;
  target: string;
  dispatch_key: string;
  priority: number;
  attempt_count: number;
  payload: Record<string, unknown> | null;
};

export type AlertDispatchResultRecord = {
  outcome: AlertDispatchOutcome;
  providerMessageId: string | null;
  providerStatusCode: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  invalidateDevice: boolean;
};

export type AlertDispatchTotals = {
  claimed: number;
  accepted: number;
  failed: number;
  skipped: number;
};

export type AlertBranchRow = { id: string; timezone: string | null };
export type AlertBranchSettingRow = {
  branch_id: string;
  summary_time: string | null;
  owner_contact: string | null;
};
export type AlertBranchSchedule = {
  branchId: string;
  timezone: string;
  summaryTime: string;
  ownerContact: string;
};

/**
 * Branch settings are optional legacy state. Scheduling is branch-owned, so a
 * branch without a row must still receive the default digest schedule and the
 * certificate scan; toggling Owner Away is not a prerequisite for either.
 */
export function mergeAlertBranchSchedules(
  branches: AlertBranchRow[],
  settings: AlertBranchSettingRow[],
): AlertBranchSchedule[] {
  const settingsByBranch = new Map(settings.map((setting) => [setting.branch_id, setting]));
  return branches.map((branch) => {
    const setting = settingsByBranch.get(branch.id);
    return {
      branchId: branch.id,
      timezone: branch.timezone ?? "Europe/London",
      summaryTime: setting?.summary_time ?? "19:00",
      ownerContact: setting?.owner_contact ?? "",
    };
  });
}

/** Mirror of alert_dispatch_retry_delay_seconds in SQL: the delay scheduled
 * before attempt `nextAttempt`, or null once the bounded budget is exhausted. */
export function dispatchRetryDelaySeconds(nextAttempt: number): number | null {
  if (!Number.isInteger(nextAttempt) || nextAttempt < 1) return null;
  if (nextAttempt > MAX_ALERT_DISPATCH_ATTEMPTS) return null;
  return ALERT_DISPATCH_RETRY_DELAY_SECONDS[nextAttempt - 1];
}

export function boundDispatchBatch(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(MAX_ALERT_DISPATCH_BATCH, Math.trunc(value!)));
}

export function fieldProofSucceeded(totals: { claimed: number; accepted: number }): boolean {
  return totals.claimed > 0 && totals.claimed === totals.accepted;
}

/**
 * One orchestration contract shared by every dispatcher runtime (the interim
 * scheduled worker and the Edge Function sweep). Rows arrive already leased —
 * the lease opened the physical attempt record — so the only work here is
 * send, classify and record.
 *
 * At-least-once boundary: when recording an acceptance fails, the error
 * propagates and the row stays leased. The lease expires into delivery_unknown
 * and the dispatch retries under the same identity; the receiving client
 * deduplicates on the dispatch id. Provider acceptance is never rewritten as a
 * failed send.
 */
export async function processLeasedAlertDispatches(input: {
  rows: LeasedAlertDispatch[];
  channelConfigured: (row: LeasedAlertDispatch) => boolean;
  disabledReason: string;
  send: (row: LeasedAlertDispatch) => Promise<ProviderSendResult>;
  record: (dispatchId: string, result: AlertDispatchResultRecord) => Promise<void>;
  classifySendError: (error: unknown) => {
    message: string;
    outcome: Exclude<AlertDispatchOutcome, "accepted" | "skipped">;
    errorCode: string | null;
    invalidateDevice: boolean;
  };
  onSkipped?: (row: LeasedAlertDispatch) => void;
  onFailed?: (row: LeasedAlertDispatch, message: string) => void;
}): Promise<AlertDispatchTotals> {
  const totals: AlertDispatchTotals = { claimed: input.rows.length, accepted: 0, failed: 0, skipped: 0 };
  for (const row of input.rows) {
    if (!input.channelConfigured(row)) {
      await input.record(row.id, {
        outcome: "skipped",
        providerMessageId: null,
        providerStatusCode: null,
        errorCode: input.disabledReason,
        errorDetail: null,
        invalidateDevice: false,
      });
      totals.skipped += 1;
      input.onSkipped?.(row);
      continue;
    }

    let sent: ProviderSendResult;
    try {
      sent = await input.send(row);
    } catch (error) {
      const classified = input.classifySendError(error);
      await input.record(row.id, {
        outcome: classified.outcome,
        providerMessageId: null,
        providerStatusCode: null,
        errorCode: classified.errorCode,
        errorDetail: classified.message.slice(0, 1000),
        invalidateDevice: classified.invalidateDevice,
      });
      totals.failed += 1;
      input.onFailed?.(row, classified.message);
      continue;
    }

    await input.record(row.id, {
      outcome: "accepted",
      providerMessageId: sent.providerMessageId,
      providerStatusCode: sent.providerStatusCode,
      errorCode: null,
      errorDetail: null,
      invalidateDevice: false,
    });
    totals.accepted += 1;
  }
  return totals;
}
