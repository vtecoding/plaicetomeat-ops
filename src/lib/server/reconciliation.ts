import "server-only";

import { alertHref, alertSpecFor, type AlertAction, type AlertAutoResolve } from "@/lib/domain/alert-registry";
import { toOwnerDecisionCopy, type OwnerDecisionCopy } from "@/lib/domain/owner-decision";
import { batchIdFromCostRef } from "@/lib/domain/reconciliation";
import { wasteReasonLabel, type WasteReasonChoice } from "@/lib/operator/workflows/waste";
import { emitAuditLog } from "@/lib/server/audit";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ReconcileItem = OwnerDecisionCopy & {
  alertId: string;
  kind: string;
  action: AlertAction;
  autoResolve: AlertAutoResolve;
  title: string;
  summary: string;
  severity: "warning" | "critical";
  createdAt: string;
  seenAt: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  fullHref: string | null;
  // delivery-cost hydration
  batchId: string | null;
  productName: string | null;
  supplierName: string | null;
  receivedDate: string | null;
  quantityKg: number | null;
  currentCost: number | null;
  // waste-reason hydration
  reasonLabel: string | null;
};

export type ReconcileTray = { count: number; unseenCount: number; items: ReconcileItem[] };

const EMPTY: ReconcileTray = { count: 0, unseenCount: 0, items: [] };

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Owner visibility of a cost gap must derive from the batch STATE, not from the
 * success of one alert insert at delivery time. Operator Mode creates delivery
 * batches at cost 0 (batch_number 'OP-…') and raises a cost-pending alert; if that
 * single write failed, the cost-0 batch would be invisible to this tray and COGS
 * would stay quietly wrong. Recreate any missing open alert from the batches
 * themselves before reading the tray.
 */
async function healMissingCostAlerts(supabase: ServiceClient, branchId: string): Promise<void> {
  const { data: batches } = await supabase
    .from("inventory_batches")
    .select("id, product:products!inner(name, inventory_policy)")
    .eq("branch_id", branchId)
    .eq("product.inventory_policy", "kg_batch")
    .eq("invoice_cost", 0)
    .like("batch_number", "OP-%");
  if (!batches || batches.length === 0) return;

  const refs = batches.map((batch) => `${batch.id}:cost`);
  const { data: open } = await supabase
    .from("owner_alerts")
    .select("entity_ref")
    .eq("branch_id", branchId)
    .in("entity_ref", refs)
    .is("resolved_at", null);
  const openRefs = new Set((open ?? []).map((row) => String(row.entity_ref)));

  for (const batch of batches) {
    const ref = `${batch.id}:cost`;
    if (openRefs.has(ref)) continue;

    type NameRow = { name: string | null };
    const productName = first(batch.product as NameRow | NameRow[] | null)?.name ?? "A delivery";
    const { data: ensured } = await supabase.rpc("ensure_delivery_cost_owner_alert_v18", {
      p_branch_id: branchId,
      p_summary: `${productName} has no cost recorded — add the invoice cost.`,
      p_entity_ref: ref,
      p_created_by: null,
    });
    const created = ensured as { id?: string; created?: boolean } | null;

    if (created?.id && created.created) {
      await emitAuditLog({
        eventType: "inventory_reconciliation_issue",
        targetType: "owner_alert",
        targetId: created.id,
        branchId,
        metadata: { kind: "operator_delivery_cost_pending", batchId: batch.id, selfHealed: true },
        systemReason: "reconcile_self_heal",
      });
    }
  }
}

/**
 * The one open owner-jobs backlog for a branch. Every alert is hydrated through
 * the canonical registry; unknown historical kinds receive the safe note-resolve
 * fallback. Reading the tray stamps seen_at but never claims or resolves work.
 */
