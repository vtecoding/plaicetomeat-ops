import { describe, expect, it } from "vitest";
import { validatePushPayload } from "./payload-schema";

const payload = { schemaVersion: 1, messageType: "owner_alert", dispatchId: "11111111-1111-4111-8111-111111111111",
  alertId: "33333333-3333-4333-8333-333333333333", alertKind: "inventory_shortfall", severity: "critical",
  title: "Urgent shop alert", body: "Open PTM.", route: "/admin/today", createdAt: "2026-07-15T17:00:00.000Z" };

describe("push payload schema", () => {
  it("accepts the versioned owner-alert payload", () => expect(validatePushPayload(payload)).toEqual(payload));
  it.each([
    [{ ...payload, schemaVersion: 2 }],
    [{ ...payload, dispatchId: undefined }],
    [{ ...payload, route: "https://evil.example" }],
    [{ ...payload, route: "//evil.example" }],
    [{ ...payload, title: "x".repeat(101) }],
    [{ ...payload, body: "x".repeat(241) }],
  ])("rejects malformed or unsafe payloads", (candidate) => expect(() => validatePushPayload(candidate)).toThrow());
});
