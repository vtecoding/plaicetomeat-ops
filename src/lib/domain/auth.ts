import { canAccessStaffPath, type StaffRole } from "./route-access";

export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;
export const LOGIN_ATTEMPT_WINDOW_MINUTES = 15;

/**
 * Where a freshly-authenticated user lands when they did not arrive with an
 * explicit (and authorised) returnTo target.
 */
export function roleLandingPath(role: StaffRole): string {
  return role === "staff" ? "/counter" : "/admin/today";
}

const BACKSLASH = String.fromCharCode(92);

/**
 * Only allow redirects to internal, role-authorised paths. Anything that could
 * be interpreted as an external/protocol-relative URL is rejected so a crafted
 * `?returnTo=` cannot bounce a logged-in user off-site.
 */
export function sanitizeReturnTo(returnTo: string | null | undefined): string | null {
  if (typeof returnTo !== "string") {
    return null;
  }

  const value = returnTo.trim();

  if (value.length === 0 || value.length > 512) {
    return null;
  }

  // Must be an absolute internal path.
  if (!value.startsWith("/")) {
    return null;
  }

  // Reject protocol-relative ("//host") and backslash tricks ("/\host").
  if (value.startsWith("//") || value.startsWith("/" + BACKSLASH)) {
    return null;
  }

  // No embedded scheme, no backslashes, no control chars, no whitespace.
  if (value.includes("://") || value.includes(BACKSLASH)) {
    return null;
  }

  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) {
      return null;
    }
  }

  // Never bounce back to the login page itself.
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) {
    return null;
  }

  return value;
}

/**
 * Resolve the post-login destination: prefer a sanitised returnTo the role can
 * actually reach, otherwise the role's default landing page.
 */
export function resolvePostLoginPath(role: StaffRole, returnTo: string | null | undefined): string {
  const safe = sanitizeReturnTo(returnTo);

  if (safe && canAccessStaffPath(role, safe)) {
    return safe;
  }

  return roleLandingPath(role);
}

export type LoginAttemptRecord = {
  success: boolean;
  createdAt: string | Date;
};

/**
 * Pure lockout calculation over recent attempts (any order).
 * A successful login clears the failure streak; `maxAttempts` consecutive
 * failures inside the window locks the account until the most recent failure
 * plus the lockout duration.
 */
export function evaluateLockout(
  attempts: LoginAttemptRecord[],
  now: Date = new Date(),
  options: {
    maxAttempts?: number;
    windowMinutes?: number;
    lockoutMinutes?: number;
  } = {},
): { locked: boolean; lockedUntil: Date | null; recentFailures: number } {
  const maxAttempts = options.maxAttempts ?? LOGIN_MAX_FAILED_ATTEMPTS;
  const windowMs = (options.windowMinutes ?? LOGIN_ATTEMPT_WINDOW_MINUTES) * 60_000;
  const lockoutMs = (options.lockoutMinutes ?? LOGIN_LOCKOUT_MINUTES) * 60_000;

  const windowStart = now.getTime() - windowMs;

  const sorted = attempts
    .map((attempt) => ({ success: attempt.success, time: new Date(attempt.createdAt).getTime() }))
    .filter((attempt) => Number.isFinite(attempt.time))
    .sort((a, b) => b.time - a.time);

  let recentFailures = 0;
  let lastFailureTime = 0;

  for (const attempt of sorted) {
    if (attempt.success) {
      break;
    }

    if (attempt.time < windowStart) {
      break;
    }

    if (lastFailureTime === 0) {
      lastFailureTime = attempt.time;
    }

    recentFailures += 1;
  }

  if (recentFailures >= maxAttempts && lastFailureTime > 0) {
    const lockedUntil = new Date(lastFailureTime + lockoutMs);

    if (lockedUntil.getTime() > now.getTime()) {
      return { locked: true, lockedUntil, recentFailures };
    }
  }

  return { locked: false, lockedUntil: null, recentFailures };
}
