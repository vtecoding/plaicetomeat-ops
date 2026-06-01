export type CertificateState = "valid" | "expiring_soon" | "expired" | "missing_expiry" | "inactive";
export type ExpiryRisk = "expired" | "expires_today" | "expiring_soon" | "ok";

export function daysUntil(date: string, now = new Date()) {
  const target = new Date(`${date}T00:00:00.000Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

export function getCertificateState(input: {
  certExpiry: string | null;
  active?: boolean | null;
  verifiedAt?: string | null;
  documentUrl?: string | null;
}, now = new Date()): CertificateState {
  if (input.active === false) return "inactive";
  if (!input.certExpiry) return "missing_expiry";

  const days = daysUntil(input.certExpiry, now);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring_soon";
  return "valid";
}

export function certificateStateLabel(state: CertificateState) {
  switch (state) {
    case "valid":
      return "Valid";
    case "expiring_soon":
      return "Expiring soon";
    case "expired":
      return "Expired";
    case "missing_expiry":
      return "Missing expiry";
    case "inactive":
      return "Inactive";
  }
}

export function getExpiryRisk(expiryDate: string, now = new Date()): ExpiryRisk {
  const days = daysUntil(expiryDate, now);
  if (days < 0) return "expired";
  if (days === 0) return "expires_today";
  if (days <= 3) return "expiring_soon";
  return "ok";
}

export function calculateWasteValue(wasteKg: number, costPerKg: number) {
  return Math.round(wasteKg * costPerKg * 100) / 100;
}

export function calculateTrackedRemainingKg(input: {
  receivedKg: number;
  wasteKg?: number;
  manualAdjustmentKg?: number;
}) {
  const remaining = input.receivedKg - (input.wasteKg ?? 0) + (input.manualAdjustmentKg ?? 0);
  return Math.max(0, Math.round(remaining * 1000) / 1000);
}

export function buildAuditEventPayload(input: {
  eventType: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  return {
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {},
  };
}

export function getRealtimeMode(): "websocket" | "polling" | "auto" {
  const value = process.env.REALTIME_MODE;
  if (value === "websocket" || value === "polling" || value === "auto") return value;
  return "auto";
}
