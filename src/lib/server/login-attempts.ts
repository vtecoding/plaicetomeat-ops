import "server-only";

import { evaluateLockout, type LoginAttemptRecord } from "@/lib/domain/auth";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const LOOKBACK_LIMIT = 20;

// Network/IP lockout is deliberately looser than the per-account limit: many
// legitimate staff can share one shop IP (NAT), so we only trip on a clearly
// abusive volume from a single network within the window.
const NETWORK_MAX_FAILED_ATTEMPTS = 20;

/**
 * `login_attempts` has RLS enabled with no anon/authenticated policies, so it is
 * only reachable through the trusted service client. All access is gated behind
 * `hasSupabaseServiceEnv()` so the app degrades safely when unconfigured.
 *
 * Identities are never stored in the clear: the network/IP dimension is persisted
 * (and queried) as a salted hash in the `ip_address` column (V12.2).
 */

async function recentAttemptsBy(
  column: "email" | "ip_address",
  value: string,
): Promise<LoginAttemptRecord[] | null> {
  if (!hasSupabaseServiceEnv()) return null;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("login_attempts")
    .select("success,created_at")
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(LOOKBACK_LIMIT);

  if (error || !data) return null;

  return data.map((row) => ({
    success: Boolean(row.success),
    createdAt: row.created_at as string,
  }));
}

/**
 * Locked when EITHER the account OR the originating network has exceeded its
 * failure budget inside the window. Returns the later unlock time so neither
 * dimension is released early.
 */
export async function isLoginLocked(
  input: { email: string; networkHash?: string | null },
  now = new Date(),
): Promise<{ locked: boolean; lockedUntil: Date | null }> {
  if (!hasSupabaseServiceEnv()) {
    return { locked: false, lockedUntil: null };
  }

  const [byAccount, byNetwork] = await Promise.all([
    recentAttemptsBy("email", input.email),
    input.networkHash ? recentAttemptsBy("ip_address", input.networkHash) : Promise.resolve(null),
  ]);

  const account = byAccount ? evaluateLockout(byAccount, now) : null;
  const network = byNetwork
    ? evaluateLockout(byNetwork, now, { maxAttempts: NETWORK_MAX_FAILED_ATTEMPTS })
    : null;

  const locked = Boolean(account?.locked || network?.locked);

  const unlockTimes = [account?.lockedUntil, network?.lockedUntil]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());

  const lockedUntil = locked && unlockTimes.length > 0 ? new Date(Math.max(...unlockTimes)) : null;

  return { locked, lockedUntil };
}

export async function recordLoginAttempt(input: {
  email: string;
  success: boolean;
  networkHash?: string | null;
  lockedUntil?: Date | null;
}): Promise<void> {
  if (!hasSupabaseServiceEnv()) {
    return;
  }

  const supabase = createSupabaseServiceClient();

  await supabase.from("login_attempts").insert({
    email: input.email,
    success: input.success,
    // Hashed network identity (or null when unavailable) — never a raw IP.
    ip_address: input.networkHash ?? null,
    locked_until: input.lockedUntil ? input.lockedUntil.toISOString() : null,
  });
}
