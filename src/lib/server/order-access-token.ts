import { createHmac, timingSafeEqual } from "node:crypto";

// V11.1 — pure signing/verification for the order-access session token.
// Kept free of next/headers and "server-only" so it is directly unit-testable.
// HMAC-SHA256 over a base64url payload; verification is constant-time.

export type Grant = { i: string; v: number };
type SessionPayload = { g: Grant[]; iat: number };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false; // length is not secret
  return timingSafeEqual(ba, bb);
}

export function encodeGrants(grants: Grant[], secret: string, now = Date.now()): string {
  const payload = b64url(JSON.stringify({ g: grants, iat: now } satisfies SessionPayload));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the grants if the signature verifies, otherwise [] (forged/tampered). */
export function decodeGrants(token: string | undefined, secret: string): Grant[] {
  if (!token) return [];
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return [];
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, sign(payload, secret))) return [];
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!Array.isArray(parsed.g)) return [];
    return parsed.g.filter((x) => x && typeof x.i === "string" && Number.isInteger(x.v));
  } catch {
    return [];
  }
}
