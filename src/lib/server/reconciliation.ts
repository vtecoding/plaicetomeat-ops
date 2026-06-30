import "server-only";

import { batchIdFromCostRef, RECONCILE_KIND_LIST, reconcileSpecFor } from "@/lib/domain/reconciliation";
import { wasteReasonLabel, type WasteReasonChoice } from "@/lib/operator/workflows/waste";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type ReconcileItem = {
  alertId: string;
  kind: string;
  action: "delivery-cost" | "waste-reason" | "open";
  klass: "inline" | "link";
  title: string;
  summary: string;
  createdAt: string;
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

export type ReconcileTray = { count: number; items: ReconcileItem[] };

const EMPTY: ReconcileTray = { count: 0, items: [] };

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The open reconciliation backlog for a branch: the low-urgency owner alerts, hydrated
 * with just enough to clear each in place. Filtered to severity 'warning' so an urgent
 * (critical) alert can never be swept into the tray.
 */
export async function getReconciliationItems(branchId: string): Promise<ReconcileTray> {
  if (!hasSupabaseServiceEnv()) return EMPTY;
  const supabase = createSupabaseServiceClient();

  const { data: alerts } = await supabase
    .from("owner_alerts")
    .select("id, kind, summary, entity_ref, created_at")
    .eq("branch_id", branchId)
    .eq("severity", "warning")
    .in("kind", RECONCILE_KIND_LIST)
    .is("resolved_at", null)
    .order("created_at", { ascending: true });

  if (!alerts || alerts.length === 0) return EMPTY;

  const items: ReconcileItem[] = [];
  for (const alert of alerts) {
    const spec = reconcileSpecFor(String(alert.kind));
    if (!spec) continue;

    const item: ReconcileItem = {
      alertId: String(alert.id),
      kind: String(alert.kind),
      action: spec.action,
      klass: spec.klass,
      title: spec.title,
      summary: String(alert.summary ?? ""),
      createdAt: String(alert.created_at),
      fullHref: spec.fullHref,
      batchId: null,
      productName: null,
      supplierName: null,
      receivedDate: null,
      quantityKg: null,
      currentCost: null,
      reasonLabel: null,
    };

    if (spec.action === "delivery-cost") {
      const batchId = batchIdFromCostRef(alert.entity_ref as string | null);
      item.batchId = batchId;
      if (batchId) {
        const { data: batch } = await supabase
          .from("inventory_batches")
          .select("received_weight_kg, received_date, invoice_cost, product:products(name), supplier:suppliers(name)")
          .eq("id", batchId)
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
    } else if (spec.action === "waste-reason" && isUuid(alert.entity_ref)) {
      const { data: run } = await supabase
        .from("operator_workflow_runs")
        .select("steps")
        .eq("id", alert.entity_ref)
        .maybeSingle();
      const steps = (run?.steps ?? {}) as { quantity?: unknown; reason?: unknown };
      item.quantityKg = typeof steps.quantity === "number" ? steps.quantity : null;
      item.reasonLabel = steps.reason ? wasteReasonLabel(steps.reason as WasteReasonChoice) : null;
    }

    items.push(item);
  }

  return { count: items.length, items };
}
