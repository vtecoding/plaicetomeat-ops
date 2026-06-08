import type { SessionStatus } from "./session-envelope";

// V12.4 — canonical reason codes for the `security_event` audit type. These are
// the system_reason values recorded when a security/authority/refusal occurs.
// They are stable identifiers (not user-facing copy) so the audit log is queryable.
export const SECURITY_REASON = {
  LOGIN_FAILED: "login_failed",
  LOGIN_LOCKED_OUT: "login_locked_out",
  SESSION_MISSING: "session_missing",
  SESSION_EXPIRED: "session_expired",
  SESSION_INVALID: "session_invalid",
  SESSION_USER_MISMATCH: "session_user_mismatch",
  AUTHORITY_DENIED_ROLE: "authority_denied_role",
  AUTHORITY_DENIED_BRANCH: "authority_denied_branch",
  AUTHORITY_DENIED_NO_BRANCH: "authority_denied_no_branch",
  UNAUTHORISED_ROUTE: "unauthorised_route",
  LOGOUT_FAILED: "logout_failed",
} as const;

export type SecurityReason = (typeof SECURITY_REASON)[keyof typeof SECURITY_REASON];

/**
 * Map a non-valid staff session evaluation to the security event it should
 * produce. Returns null for a valid session (no event). `detail` carries the
 * sub-reason (idle/absolute/signature/malformed) for investigation without
 * leaking anything sensitive.
 */
export function securityEventForSession(
  status: SessionStatus,
): { reason: SecurityReason; detail?: string } | null {
  if (status.status === "valid") {
    return null;
  }

  if (status.status === "expired") {
    if (status.reason === "missing") {
      return { reason: SECURITY_REASON.SESSION_MISSING };
    }
    return { reason: SECURITY_REASON.SESSION_EXPIRED, detail: status.reason };
  }

  // status === "invalid"
  if (status.reason === "user_mismatch") {
    return { reason: SECURITY_REASON.SESSION_USER_MISMATCH };
  }
  return { reason: SECURITY_REASON.SESSION_INVALID, detail: status.reason };
}
