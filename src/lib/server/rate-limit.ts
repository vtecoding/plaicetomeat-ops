import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { createSupabasePublicClient, hasSupabasePublicEnv } from "@/lib/supabase/server";

// V11.1 — bounded rate limiting for public endpoints (spec §8.1.3).
//
// Identities passed to the database are always hashed: no plaintext phone, email
// or raw IP is stored in the rate-limit table or logs (spec §6.1, §9.1).

const SALT = process.env.ORDER_ACCESS_SECRET ?? "ptm-rate-limit-salt";

export type RateBucket = "public_status" | "public_establish" | "public_cancel" | "checkout";

export type RateLimitConfig = { bucket: RateBucket; max: number; windowSeconds: number };

// Conservative defaults for a single small shop; tune via these constants only.
export const RATE_LIMITS: Record<RateBucket, RateLimitConfig> = {
  public_status: { bucket: "public_status", max: 60, windowSeconds: 60 },
  public_establish: { bucket: "public_establish", max: 8, windowSeconds: 300 },
  public_cancel: { bucket: "public_cancel", max: 10, windowSeconds: 300 },
  checkout: { bucket: "checkout", max: 12, windowSeconds: 300 },
};

export function hashIdentity(...parts: Array<string | null | undefined>): string {
  return createHash("sha256").update(SALT + "|" + parts.map((p) => p ?? "").join("|")).digest("hex");
}

/** Best-effort client network signal, hashed. Never returns a raw IP. */
export async function clientNetworkHash(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return hashIdentity("ip", ip);
}

export type RateLimitResult = { allowed: boolean; degraded: boolean };

/**
 * Returns { allowed } for the given bucket+identity. On rate-limit storage
 * failure we fail OPEN but flag `degraded` and emit an alert-level log, so a
 * throttle outage cannot silently lock out real customers (spec §11.2) while
 * still surfacing the incident.
 */
export async function checkRateLimit(config: RateBucket, identity: string): Promise<RateLimitResult> {
  const cfg = RATE_LIMITS[config];
  if (!hasSupabasePublicEnv()) {
    return { allowed: true, degraded: true };
  }
  try {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_bucket: cfg.bucket,
      p_identity: identity,
      p_max: cfg.max,
      p_window_seconds: cfg.windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] ALERT storage error — failing open", { bucket: cfg.bucket, error: error.message });
      return { allowed: true, degraded: true };
    }
    return { allowed: data === true, degraded: false };
  } catch (e) {
    console.error("[rate-limit] ALERT unexpected error — failing open", {
      bucket: cfg.bucket,
      error: e instanceof Error ? e.message : String(e),
    });
    return { allowed: true, degraded: true };
  }
}
