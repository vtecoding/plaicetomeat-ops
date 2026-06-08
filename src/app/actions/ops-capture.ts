"use server";

import { revalidatePath } from "next/cache";

import type { OpsStepState } from "@/lib/ops-capture/types";
import { log } from "@/lib/server/observability/log";
import { incrementMetric } from "@/lib/server/observability/metrics";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

// Plain-English error fragments the RPCs raise that are safe to surface verbatim.
const SAFE_PATTERNS = [
  "Not authorised",
  "Not authenticated",
  "Unknown checklist type",
  "Checklist not found",
  "Checklist step is required",
  "Unknown checklist step",
  "Invalid checklist step state",
  "Invalid checklist evidence payload",
  "Invalid checklist evidence value",
  "Checklist evidence value is out of range",
  "Confirmation checklist steps cannot carry evidence values",
  "Skipped checklist steps cannot carry evidence values",
  "Checklist cannot be completed without evidence",
  "Checklist is incomplete",
  "Checklist definition is not configured",
  "This checklist is already finished",
  "This checklist can no longer be completed",
  "This checklist is not a stock count",
  "This stock count is already finished",
  "This stock count line is already applied",
  "Stock count line not found",
  "Stock item not found",
  "STALE_STOCK_COUNT",
  "Counted weight cannot be negative",
  "Stock left cannot exceed the actual weight received",
  "Stock correction did not change the weight",
];

function safeMessage(raw: string | undefined, fallback: string) {
  if (raw && SAFE_PATTERNS.some((pattern) => raw.includes(pattern))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

async function requireManager(): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await resolveStaffContext("manager");
  return ctx.ok ? { ok: true } : { ok: false, message: ctx.message };
}

function revalidateOps() {
  revalidatePath("/admin/today");
  revalidatePath("/admin/open");
  revalidatePath("/admin/close");
}

export async function startOrResumeChecklist(input: {
  branchId: string;
  kind: "opening" | "closing" | "stock_count";
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ops_start_or_resume_session", {
    p_branch_id: input.branchId,
    p_kind: input.kind,
    p_source: input.kind,
  });
  if (error) return { ok: false, message: safeMessage(error.message, "Could not start this checklist.") };
  return { ok: true, message: "Checklist ready.", id: String(data) };
}

export async function recordChecklistStep(input: {
  sessionId: string;
  stepKey: string;
  state: OpsStepState;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ops_record_step", {
    p_session_id: input.sessionId,
    p_step_key: input.stepKey,
    p_state: input.state,
    p_payload: input.payload ?? {},
    p_source: "checklist",
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) return { ok: false, message: safeMessage(error.message, "Could not save this step.") };
  revalidateOps();
  return { ok: true, message: "Saved.", id: String(data) };
}

export async function completeChecklist(input: { sessionId: string }): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ops_complete_session", {
    p_session_id: input.sessionId,
    p_source: "checklist",
  });
  if (error) {
    incrementMetric("checklist_completion_failure");
    log("OPS_CAPTURE", "warn", "checklist completion failed", { error: error.message });
    return { ok: false, message: safeMessage(error.message, "Could not finish this checklist.") };
  }
  revalidateOps();
  return { ok: true, message: "All done.", id: String(data) };
}

export async function recordStockCountLine(input: {
  sessionId: string;
  batchId: string;
  countedWeightKg: number;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ops_record_stock_count_line", {
    p_session_id: input.sessionId,
    p_batch_id: input.batchId,
    p_counted_weight_kg: input.countedWeightKg,
  });
  if (error) return { ok: false, message: safeMessage(error.message, "Could not record this count.") };
  return { ok: true, message: "Count recorded.", id: String(data) };
}

export async function applyStockCountLine(input: {
  sessionId: string;
  lineId: string;
  reason?: string;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ops_apply_stock_count_line", {
    p_session_id: input.sessionId,
    p_line_id: input.lineId,
    p_reason: input.reason ?? null,
  });
  if (error) {
    if (error.message.includes("STALE_STOCK_COUNT")) {
      incrementMetric("inventory_stale_rejection");
      log("INVENTORY", "warn", "stale stock-count apply rejected", { sessionId: input.sessionId });
    }
    return { ok: false, message: safeMessage(error.message, "Could not apply this count.") };
  }
  revalidateOps();
  return { ok: true, message: "Stock updated.", id: String(data) };
}
