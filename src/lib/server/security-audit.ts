import { createClient } from "@supabase/supabase-js";

import type { SecurityReason } from "@/lib/domain/security-events";

// V12.4 — the single, real path for emitting `security_event` audit evidence.
//
// Deliberately edge-safe and dependency-light (no `server-only`, no next/headers,
// no node:crypto) so it works in the Edge middleware AND in Node server actions /
// the staff-context authority layer. It uses the service-role client purely as
// transport to the HARDENED `emit_audit_log` SECURITY DEFINER function:
//   * emit_audit_log remains service_role-only (V12.1) — this does NOT reopen
//     authenticated/anon emission;
//   * service-role calls are SYSTEM emission (actor_id = NULL) and REQUIRE an
//     explicit reason, which we always supply;
//   * emit_audit_log enforces the event-type allowlist, the metadata size cap,
//     and strips secret-like keys defensively.
//
// Callers must pass only safe, non-PII metadata (hashed identity/network values,
// reason codes, route, role, branch_id). This emitter never throws: a security
// audit failure must not break the request it is observing.

export type SecurityEventInput = {
  reason: SecurityReason;
  /** Logical subject: "auth" | "session" | "authority". Defaults to "security". */
  targetType?: string;
  /** A non-PII uuid (e.g. the staff user id) or null. */
  targetId?: string | null;
  branchId?: string | null;
  /** Safe, non-PII fields only. Secret-like keys are also stripped server-side. */
  metadata?: Record<string, unknown>;
};

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Degrade safely when unconfigured (e.g. no Supabase) — never throw.
  if (!url || !serviceKey) {
    return;
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await supabase.rpc("emit_audit_log", {
      p_event_type: "security_event",
      p_target_type: input.targetType ?? "security",
      p_target_id: input.targetId ?? null,
      p_branch_id: input.branchId ?? null,
      p_metadata: input.metadata ?? {},
      p_system_reason: input.reason,
    });
  } catch (error) {
    // Observability of the observer: log without PII, but never break the caller.
    console.error("[security-audit] emit failed", {
      reason: input.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
