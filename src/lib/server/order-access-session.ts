import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// V11.1 — signed, HttpOnly order-access session.
//
// Cancellation requires that the caller's session grants access to the target
// order's public_access_id (spec §6.1). The cookie holds a capped list of
// access ids the browser has legitimately established (at checkout, or via
// ref+phone lookup), signed with HMAC so it cannot be forged client-side.

const COOKIE_NAME = "ptm_order_access";
const MAX_IDS = 10;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days
const DEV_FALLBACK_SECRET = "dev-insecure-order-access-secret-do-not-use-in-prod";

let warnedDevSecret = false;

function getSecret(): string {
  const secret = process.env.ORDER_ACCESS_SECRET;
  if (secret && secret.length >= 16) return secret;

  // No silent production fallback (spec §6.7): in production a missing secret is
  // a visible failure, not a guessable default.
  if (process.env.NODE_ENV === "production") {
    throw new Error("ORDER_ACCESS_SECRET must be set (>=16 chars) in production.");
  }
  if (!warnedDevSecret) {
    console.warn("[order-access] ORDER_ACCESS_SECRET not set — using INSECURE dev secret.");
    warnedDevSecret = true;
  }
  return DEV_FALLBACK_SECRET;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

type SessionPayload = { ids: string[]; iat: number };

function encode(ids: string[]): string {
  const payload = b64url(JSON.stringify({ ids, iat: Date.now() } satisfies SessionPayload));
  return `${payload}.${sign(payload)}`;
}

function decode(token: string | undefined): string[] {
  if (!token) return [];
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return [];
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, sign(payload))) return [];
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((id) => typeof id === "string");
  } catch {
    return [];
  }
}

/** Grant the current browser session access to an order's public_access_id. */
export async function grantOrderAccess(publicAccessId: string): Promise<void> {
  const store = await cookies();
  const existing = decode(store.get(COOKIE_NAME)?.value);
  const next = [publicAccessId, ...existing.filter((id) => id !== publicAccessId)].slice(0, MAX_IDS);
  store.set(COOKIE_NAME, encode(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** True when the current session has legitimately established access to this id. */
export async function hasOrderAccess(publicAccessId: string): Promise<boolean> {
  const store = await cookies();
  return decode(store.get(COOKIE_NAME)?.value).includes(publicAccessId);
}

// Exported for unit testing of the signing/verification round-trip.
export const __testing = { encode, decode, COOKIE_NAME };