export async function getReconciliationItems(
  branchId: string,
  options: { markSeen?: boolean } = {},
): Promise<ReconcileTray> {
  if (!hasSupabaseServiceEnv()) return EMPTY;
  const supabase = createSupabaseServiceClient();

  await healMissingCostAlerts(supabase, branchId);

  const { data: alerts } = await supabase
    .from("owner_alerts")
    .select("id, kind, summary, severity, entity_ref, created_at, seen_at, claimed_by, claimed_at")
    .eq("branch_id", branchId)
    .is("resolved_at", null)
    .order("severity", { ascending: true })
    .order("created_at", { ascending: true });

  if (!alerts || alerts.length === 0) return EMPTY;

  const unseenIds = alerts.filter((alert) => !alert.seen_at).map((alert) => String(alert.id));
  if (options.markSeen !== false && unseenIds.length > 0) {
    await supabase
      .from("owner_alerts")
      .update({ seen_at: new Date().toISOString() })
      .eq("branch_id", branchId)
      .in("id", unseenIds)
      .is("seen_at", null);
  }

  const items: ReconcileItem[] = [];
  for (const alert of alerts) {
    const kind = String(alert.kind);
    const spec = alertSpecFor(kind);
    const entityRef = alert.entity_ref == null ? null : String(alert.entity_ref);

    const item: ReconcileItem = {
      ...toOwnerDecisionCopy({
        kind,
        summary: String(alert.summary ?? ""),
        severity: alert.severity === "critical" ? "critical" : "warning",
        action: spec.action,
      }),
      alertId: String(alert.id),
      kind,
      action: spec.action,
      autoResolve: spec.autoResolve,
      title: spec.title,
      summary: String(alert.summary ?? ""),
      severity: alert.severity === "critical" ? "critical" : "warning",
      createdAt: String(alert.created_at),
      seenAt: alert.seen_at ? String(alert.seen_at) : null,
      claimedBy: alert.claimed_by ? String(alert.claimed_by) : null,
      claimedAt: alert.claimed_at ? String(alert.claimed_at) : null,
      fullHref: alertHref(kind, entityRef),
      batchId: null,
      productName: null,
      supplierName: null,
      receivedDate: null,
      quantityKg: null,
      currentCost: null,
      reasonLabel: null,
    };

    if (spec.action === "inline-cost") {
      const batchId = batchIdFromCostRef(entityRef);
      item.batchId = batchId;
      if (batchId) {
        const { data: batch } = await supabase
          .from("inventory_batches")
          .select("received_weight_kg, received_date, invoice_cost, product:products!inner(name, inventory_policy), supplier:suppliers(name)")
          .eq("id", batchId)
          .eq("branch_id", branchId)
          .eq("product.inventory_policy", "kg_batch")
          .maybeSingle();
        if (batch) {
          item.quantityKg = batch.received_weight_kg != null ? Number(batch.received_weight_kg) : null;
          item.receivedDate = batch.received_date ? String(batch.received_date) : null;
          item.currentCost = batch.invoice_cost != null ? Number(batch.invoice_cost) : null;
          type NameRow = { name: string | null };
          item.productName = first(batch.product as NameRow | NameRow[] | null)?.name ?? null;
          item.supplierName = first(batch.supplier as NameRow | NameRow[] | null)?.name ?? null;
        }
      }
    } else if (spec.action === "confirm-reason" && isUuid(entityRef)) {
      const { data: run } = await supabase
          .from("operator_workflow_runs")
          .select("steps")
          .eq("id", entityRef)
          .eq("branch_id", branchId)
          .maybeSingle();
      const steps = (run?.steps ?? {}) as { quantity?: unknown; reason?: unknown };
      item.quantityKg = typeof steps.quantity === "number" ? steps.quantity : null;
      item.reasonLabel = steps.reason ? wasteReasonLabel(steps.reason as WasteReasonChoice) : null;
    }

    items.push(item);
  }

  return { count: items.length, unseenCount: unseenIds.length, items };
}

/** B2 name for new callers; compatibility export above keeps existing imports stable. */
export const getOwnerJobs = getReconciliationItems;

/**
 * Owner-only reader for role-aware shared surfaces. It resolves authority inside
 * the server boundary so a manager/operator render never fetches this payload.
 */
export async function getOwnerJobsForCurrentOwner(
  options: { markSeen?: boolean } = {},
): Promise<ReconcileTray | null> {
  const context = await resolveStaffContext("owner", { branchScoped: true });
  if (!context.ok) return null;
  return getReconciliationItems(context.branchId, options);
}
