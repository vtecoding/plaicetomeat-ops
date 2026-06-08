import { describe, expect, it } from "vitest";

import { SECURITY_REASON, securityEventForSession } from "./security-events";
import type { SessionEnvelope } from "./session-envelope";

const env: SessionEnvelope = { uid: "u", iat: 1, seen: 1 };

describe("securityEventForSession", () => {
  it("emits nothing for a valid session", () => {
    expect(securityEventForSession({ status: "valid", envelope: env })).toBeNull();
  });

  it("maps a missing session to session_missing", () => {
    expect(securityEventForSession({ status: "expired", reason: "missing" })).toEqual({
      reason: SECURITY_REASON.SESSION_MISSING,
    });
  });

  it("maps idle/absolute timeouts to session_expired with detail", () => {
    expect(securityEventForSession({ status: "expired", reason: "idle" })).toEqual({
      reason: SECURITY_REASON.SESSION_EXPIRED,
      detail: "idle",
    });
    expect(securityEventForSession({ status: "expired", reason: "absolute" })).toEqual({
      reason: SECURITY_REASON.SESSION_EXPIRED,
      detail: "absolute",
    });
  });

  it("maps a tampered/forged envelope to session_invalid with detail", () => {
    expect(securityEventForSession({ status: "invalid", reason: "signature" })).toEqual({
      reason: SECURITY_REASON.SESSION_INVALID,
      detail: "signature",
    });
    expect(securityEventForSession({ status: "invalid", reason: "malformed" })).toEqual({
      reason: SECURITY_REASON.SESSION_INVALID,
      detail: "malformed",
    });
  });

  it("maps a cross-user envelope to session_user_mismatch", () => {
    expect(securityEventForSession({ status: "invalid", reason: "user_mismatch" })).toEqual({
      reason: SECURITY_REASON.SESSION_USER_MISMATCH,
    });
  });
});
