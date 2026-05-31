export type CertificateState = "valid" | "expiring_soon" | "expired" | "missing" | "unverified";

export function daysUntil(date: string, now = new Date()) {
  const target = new Date(`${date}T00:00:00.000Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

export function getCertificateState(input: {
  certExpiry: string | null;
  verifiedAt: string | null;
  documentUrl?: string | null;
}, now = new Date()): CertificateState {
  if (!input.certExpiry) return "missing";
  if (!input.verifiedAt) return "unverified";

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
    case "unverified":
      return "Missing verification";
    case "missing":
      return "Missing verification";
  }
}

export function getRealtimeMode(): "websocket" | "polling" | "auto" {
  const value = process.env.REALTIME_MODE;
  if (value === "websocket" || value === "polling" || value === "auto") return value;
  return "auto";
}
