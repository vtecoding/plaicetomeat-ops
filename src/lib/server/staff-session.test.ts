import { afterEach, describe, expect, it } from "vitest";

import {
  STAFF_SESSION_ABSOLUTE_TIMEOUT_MS,
  STAFF_SESSION_IDLE_TIMEOUT_MS,
  issueEnvelope,
} from "@/lib/domain/session-envelope";
import {
  evaluateStaffSession,
  hasStaffSessionSecret,
  signEnvelope,
  verifyEnvelope,
} from "@/lib/server/staff-session";

const SECRET = "test-secret-".padEnd(40, "x");
const OTHER_SECRET = "different-secret-".padEnd(40, "y");

describe("hasStaffSessionSecret (graceful config guard)", () => {
  const original = {
    staff: process.env.STAFF_SESSION_SECRET,
    order: process.env.ORDER_ACCESS_SECRET,
  };

  afterEach(() => {
    process.env.STAFF_SESSION_SECRET = original.staff;
    process.env.ORDER_ACCESS_SECRET = original.order;
  });

  it("is false when neither secret is set (the outage condition)", () => {
    delete process.env.STAFF_SESSION_SECRET;
    delete process.env.ORDER_ACCESS_SECRET;
    expect(hasStaffSessionSecret()).toBe(false);
  });

  it("is false when the configured secret is too short", () => {
    delete process.env.ORDER_ACCESS_SECRET;
    process.env.STAFF_SESSION_SECRET = "too-short";
    expect(hasStaffSessionSecret()).toBe(false);
  });

  it("is true with a sufficiently long STAFF_SESSION_SECRET", () => {
    delete process.env.ORDER_ACCESS_SECRET;
    process.env.STAFF_SESSION_SECRET = "x".repeat(32);
    expect(hasStaffSessionSecret()).toBe(true);
  });

  it("falls back to ORDER_ACCESS_SECRET when STAFF_SESSION_SECRET is unset", () => {
    delete process.env.STAFF_SESSION_SECRET;
    process.env.ORDER_ACCESS_SECRET = "y".repeat(40);
    expect(hasStaffSessionSecret()).toBe(true);
  });

  it("never throws regardless of configuration", () => {
    delete process.env.STAFF_SESSION_SECRET;
    delete process.env.ORDER_ACCESS_SECRET;
    expect(() => hasStaffSessionSecret()).not.toThrow();
  });
});

describe("staff session signing", () => {
  it("round-trips a signed envelope", async () => {
    const env = issueEnvelope("user-1", 1_000);
    const token = await signEnvelope(env, SECRET);
    const result = await verifyEnvelope(token, SECRET);
    expect(result).toEqual({ ok: true, envelope: env });
  });

  it("rejects a token signed with a different secret (forged signature)", async () => {
    const token = await signEnvelope(issueEnvelope("user-1", 1_000), OTHER_SECRET);
    expect(await verifyEnvelope(token, SECRET)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a tampered payload", async () => {
    const token = await signEnvelope(issueEnvelope("user-1", 1_000), SECRET);
    const dot = token.lastIndexOf(".");
    // Flip a character in the payload while keeping the original signature.
    const payload = token.slice(0, dot);
    const flipped = (payload[0] === "A" ? "B" : "A") + payload.slice(1);
    const tampered = `${flipped}.${token.slice(dot + 1)}`;
    expect(await verifyEnvelope(tampered, SECRET)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects structurally malformed tokens", async () => {
    expect(await verifyEnvelope(undefined, SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyEnvelope("no-dot-here", SECRET)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("evaluateStaffSession", () => {
  const now = 1_000_000_000;

  it("treats a MISSING cookie as expired (never silently accepted)", async () => {
    expect(await evaluateStaffSession(undefined, "user-1", now, SECRET)).toEqual({
      status: "expired",
      reason: "missing",
    });
  });

  it("treats a forged/tampered cookie as invalid", async () => {
    const token = await signEnvelope(issueEnvelope("user-1", now), OTHER_SECRET);
    expect(await evaluateStaffSession(token, "user-1", now, SECRET)).toEqual({
      status: "invalid",
      reason: "signature",
    });
  });

  it("rejects a valid-but-cross-user envelope", async () => {
    const token = await signEnvelope(issueEnvelope("attacker", now), SECRET);
    expect(await evaluateStaffSession(token, "victim", now, SECRET)).toEqual({
      status: "invalid",
      reason: "user_mismatch",
    });
  });

  it("rejects an idle-expired session", async () => {
    const env = { uid: "user-1", iat: now, seen: now - STAFF_SESSION_IDLE_TIMEOUT_MS - 1 };
    const token = await signEnvelope(env, SECRET);
    expect(await evaluateStaffSession(token, "user-1", now, SECRET)).toEqual({
      status: "expired",
      reason: "idle",
    });
  });

  it("rejects a session past its absolute lifetime", async () => {
    const env = { uid: "user-1", iat: now - STAFF_SESSION_ABSOLUTE_TIMEOUT_MS - 1, seen: now };
    const token = await signEnvelope(env, SECRET);
    expect(await evaluateStaffSession(token, "user-1", now, SECRET)).toEqual({
      status: "expired",
      reason: "absolute",
    });
  });

  it("accepts a fresh, correctly-bound, signed session", async () => {
    const env = issueEnvelope("user-1", now);
    const token = await signEnvelope(env, SECRET);
    expect(await evaluateStaffSession(token, "user-1", now, SECRET)).toEqual({
      status: "valid",
      envelope: env,
    });
  });
});
