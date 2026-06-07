import { STAFF_SESSION_TIMEOUT_MS } from "./route-access";

// V12.2 — staff session envelope (pure logic).
//
// The staff "activity" cookie is no longer an unsigned plaintext timestamp. Its
// integrity-bearing payload is this envelope: the staff user id it was issued to
// (`uid`), the moment it was first issued (`iat`), and the last time it was seen
// active (`seen`). Signing/verification lives in `@/lib/server/staff-session`
// (Web Crypto, edge-safe); this module owns the shape and the timeout/binding
// rules so they are deterministic and directly testable.

/** Idle (sliding) timeout: a session untouched for this long is expired. */
export const STAFF_SESSION_IDLE_TIMEOUT_MS = STAFF_SESSION_TIMEOUT_MS;

/**
 * Absolute (hard) lifetime: a session older than this is expired even if it has
 * been active continuously. Forces a fresh sign-in once per working day-ish,
 * bounding how long a stolen-but-live cookie stays useful.
 */
export const STAFF_SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export type SessionEnvelope = {
  /** Supabase auth user id this envelope is bound to. */
  uid: string;
  /** Issued-at, epoch ms. Drives the absolute timeout. */
  iat: number;
  /** Last-seen, epoch ms. Drives the idle timeout, slid forward each request. */
  seen: number;
};

export type SessionStatus =
  | { status: "valid"; envelope: SessionEnvelope }
  | { status: "expired"; reason: "missing" | "idle" | "absolute" }
  | { status: "invalid"; reason: "malformed" | "signature" | "user_mismatch" };

/** Runtime guard for a decoded payload before we trust its fields. */
export function isSessionEnvelope(value: unknown): value is SessionEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uid === "string" &&
    v.uid.length > 0 &&
    typeof v.iat === "number" &&
    Number.isFinite(v.iat) &&
    typeof v.seen === "number" &&
    Number.isFinite(v.seen)
  );
}

/** A brand-new envelope for a freshly authenticated user. */
export function issueEnvelope(uid: string, now: number = Date.now()): SessionEnvelope {
  return { uid, iat: now, seen: now };
}

/** Slide the activity marker forward, preserving the original issue time. */
export function slideEnvelope(env: SessionEnvelope, now: number = Date.now()): SessionEnvelope {
  return { uid: env.uid, iat: env.iat, seen: now };
}

/**
 * Apply binding + timeout rules to an envelope whose signature has *already*
 * been verified by the caller. Order matters: user-binding mismatch (a forged or
 * swapped identity) is rejected before any "merely expired" verdict so a
 * cross-user cookie can never be treated as a benign timeout.
 */
export function evaluateVerifiedEnvelope(
  env: SessionEnvelope,
  expectedUid: string,
  now: number = Date.now(),
): SessionStatus {
  if (env.uid !== expectedUid) {
    return { status: "invalid", reason: "user_mismatch" };
  }
  if (now - env.iat > STAFF_SESSION_ABSOLUTE_TIMEOUT_MS) {
    return { status: "expired", reason: "absolute" };
  }
  if (now - env.seen > STAFF_SESSION_IDLE_TIMEOUT_MS) {
    return { status: "expired", reason: "idle" };
  }
  return { status: "valid", envelope: env };
}
