import "server-only";

import { redactPhone, renderReadySmsTemplate, resolveSmsMode, type SmsStatus } from "@/lib/domain/sms";
import { getBranchSettings, getPublicBranch } from "@/lib/server/catalog";
import type { Order } from "@/lib/domain/types";

export type SmsSendOutcome = {
  status: SmsStatus;
  failureReason: string | null;
  providerResponse: string | null;
  messagePreview: string;
  recipientRedacted: string;
  templateKey: string;
};

/** True when a real SMS provider is configured via env. */
export function isSmsProviderConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
  );
}

/** Master kill-switch: SMS sending only happens when explicitly enabled. Default OFF. */
export function isSmsSendingEnabled(): boolean {
  return process.env.SMS_SENDING_ENABLED === "true";
}

/**
 * Orchestrate a "ready" SMS for an order, honestly. This NEVER sends a real
 * message unless a provider is configured AND sending is explicitly enabled AND
 * the order is not a test order. In every other case it computes the truthful
 * status (disabled / dry_run) and returns it for recording — sending nothing.
 *
 * The actual provider call is deliberately stubbed: wiring a live Twilio client
 * is a deployment concern. Today, "live" mode without a real client returns a
 * failed outcome rather than pretending success.
 */
export async function buildReadySmsOutcome(order: Order): Promise<SmsSendOutcome> {
  const branch = await getPublicBranch();
  const settings = await getBranchSettings(order.branchId);
  const message = renderReadySmsTemplate({
    template: settings.smsReadyTemplate,
    orderRef: order.orderRef,
    address: branch.address,
  });

  const base = {
    templateKey: "ready",
    recipientRedacted: redactPhone(order.customerPhone),
    messagePreview: message,
  };

  const mode = resolveSmsMode({
    providerConfigured: isSmsProviderConfigured(),
    sendingEnabled: isSmsSendingEnabled(),
    isTestOrder: Boolean(order.isTest),
  });

  if (mode === "disabled") {
    return { ...base, status: "disabled", failureReason: null, providerResponse: null };
  }

  if (mode === "dry_run") {
    return { ...base, status: "dry_run", failureReason: null, providerResponse: "dry-run: no message sent" };
  }

  // mode === "live": a real provider client would be invoked here. Until one is
  // wired up we record an honest failure rather than a fake success.
  return {
    ...base,
    status: "failed",
    failureReason: "Live SMS provider is not wired up in this build.",
    providerResponse: null,
  };
}
