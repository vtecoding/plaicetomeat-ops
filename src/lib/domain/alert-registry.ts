/**
 * Canonical owner-alert action registry (V18 B2).
 *
 * Alert producers only write facts (`kind`, `summary`, `entity_ref`). This map
 * owns how an owner can act on each fact. Unknown legacy rows deliberately fall
 * back to note-and-resolve so an old alert can never become an un-clearable
 * orphan in the owner jobs tray.
 */
export type AlertAction = "inline-cost" | "confirm-reason" | "link" | "note-resolve";
export type AlertAutoResolve =
  | "stock-touch"
  | "checklist-step-complete"
  | "opening-complete"
  | "certificate-renewal-or-window"
  | null;

export type AlertRegistryContext = {
  entityRef: string | null;
};

export type AlertKindSpec = {
  title: string;
  action: AlertAction;
  href: (context: AlertRegistryContext) => string | null;
  autoResolve: AlertAutoResolve;
};

const ADMIN_ORDERS = () => "/admin/orders";
const INVENTORY = () => "/admin/inventory";
const PURCHASING = () => "/admin/purchasing";
const COMPLIANCE = () => "/admin/compliance";
const EVIDENCE = () => "/admin/compliance#supporting-files";
const RELEASES = () => "/admin/releases";
const NO_LINK = () => null;

function checklistHref({ entityRef }: AlertRegistryContext) {
  if (entityRef?.includes(":closing:")) return "/admin/close";
  if (entityRef?.includes(":opening:")) return "/admin/open";
  return "/admin/today";
}

function mistakeHref({ entityRef }: AlertRegistryContext) {
  if (entityRef?.startsWith("order:") || /^[0-9a-f-]{36}$/i.test(entityRef ?? "")) return "/admin/orders";
  if (entityRef?.startsWith("inventory_batch:") || entityRef?.startsWith("batch:")) return "/admin/inventory";
  return "/admin/today";
}

export const ALERT_KINDS = {
  operator_delivery_cost_pending: {
    title: "Add delivery cost",
    action: "inline-cost",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_waste_reason_check: {
    title: "Confirm waste reason",
    action: "confirm-reason",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_help: {
    title: "Shop needs help",
    action: "note-resolve",
    href: NO_LINK,
    autoResolve: null,
  },
  help_fridge: {
    title: "Fridge help",
    action: "note-resolve",
    href: NO_LINK,
    autoResolve: null,
  },
  help_equipment: {
    title: "Equipment help",
    action: "note-resolve",
    href: NO_LINK,
    autoResolve: null,
  },
  operator_checklist_help: {
    title: "Checklist help",
    action: "link",
    href: checklistHref,
    autoResolve: "checklist-step-complete",
  },
  checklist_skip: {
    title: "Skipped checklist step",
    action: "link",
    href: checklistHref,
    autoResolve: "checklist-step-complete",
  },
  operator_delivery_check_needed: {
    title: "Check delivery details",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_delivery_unknown_product: {
    title: "Check delivery product",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_delivery_unknown_supplier: {
    title: "Check delivery supplier",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_delivery_needs_owner: {
    title: "Check a delivery",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_sale_check_needed: {
    title: "Check a shop sale",
    action: "link",
    href: ADMIN_ORDERS,
    autoResolve: null,
  },
  questionable_sale: {
    title: "Check a sale",
    action: "link",
    href: ADMIN_ORDERS,
    autoResolve: null,
  },
  inventory_shortfall: {
    title: "Check missing stock",
    action: "link",
    href: INVENTORY,
    autoResolve: "stock-touch",
  },
  till_variance: {
    title: "Check closing money",
    action: "link",
    href: ADMIN_ORDERS,
    autoResolve: null,
  },
  refund_above_threshold: {
    title: "Review a large refund",
    action: "note-resolve",
    href: ADMIN_ORDERS,
    autoResolve: null,
  },
  certificate_expiring: {
    title: "Renew supplier certificate",
    action: "link",
    href: COMPLIANCE,
    autoResolve: "certificate-renewal-or-window",
  },
  backup_stale: {
    title: "Check the latest backup",
    action: "link",
    href: RELEASES,
    autoResolve: null,
  },
  operator_mistake_flag: {
    title: "Fix an operator mistake",
    action: "note-resolve",
    href: mistakeHref,
    autoResolve: null,
  },
  operator_waste_unknown_product: {
    title: "Check waste product",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_waste_needs_owner: {
    title: "Check recorded waste",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_waste_no_matching_stock: {
    title: "Match waste to stock",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_waste_recovery_needed: {
    title: "Reconcile interrupted waste",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  operator_evidence_review: {
    title: "Review a photo",
    action: "link",
    href: EVIDENCE,
    autoResolve: null,
  },
  operator_document_review: {
    title: "File a supplier document",
    action: "link",
    href: COMPLIANCE,
    autoResolve: null,
  },
  operator_stock_ran_out: {
    title: "Add ran-out item to buying",
    action: "link",
    href: PURCHASING,
    autoResolve: null,
  },
  operator_stock_help_needed: {
    title: "Check stock help",
    action: "link",
    href: INVENTORY,
    autoResolve: null,
  },
  // Grandfathered only: B2 stops creating these rows. Existing rows still need
  // an action and a clean lifecycle.
  operator_sale_count_needed: {
    title: "Review old low-stock sale",
    action: "note-resolve",
    href: PURCHASING,
    autoResolve: null,
  },
  low_stock_during_sale: {
    title: "Review old low-stock sale",
    action: "note-resolve",
    href: PURCHASING,
    autoResolve: null,
  },
  not_opened_by_time: {
    title: "Shop has not opened",
    action: "note-resolve",
    href: () => "/admin/open",
    autoResolve: "opening-complete",
  },
} satisfies Record<string, AlertKindSpec>;

export type RegisteredAlertKind = keyof typeof ALERT_KINDS;
export const ALERT_KIND_LIST = Object.keys(ALERT_KINDS) as RegisteredAlertKind[];

const FALLBACK: AlertKindSpec = {
  title: "Owner check",
  action: "note-resolve",
  href: NO_LINK,
  autoResolve: null,
};

export function alertSpecFor(kind: string): AlertKindSpec {
  return ALERT_KINDS[kind as RegisteredAlertKind] ?? FALLBACK;
}

export function alertHref(kind: string, entityRef: string | null): string | null {
  return alertSpecFor(kind).href({ entityRef });
}

/** Truth-backed jobs may only clear when their database producer observes the
 * underlying fact. A note must never bypass those automatic resolution rules. */
export function canManuallyResolveAlert(kind: string): boolean {
  return alertSpecFor(kind).autoResolve === null;
}
