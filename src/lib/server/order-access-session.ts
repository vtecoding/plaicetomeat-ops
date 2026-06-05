import "server-only";

import { cookies } from "next/headers";

import { decodeGrants, encodeGrants, type Grant } from "@/lib/server/order-access-token";

// V11.1 — signed, HttpOnly order-access session.
//
// Cancellation requires that the caller's session grants access to the target
// order's public_access_id AND matches its public_access_version (spec §6.1).
// The cookie holds a capped list of {id, version} grants the browser has
// legitimately established (at checkout, or via ref+phone lookup), signed with
// HMAC-SHA256 so it cannot be forged client-side.

const COOKIE_NAME = "ptm_order_access";
const COOKIE_PATH = "/order"; // only sent on order routes; never elsewhere
const MAX_GRANTS = 10;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days
const MIN_SECRET_LENGTH = 32; // require >= 32 bytes of secret material
// Dev-only fallback (>= 32 chars). Never used when NODE_ENV === 'production'.
const DEV_FALLBACK_SECRET = "dev-insecure-order-access-secret-please-set-ORDER_ACCESS_SECRET";

let warnedDevSecret = false;

function getSecret(): string {
  const secret = process.env.ORDER_ACCESS_SECRET;
  if (secret && Buffer.byteLength(secret, "utf8") >= MIN_SECRET_LENGTH) return secret;

  // No silent production fallback (spec §6.7): a missing/short secret in
  // production is a visible failure, not a guessable default.
  if (process.env.NODE_ENV === "production") {
    throw new Error(`ORDER_ACCESS_SECRET must be set with >= ${MIN_SECRET_LENGTH} bytes in production.`);
  }
  if (secret && Buffer.byteLength(secret, "utf8") < MIN_SECRET_LENGTH) {
    throw new Error(`ORDER_ACCESS_SECRET is too short (need >= ${MIN_SECRET_LENGTH} bytes).`);
  }
  if (!warnedDevSecret) {
    console.warn("[order-access] ORDER_ACCESS_SECRET not set — using INSECURE dev secret.");
    warnedDevSecret = true;
  }
  return DEV_FALLBACK_SECRET;
}

function encode(grants: Grant[]): string {
  return encodeGrants(grants, getSecret());
}

function decode(token: string | undefined): Grant[] {
  return decodeGrants(token, getSecret());
}

/** Grant the current browser session access to an order at a specific version. */
export async function grantOrderAccess(publicAccessId: string, version: number): Promise<void> {
  const store = await cookies();
  const existing = decode(store.get(COOKIE_NAME)?.value);
  const next = [{ i: publicAccessId, v: version }, ...existing.filter((g) => g.i !== publicAccessId)].slice(0, MAX_GRANTS);
  store.set(COOKIE_NAME, encode(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: MAX_AGE_SECONDS,
  });
}

/** The bound version for an established id, or null if the session has no grant. */
export async function getOrderAccessVersion(publicAccessId: string): Promise<number | null> {
  const store = await cookies();
  const grant = decode(store.get(COOKIE_NAME)?.value).find((g) => g.i === publicAccessId);
  return grant ? grant.v : null;
}

/** True when the current session has legitimately established access to this id. */
export async function hasOrderAccess(publicAccessId: string): Promise<boolean> {
  return (await getOrderAccessVersion(publicAccessId)) !== null;
}

// Exported for unit testing of the signing/verification round-trip.
export const __testing = { encode, decode, COOKIE_NAME, COOKIE_PATH, MIN_SECRET_LENGTH };
