// V12.2 — staff session envelope signing & verification.
//
// Deliberately edge-safe and dependency-light: this module is imported by the
// (Edge runtime) middleware, by Node server actions, and by unit tests, so it
// uses only Web Crypto (`crypto.subtle`) and base64url helpers — no node:crypto,
// no next/headers, no "server-only". Cookie I/O is left to the caller because the
// middleware works on Request/Response cookies while server actions use
// next/headers `cookies()`.

import {
  evaluateVerifiedEnvelope,
  isSessionEnvelope,
  type SessionEnvelope,
  type SessionStatus,
} from "@/lib/domain/session-envelope";

export const STAFF_SESSION_COOKIE = "ptm_staff_last_seen";

const MIN_SECRET_LENGTH = 32;
// Dev-only fallback (>= 32 chars). Never used when NODE_ENV === 'production'.
const DEV_FALLBACK_SECRET = "dev-insecure-staff-session-secret-please-set-STAFF_SESSION_SECRET";

let warnedDevSecret = false;

/**
 * Resolve the signing secret. Prefers a dedicated STAFF_SESSION_SECRET, falls
 * back to the shared ORDER_ACCESS_SECRET so a single deployment secret suffices.
 * A missing/short secret in production is a visible failure (no guessable
 * default); dev gets a loud, insecure fallback.
 */
function getSecret(): string {
  const secret = process.env.STAFF_SESSION_SECRET || process.env.ORDER_ACCESS_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `STAFF_SESSION_SECRET (or ORDER_ACCESS_SECRET) must be set with >= ${MIN_SECRET_LENGTH} characters in production.`,
    );
  }
  if (secret && secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`STAFF_SESSION_SECRET is too short (need >= ${MIN_SECRET_LENGTH} characters).`);
  }
  if (!warnedDevSecret) {
    console.warn("[staff-session] STAFF_SESSION_SECRET not set — using INSECURE dev secret.");
    warnedDevSecret = true;
  }
  return DEV_FALLBACK_SECRET;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodePayload(env: SessionEnvelope): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(env)));
}

function decodePayload(payload: string): unknown {
  return JSON.parse(decoder.decode(base64UrlToBytes(payload)));
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

/** Length-aware constant-time string compare (length itself is not secret). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Produce a signed token: `base64url(payload).base64url(hmac)`. */
export async function signEnvelope(env: SessionEnvelope, secret: string = getSecret()): Promise<string> {
  const payload = encodePayload(env);
  const signature = await hmac(payload, secret);
  return `${payload}.${signature}`;
}

type VerifyResult =
  | { ok: true; envelope: SessionEnvelope }
  | { ok: false; reason: "signature" | "malformed" };

/** Verify a token's signature and parse its envelope. Never throws. */
export async function verifyEnvelope(
  token: string | undefined,
  secret: string = getSecret(),
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "malformed" };
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = await hmac(payload, secret);
  if (!timingSafeEqual(signature, expected)) {
    return { ok: false, reason: "signature" };
  }

  try {
    const parsed = decodePayload(payload);
    if (!isSessionEnvelope(parsed)) return { ok: false, reason: "malformed" };
    return { ok: true, envelope: parsed };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/**
 * Full evaluation used by the middleware: a missing cookie is treated as
 * EXPIRED (never silently accepted), a bad signature / tampered payload as
 * INVALID, and a verified envelope then runs the binding + timeout rules.
 */
export async function evaluateStaffSession(
  token: string | undefined,
  expectedUid: string,
  now: number = Date.now(),
  secret: string = getSecret(),
): Promise<SessionStatus> {
  if (!token) return { status: "expired", reason: "missing" };

  const verified = await verifyEnvelope(token, secret);
  if (!verified.ok) {
    return { status: "invalid", reason: verified.reason };
  }

  return evaluateVerifiedEnvelope(verified.envelope, expectedUid, now);
}

// Exported for unit tests of the signing/verification round-trip.
export const __testing = { encodePayload, DEV_FALLBACK_SECRET, MIN_SECRET_LENGTH };
