/**
 * The reconciliation tray — pure classification.
 *
 * A small set of *low-urgency* owner-alert kinds are bookkeeping, not decisions: an
 * operator delivery saved without its invoice cost (F7), or a waste recorded with an
 * unsure reason. Rather than let these surface one-by-one (or, today, only inside Owner
 * Away), they batch into a single "things to reconcile" tray the owner clears in one place.
 *
 * Urgent kinds (operator help, halal/cert expiry, compliance, stock danger, stuck orders)
 * are deliberately NOT here — they stay as individual items and are never batched away.
 * The reader also filters to severity 'warning', so a critical alert can never be hidden.
 */
import { ALERT_KINDS } from "./alert-registry";

export type ReconcileClass = "inline" | "link";
export type ReconcileAction = "delivery-cost" | "waste-reason" | "open";

export type ReconcileKindSpec = {
  kind: string;
  /** inline = resolved in-place (Class A); link = needs a full workflow elsewhere (Class B). */
  klass: ReconcileClass;
  action: ReconcileAction;
  /** Short imperative shown on the card. */
  title: string;
  /** "Open full details" destination, when a heavier correction is needed. */
  fullHref: string | null;
};

export const RECONCILE_KINDS: Record<string, ReconcileKindSpec> = {
  operator_delivery_cost_pending: {
    kind: "operator_delivery_cost_pending",
    klass: "inline",
    action: "delivery-cost",
    title: ALERT_KINDS.operator_delivery_cost_pending.title,
    fullHref: "/admin/inventory",
  },
  operator_waste_reason_check: {
    kind: "operator_waste_reason_check",
    klass: "inline",
    action: "waste-reason",
    title: ALERT_KINDS.operator_waste_reason_check.title,
    fullHref: "/admin/inventory",
  },
};

/** The exact alert kinds that batch into the tray. The reader filters on this list. */
export const RECONCILE_KIND_LIST = Object.keys(RECONCILE_KINDS);

export function reconcileSpecFor(kind: string): ReconcileKindSpec | null {
  return RECONCILE_KINDS[kind] ?? null;
}

export function isReconcileKind(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECONCILE_KINDS, kind);
}

/**
 * Recover the inventory batch id from a cost-pending alert's entity_ref. The operator
 * delivery flow keys these as `${batchId}:cost` so the cost task is distinct from the
 * optional details-check alert on the same delivery.
 */
export function batchIdFromCostRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const id = ref.endsWith(":cost") ? ref.slice(0, -":cost".length) : ref;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
