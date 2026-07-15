import { isSafePtmRoute, validatePushPayload, type PtmPushPayload } from "./payload-schema";

export type DedupeRecord = { dispatchId: string; firstSeenAt: number; lastSeenAt: number; schemaVersion: number };

export function acceptPushForDisplay(value: unknown, records: DedupeRecord[], now: number): {
  payload: PtmPushPayload; duplicate: boolean; records: DedupeRecord[];
} {
  const payload = validatePushPayload(value);
  const existing = records.find((record) => record.dispatchId === payload.dispatchId);
  const updated = [
    { dispatchId: payload.dispatchId, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now, schemaVersion: payload.schemaVersion },
    ...records.filter((record) => record.dispatchId !== payload.dispatchId && record.lastSeenAt >= now - 7 * 24 * 60 * 60 * 1000),
  ].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 500);
  return { payload, duplicate: Boolean(existing), records: updated };
}
export function notificationClickUrl(origin: string, route: unknown, dispatchId: string): string {
  if (!isSafePtmRoute(route) || !/^[0-9a-f-]{36}$/i.test(dispatchId)) throw new Error("Unsafe notification click target.");
  const url = new URL(route, origin); url.searchParams.set("notification", dispatchId); return url.href;
}
