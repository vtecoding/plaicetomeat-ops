/**
 * Confirm-don't-ask delivery defaults (pure).
 *
 * Repeated deliveries re-ask supplier, storage and expiry every time even though
 * history usually predicts them. This helper turns those questions into a suggestion
 * the operator confirms or corrects. It NEVER invents truth: every value it returns is
 * drawn from real prior deliveries (or, for expiry, a conservative shorter-dated safe
 * default), it always carries its provenance, and a field it cannot predict returns null
 * so the flow falls back to asking normally.
 */
import { storageChoiceFromLabel, type ExpiryChoice, type StorageChoice } from "./stock";

// Operator-surface rule (verify-operator-firewall): the low-tech operator layer carries
// no internal ranking vocabulary. A default is either present (the operator confirms it)
// or absent (we ask) — `source` carries the richer provenance for the audit trail, so no
// certainty level is needed or wanted here.

export type SupplierDefault = {
  value: string | null; // supplier id
  label: string | null; // supplier name (for operator copy)
  source: "last_used" | "most_frequent" | "only_active" | null;
};

export type StorageDefault = {
  value: StorageChoice | null;
  source: "last_used" | "product_default" | "branch_default" | null;
};

export type ExpiryDefault = {
  value: ExpiryChoice | null;
  source: "product_shelf_life" | "last_pattern" | "safe_default" | null;
};

export type DeliveryDefaults = {
  supplier: SupplierDefault;
  storage: StorageDefault;
  expiry: ExpiryDefault;
};

/** One prior delivery, branch-scoped. Derived from inventory batch history. */
export type DeliveryHistoryEntry = {
  productId: string;
  supplierId: string | null;
  storageLabel: string | null;
  receivedDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
};

export type ActiveSupplier = { id: string; name: string };

// The conservative fallback expiry: shorter dating is the safe direction for food, and
// it matches the flow's long-standing default. Always confirmed by a human, never saved
// silently.
const SAFE_DEFAULT_EXPIRY: ExpiryChoice = "tomorrow";

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/** Map a historical received→expiry gap to one of the quick expiry choices, or null. */
function expiryChoiceFromGap(gap: number | null): ExpiryChoice | null {
  if (gap === null) return null;
  if (gap <= 0) return "today";
  if (gap === 1) return "tomorrow";
  if (gap === 2) return "two_days";
  return null; // longer dating isn't a quick choice — ask rather than guess
}

export function resolveDeliveryDefaults(input: {
  productId: string;
  suppliers: ActiveSupplier[];
  history: DeliveryHistoryEntry[];
}): DeliveryDefaults {
  const nameById = new Map(input.suppliers.map((supplier) => [supplier.id, supplier.name] as const));

  // Most-recent first, so "last used" is simply the head of the list.
  const productHistory = input.history
    .filter((entry) => entry.productId === input.productId)
    .sort((a, b) => (a.receivedDate < b.receivedDate ? 1 : a.receivedDate > b.receivedDate ? -1 : 0));

  const mostRecent = productHistory[0];

  // ---- Supplier: last used → most frequent → only active → none ----
  let supplier: SupplierDefault = { value: null, label: null, source: null };
  if (mostRecent?.supplierId && nameById.has(mostRecent.supplierId)) {
    supplier = {
      value: mostRecent.supplierId,
      label: nameById.get(mostRecent.supplierId) ?? null,
      source: "last_used",
    };
  } else {
    const counts = new Map<string, number>();
    for (const entry of productHistory) {
      if (entry.supplierId && nameById.has(entry.supplierId)) {
        counts.set(entry.supplierId, (counts.get(entry.supplierId) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      supplier = { value: top[0], label: nameById.get(top[0]) ?? null, source: "most_frequent" };
    } else if (input.suppliers.length === 1) {
      const only = input.suppliers[0]!;
      supplier = { value: only.id, label: only.name, source: "only_active" };
    }
  }

  // ---- Storage: last used for this product → none (no product/branch defaults in schema) ----
  let storage: StorageDefault = { value: null, source: null };
  const lastStorageEntry = productHistory.find((entry) => entry.storageLabel != null);
  const storageChoice = lastStorageEntry ? storageChoiceFromLabel(lastStorageEntry.storageLabel) : null;
  if (storageChoice && storageChoice !== "not_sure") {
    storage = { value: storageChoice, source: "last_used" };
  }

  // ---- Expiry: last pattern (if it maps to a quick choice) → conservative safe default ----
  let expiry: ExpiryDefault = { value: SAFE_DEFAULT_EXPIRY, source: "safe_default" };
  if (mostRecent) {
    const patternChoice = expiryChoiceFromGap(daysBetween(mostRecent.receivedDate, mostRecent.expiryDate));
    if (patternChoice) expiry = { value: patternChoice, source: "last_pattern" };
  }

  return { supplier, storage, expiry };
}

/**
 * The selection state a confirm screen starts from. Persisting the delivery uses THIS
 * (mutated by any corrections), never the raw defaults — so a corrected value is what
 * gets stored, and an accepted value is the explicit default value.
 */
export function initialSelectionFromDefaults(defaults: DeliveryDefaults): {
  supplierId: string | null;
  storageChoice: StorageChoice | null;
  expiryChoice: ExpiryChoice | null;
} {
  return {
    supplierId: defaults.supplier.value,
    storageChoice: defaults.storage.value,
    expiryChoice: defaults.expiry.value,
  };
}

/** Does PTM know enough to offer a confirm screen, or should it ask the full flow? */
export function hasConfidentSupplier(defaults: DeliveryDefaults): boolean {
  return defaults.supplier.value !== null;
}
