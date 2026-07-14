export const MAX_ALERT_DISPATCH_ATTEMPTS = 5;
export const MAX_ALERT_DISPATCH_BATCH = 25;

export type DispatchEnvelope = {
  id: string;
  channel: string;
  target: string;
  providerIdempotencyKey: string;
  message: string;
};

export type ProviderSendResult = { providerResponse: string | null };
export type ClaimedAlertDispatch = {
  id: string;
  kind: "critical_alert" | "daily_digest";
  channel: string;
  target: string;
  provider_idempotency_key: string;
  payload: Record<string, unknown> | null;
};
export type AlertDispatchResult = {
  status: "sent" | "failed" | "skipped";
  lastError: string | null;
  providerResponse: string | null;
  retryable: boolean;
  ambiguous: boolean;
};
export type AlertDispatchTotals = { claimed: number; sent: number; failed: number; skipped: number };

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

export function dispatchBackoffSeconds(completedAttempts: number): number | null {
  if (completedAttempts >= MAX_ALERT_DISPATCH_ATTEMPTS) return null;
  return Math.min(3600, 30 * 2 ** Math.max(0, completedAttempts - 1));
}

export function boundDispatchBatch(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(MAX_ALERT_DISPATCH_BATCH, Math.trunc(value!)));
}

export function fieldProofSucceeded(totals: { claimed: number; sent: number }): boolean {
  return totals.claimed > 0 && totals.claimed === totals.sent;
}

/**
 * One orchestration contract shared by the scheduled worker and any server-side
 * sweep. The durable send boundary is deliberately outside the provider catch:
 * a database failure before network I/O is not an ambiguous provider outcome,
 * and a database failure after provider acceptance must not be rewritten as a
 * failed send.
 */
export async function processClaimedAlertDispatches(input: {
  rows: ClaimedAlertDispatch[];
  channelConfigured: boolean;
  disabledReason: string;
  begin: (dispatchId: string) => Promise<void>;
  send: (row: ClaimedAlertDispatch) => Promise<ProviderSendResult>;
  record: (dispatchId: string, result: AlertDispatchResult) => Promise<void>;
  classifySendError: (error: unknown) => { message: string; retryable: boolean; ambiguous: boolean };
  onSkipped?: (row: ClaimedAlertDispatch) => void;
  onFailed?: (row: ClaimedAlertDispatch, message: string) => void;
}): Promise<AlertDispatchTotals> {
  const totals: AlertDispatchTotals = { claimed: input.rows.length, sent: 0, failed: 0, skipped: 0 };
  for (const row of input.rows) {
    if (!input.channelConfigured || !row.target.trim()) {
      await input.record(row.id, {
        status: "skipped",
        lastError: input.disabledReason,
        providerResponse: null,
        retryable: false,
        ambiguous: false,
      });
      totals.skipped += 1;
      input.onSkipped?.(row);
      continue;
    }

    await input.begin(row.id);
    let sent: ProviderSendResult;
    try {
      sent = await input.send(row);
    } catch (error) {
      const classified = input.classifySendError(error);
      await input.record(row.id, {
        status: "failed",
        lastError: classified.message.slice(0, 1000),
        providerResponse: null,
        retryable: classified.retryable,
        ambiguous: classified.ambiguous,
      });
      totals.failed += 1;
      input.onFailed?.(row, classified.message);
      continue;
    }

    await input.record(row.id, {
      status: "sent",
      lastError: null,
      providerResponse: sent.providerResponse,
      retryable: false,
      ambiguous: false,
    });
    totals.sent += 1;
  }
  return totals;
}

/**
 * Contract for adapters with documented provider-side idempotency. The current
 * Twilio adapter does not claim this capability; it uses a durable send boundary
 * and terminal-visible ambiguous outcome instead (owner-alert-channel.ts).
 */
export async function deliverWithStableKey(
  envelope: DispatchEnvelope,
  sender: (input: DispatchEnvelope) => Promise<ProviderSendResult>,
  recorder: (result: ProviderSendResult) => Promise<void>,
): Promise<void> {
  const result = await sender(envelope);
  await recorder(result);
}
