import { describe, expect, it } from "vitest";

import {
  STAFF_SESSION_ABSOLUTE_TIMEOUT_MS,
  STAFF_SESSION_IDLE_TIMEOUT_MS,
  evaluateVerifiedEnvelope,
  isSessionEnvelope,
  issueEnvelope,
  slideEnvelope,
} from "./session-envelope";

describe("session envelope shape", () => {
  it("issues an envelope bound to the user at the current time", () => {
    const env = issueEnvelope("user-1", 1_000);
    expect(env).toEqual({ uid: "user-1", iat: 1_000, seen: 1_000 });
  });

  it("slides the activity marker forward but preserves the issue time", () => {
    const env = issueEnvelope("user-1", 1_000);
    const slid = slideEnvelope(env, 5_000);
    expect(slid).toEqual({ uid: "user-1", iat: 1_000, seen: 5_000 });
  });

  it("rejects malformed envelope payloads", () => {
    expect(isSessionEnvelope({ uid: "u", iat: 1, seen: 2 })).toBe(true);
    expect(isSessionEnvelope({ uid: "", iat: 1, seen: 2 })).toBe(false);
    expect(isSessionEnvelope({ uid: "u", iat: "1", seen: 2 })).toBe(false);
    expect(isSessionEnvelope({ uid: "u", iat: 1 })).toBe(false);
    expect(isSessionEnvelope(null)).toBe(false);
    expect(isSessionEnvelope("nope")).toBe(false);
  });
});

describe("evaluateVerifiedEnvelope", () => {
  const now = 1_000_000_000;

  it("accepts a fresh, correctly-bound envelope", () => {
    const env = { uid: "user-1", iat: now - 1_000, seen: now - 1_000 };
    expect(evaluateVerifiedEnvelope(env, "user-1", now)).toEqual({ status: "valid", envelope: env });
  });

  it("rejects a cross-user envelope as INVALID before any timeout verdict", () => {
    // Even though this envelope is also idle-expired, the identity mismatch must win.
    const env = { uid: "attacker", iat: 0, seen: 0 };
    expect(evaluateVerifiedEnvelope(env, "victim", now)).toEqual({
      status: "invalid",
      reason: "user_mismatch",
    });
  });

  it("expires an idle session", () => {
    const env = { uid: "user-1", iat: now, seen: now - STAFF_SESSION_IDLE_TIMEOUT_MS - 1 };
    expect(evaluateVerifiedEnvelope(env, "user-1", now)).toEqual({ status: "expired", reason: "idle" });
  });

  it("expires a session past its absolute lifetime even when recently active", () => {
    const env = { uid: "user-1", iat: now - STAFF_SESSION_ABSOLUTE_TIMEOUT_MS - 1, seen: now };
    expect(evaluateVerifiedEnvelope(env, "user-1", now)).toEqual({ status: "expired", reason: "absolute" });
  });
});
