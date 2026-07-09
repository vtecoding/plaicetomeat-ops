"use server";

import { revalidatePath } from "next/cache";

import { emitAuditLog } from "@/lib/server/audit";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient, createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

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
}

/**
 * Mark a reconciliation alert resolved. The alert ROW is preserved (resolved_at stamped,
 * never deleted) and the resolution is audited, so the trail stays intact. Scoped to an
 * OPEN alert of this branch — it can never resolve someone else's or a critical alert that
 * isn't in the tray's query.
 */
async function resolveAlert(branchId: string, alertId: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("owner_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("branch_id", branchId)
    .is("resolved_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  return Boolean(data?.id);
}

/** Undo a claim when the follow-on write fails, so the item returns to the tray. */
async function reopenAlert(branchId: string, alertId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  await supabase.from("owner_alerts").update({ resolved_at: null }).eq("id", alertId).eq("branch_id", branchId);
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

  // Claim the alert FIRST (compare-and-swap on resolved_at). If it was already
  // reconciled since the tray loaded — e.g. someone else added the cost — stop here and
  // never silently overwrite. Same stale-update protection as the stock-count path.
  const claimed = await resolveAlert(auth.branchId, input.alertId);
  if (!claimed) return { ok: false, message: "This was already reconciled." };

  // Only now write the cost, through the SECURITY DEFINER RPC under the manager's own JWT
  // (auth.uid()) — the truth-table lock forbids a direct write. If the write fails, undo
  // the claim so the item returns to the tray rather than vanishing with no cost saved.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_delivery_cost", {
    p_batch_id: input.batchId,
    p_invoice_cost: rounded,
  });
  if (error) {
    await reopenAlert(auth.branchId, input.alertId);
    return { ok: false, message: "Could not save the cost. Please try again." };
  }

  await emitAuditLog({
    eventType: "inventory_reconciliation_issue",
    targetType: "owner_alert",
    targetId: input.alertId,
    branchId: auth.branchId,
    metadata: { resolved: true, kind: "operator_delivery_cost_pending", batchId: input.batchId, invoiceCost: rounded },
    systemReason: "owner_reconcile",
  });

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

  const ok = await resolveAlert(auth.branchId, input.alertId);
  if (!ok) return { ok: false, message: "Already done." };

  await emitAuditLog({
    eventType: "inventory_reconciliation_issue",
    targetType: "owner_alert",
    targetId: input.alertId,
    branchId: auth.branchId,
    metadata: { resolved: true, kind: "operator_waste_reason_check", reviewed: true },
    systemReason: "owner_reconcile",
  });

  revalidateReconcile();
  return { ok: true, message: "Reviewed." };
}
