export const PUSH_PAYLOAD_SCHEMA_VERSION = 1 as const;
export const MAX_PUSH_PAYLOAD_BYTES = 3_500;

export type OwnerAlertPushPayload = {
  schemaVersion: 1;
  messageType: "owner_alert";
  dispatchId: string;
  alertId: string;
  alertKind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  route: string;
  createdAt: string;
};

export type DeviceVerificationPushPayload = {
  schemaVersion: 1;
  messageType: "device_verification";
  dispatchId: string;
  challengeId: string;
  title: string;
  body: string;
  route: string;
  createdAt: string;
};

export type PtmPushPayload = OwnerAlertPushPayload | DeviceVerificationPushPayload;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSafePtmRoute(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && value.length <= 300;
}
export function validatePushPayload(value: unknown): PtmPushPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Push payload must be an object.");
  const p = value as Record<string, unknown>;
  if (p.schemaVersion !== PUSH_PAYLOAD_SCHEMA_VERSION) throw new Error("Unsupported push payload schema version.");
  if (p.messageType !== "owner_alert" && p.messageType !== "device_verification") {
    throw new Error("Unsupported push message type.");
  }
  if (typeof p.dispatchId !== "string" || !UUID.test(p.dispatchId)) throw new Error("Push dispatchId is invalid.");
  if (!isSafePtmRoute(p.route)) throw new Error("Push route must be PTM-relative.");
  if (typeof p.title !== "string" || !p.title.trim() || p.title.length > 100) throw new Error("Push title is invalid.");
  if (typeof p.body !== "string" || p.body.length > 240) throw new Error("Push body is invalid.");
  if (typeof p.createdAt !== "string" || !Number.isFinite(Date.parse(p.createdAt))) throw new Error("Push createdAt is invalid.");
  if (p.messageType === "owner_alert") {
    if (typeof p.alertId !== "string" || !UUID.test(p.alertId)) throw new Error("Push alertId is invalid.");
    if (typeof p.alertKind !== "string" || !p.alertKind || p.alertKind.length > 80) throw new Error("Push alertKind is invalid.");
    if (!(["info", "warning", "critical"] as unknown[]).includes(p.severity)) throw new Error("Push severity is invalid.");
  } else if (typeof p.challengeId !== "string" || !UUID.test(p.challengeId)) {
    throw new Error("Push challengeId is invalid.");
  }
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error("Push payload is too large.");
  }
  return p as PtmPushPayload;
}
