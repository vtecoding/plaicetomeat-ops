"use server";

import { revalidatePath } from "next/cache";

import { alertSpecFor, canManuallyResolveAlert } from "@/lib/domain/alert-registry";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type Result = { ok: true; message: string } | { ok: false; message: string };

async function requireManager() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id } : ctx;
}

function revalidateReconcile() {
  revalidatePath("/admin/reconcile");
  revalidatePath("/admin/today");
  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/away");
}

/**
 * Class A — real reconciliation. Writes the true invoice cost onto the delivery's batch
 * via the controlled RPC (margin/COGS are derived on read, so this is the recompute),
 * then resolves the cost-pending alert.
 */
export async function resolveDeliveryCost(input: {
  alertId: string;
  batchId: string;
  invoiceCost: number;
}): Promise<Result> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };

  const cost = Number(input.invoiceCost);
  if (!Number.isFinite(cost) || cost <= 0) return { ok: false, message: "Enter the invoice cost." };
  const rounded = Math.round(cost * 100) / 100;

  // Cost, lifecycle resolution and both audit facts commit inside one locked DB
  // transaction. A lost response can replay the exact cost; a stale/different
  // value can never overwrite a cost another owner already saved.
  const { error } = await createSupabaseServiceClient().rpc("resolve_delivery_cost_owner_job_v18", {
    p_branch_id: auth.branchId,
    p_actor_id: auth.profileId,
    p_alert_id: input.alertId,
    p_batch_id: input.batchId,
    p_invoice_cost: rounded,
  });
  if (error) {
    if (/already claimed/i.test(error.message)) return { ok: false, message: "Someone else is already doing this job." };
    if (/changed|already resolved|no longer matches/i.test(error.message)) {
      return { ok: false, message: "This delivery job changed. Refresh and check the saved cost." };
    }
    return { ok: false, message: "Could not save the cost. Please try again." };
  }

  revalidateReconcile();
  return { ok: true, message: "Cost added." };
}

/**
 * Class A — review & confirm. The waste reason lives on the append-only movements ledger
 * and cannot be edited in place; the owner reviews it and confirms, which resolves the
 * check. A genuine correction is a separate waste workflow (the card's "Open full details").
 */
export async function confirmWasteReason(input: { alertId: string }): Promise<Result> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };

  const { error } = await createSupabaseServiceClient().rpc("resolve_owner_alert_lifecycle_v18", {
    p_branch_id: auth.branchId,
    p_actor_id: auth.profileId,
    p_alert_id: input.alertId,
    p_expected_kind: "operator_waste_reason_check",
    p_resolution_note: "Waste reason reviewed and confirmed.",
  });
  if (error) {
    if (/already claimed/i.test(error.message)) return { ok: false, message: "Someone else is already doing this job." };
    if (/already resolved/i.test(error.message)) return { ok: false, message: "Already done." };
    return { ok: false, message: "Could not confirm this job. Please try again." };
  }

  revalidateReconcile();
  return { ok: true, message: "Reviewed." };
}

/** Resolve any registry job that has no richer inline transaction. */
export async function resolveOwnerAlert(input: { alertId: string; note: string }): Promise<Result> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };

  const note = input.note.trim().replace(/\s+/g, " ").slice(0, 500);
  if (note.length < 2) return { ok: false, message: "Add a short note saying what you did." };

  const supabase = createSupabaseServiceClient();
  const { data: alert } = await supabase
    .from("owner_alerts")
    .select("kind")
    .eq("id", input.alertId)
    .eq("branch_id", auth.branchId)
    .is("resolved_at", null)
    .maybeSingle<{ kind: string }>();
  if (!alert) return { ok: false, message: "Already done." };
  const spec = alertSpecFor(alert.kind);
  if (spec.action === "inline-cost" || spec.action === "confirm-reason") {
    return { ok: false, message: "Use the job's own action to clear this." };
  }
  if (!canManuallyResolveAlert(alert.kind)) {
    return { ok: false, message: "Complete the linked work. This job will clear automatically." };
  }

  const { error } = await supabase.rpc("resolve_owner_alert_lifecycle_v18", {
    p_branch_id: auth.branchId,
    p_actor_id: auth.profileId,
    p_alert_id: input.alertId,
    p_expected_kind: alert.kind,
    p_resolution_note: note,
  });
  if (error) {
    if (/already claimed/i.test(error.message)) return { ok: false, message: "Someone else is already doing this job." };
    if (/already resolved/i.test(error.message)) return { ok: false, message: "Already done." };
    return { ok: false, message: "Could not clear this job. Please try again." };
  }

  revalidateReconcile();
  return { ok: true, message: "Job cleared." };
}
