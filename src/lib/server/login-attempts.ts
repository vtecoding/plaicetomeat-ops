import "server-only";

import { evaluateLockout, type LoginAttemptRecord } from "@/lib/domain/auth";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const LOOKBACK_LIMIT = 20;

/**
 * `login_attempts` has RLS enabled with no anon/authenticated policies, so it is
 * only reachable through the trusted service client. All access is gated behind
 * `hasSupabaseServiceEnv()` so the app degrades safely when unconfigured.
 */

export async function isLoginLocked(email: string, now = new Date()): Promise<{ locked: boolean; lockedUntil: Date | null }> {
  if (!hasSupabaseServiceEnv()) {
    return { locked: false, lockedUntil: null };
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("login_attempts")
    .select("success,created_at")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(LOOKBACK_LIMIT);

  if (error || !data) {
    return { locked: false, lockedUntil: null };
  }

  const attempts: LoginAttemptRecord[] = data.map((row) => ({
    success: Boolean(row.success),
    createdAt: row.created_at as string,
  }));

  const result = evaluateLockout(attempts, now);

  return { locked: result.locked, lockedUntil: result.lockedUntil };
}

export async function recordLoginAttempt(input: {
  email: string;
  success: boolean;
  ipAddress?: string | null;
  lockedUntil?: Date | null;
}): Promise<void> {
  if (!hasSupabaseServiceEnv()) {
    return;
  }

  const supabase = createSupabaseServiceClient();

  await supabase.from("login_attempts").insert({
    email: input.email,
    success: input.success,
    ip_address: input.ipAddress ?? null,
    locked_until: input.lockedUntil ? input.lockedUntil.toISOString() : null,
  });
}
