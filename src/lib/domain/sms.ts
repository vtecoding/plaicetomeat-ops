export type SmsStatus = "disabled" | "not_required" | "queued" | "dry_run" | "sent" | "failed";

export type ReadySmsTemplateInput = {
  template: string;
  orderRef: string;
  address: string;
};

export function renderReadySmsTemplate({ template, orderRef, address }: ReadySmsTemplateInput) {
  return template.replaceAll("{order_ref}", orderRef).replaceAll("{address}", address);
}

export function shouldSendReadySms(readySmsSentAt: string | null | undefined) {
  return !readySmsSentAt;
}

/**
 * Decide what the SMS subsystem should do, honestly, given configuration.
 * - No provider configured at all -> "disabled" (we will record an intent but send nothing).
 * - Provider present but dry-run flag on (or a test order) -> "dry_run".
 * - Otherwise -> "queued" (the app will then attempt a real send and record the result).
 */
export type SmsMode = "disabled" | "dry_run" | "live";

export function resolveSmsMode(options: {
  providerConfigured: boolean;
  sendingEnabled: boolean;
  isTestOrder: boolean;
}): SmsMode {
  if (!options.providerConfigured || !options.sendingEnabled) {
    return "disabled";
  }
  if (options.isTestOrder) {
    return "dry_run";
  }
  return "live";
}

/** Redact a phone number for logs/UI: keep the last 3 digits only. */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return "unknown";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 3) return "***";
  return `${"*".repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}

/** Badge state for the counter UI derived from the truthful order.sms_status. */
export function getSmsBadgeState(
  readySmsSentAt: string | null,
  smsFailureReason?: string | null,
  smsStatus?: SmsStatus | null,
): SmsStatus {
  if (smsStatus) {
    return smsStatus;
  }
  // Backwards-compatible fallback for rows written before sms_status existed.
  if (readySmsSentAt) {
    return "sent";
  }
  if (smsFailureReason) {
    return "failed";
  }
  return "not_required";
}

export const SMS_BADGE_LABELS: Record<SmsStatus, string> = {
  disabled: "SMS disabled",
  not_required: "SMS not sent",
  queued: "SMS queued",
  dry_run: "SMS dry-run",
  sent: "SMS sent",
  failed: "SMS failed",
};
