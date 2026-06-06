import "server-only";

import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

// V11.2 — the single server-only audit emission module.
//
// Audit evidence is system-generated. Clients, public callers, staff and manager
// users cannot insert audit rows directly: the forgeable RLS insert policies were
// dropped and INSERT/UPDATE/DELETE were revoked from anon/authenticated
// (202606051400_v11_2_audit_authenticity.sql). The ONLY ways an audit row appears
// are (a) inside a trusted SECURITY DEFINER business RPC and (b) via this module,
// which calls the fail-closed emit_audit_log helper.
//
// This file is `server-only`: importing it from a client component is a build
// error, so the service-role capability can never reach the browser bundle
// (asserted by audit-imports.test.ts).

// Mirrors the allowlist enforced inside emit_audit_log. Kept in sync so a typo is a
// TypeScript error rather than a runtime rejection.
export const AUDIT_EVENT_TYPES = [
  "order_created",
  "order_status_changed",
  "price_changed",
  "cost_changed",
  "pricing_committed",
  "product_changed",
  "product_availability_changed",
  "branch_settings_updated",
  "inventory_remaining_adjusted",
  "stock_added",
  "stock_corrected",
  "stock_count_recorded",
  "stock_count_line_applied",
  "batch_received",
  "carcass_intake_confirmed",
  "waste_recorded",
  "pickup_window_created",
  "pickup_window_updated",
  "pickup_window_disabled",
  "shop_closure_created",
  "shop_closure_removed",
  "ops_session_started",
  "ops_session_completed",
  "ops_step_recorded",
  "release_deployed",
  "sms_attempt",
  "sms_template_updated",
  "supplier_created",
  "certificate_uploaded",
  "certificate_verified",
  "security_event",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditEmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unavailable" | "rejected"; message?: string };

type EmitInput = {
  eventType: AuditEventType;
  targetType: string;
  targetId?: string | null;
  branchId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Provide ONLY for system/service-role emission (no signed-in actor). Records
   * actor_id = NULL and an explicit reason. emit_audit_log rejects a system reason
   * from an authenticated caller, so this must be left undefined for user actions.
   */
  systemReason?: string;
};

/**
 * Emit an audit record through the trusted SECURITY DEFINER helper.
 *
 * Actor identity is derived server-side from the JWT subject (for authenticated
 * callers) or recorded as system (NULL actor) for service-role calls — it can
 * never be supplied by the caller. Secret-like metadata keys are stripped in SQL.
 *
 * Note: this uses the service-role client purely as transport; the emit_audit_log
 * function itself is the authority and is fail-closed. Because the service client
 * carries no JWT, calls through it are treated as SYSTEM emission and therefore
 * require `systemReason`.
 */
export async function emitAuditLog(input: EmitInput): Promise<AuditEmitResult> {
  if (!hasSupabaseServiceEnv()) {
    return { ok: false, reason: "unavailable" };
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("emit_audit_log", {
    p_event_type: input.eventType,
    p_target_type: input.targetType,
    p_target_id: input.targetId ?? null,
    p_branch_id: input.branchId ?? null,
    p_metadata: input.metadata ?? {},
    p_system_reason: input.systemReason ?? null,
  });

  if (error) {
    console.error("[audit] emit failed", { eventType: input.eventType, error: error.message });
    return { ok: false, reason: "rejected", message: error.message };
  }

  return { ok: true, id: String(data) };
}

/**
 * Convenience wrapper for system/service-role security events (e.g. failed access
 * attempts) that must be investigable without leaking credentials. The caller is
 * responsible for ensuring `metadata` contains no secrets — emit_audit_log also
 * strips secret-like keys defensively.
 */
export async function emitSecurityEvent(
  targetType: string,
  reason: string,
  metadata: Record<string, unknown> = {},
  branchId: string | null = null,
): Promise<AuditEmitResult> {
  return emitAuditLog({
    eventType: "security_event",
    targetType,
    branchId,
    metadata,
    systemReason: reason,
  });
}
