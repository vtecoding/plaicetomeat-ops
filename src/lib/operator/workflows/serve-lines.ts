// Pure resolution and validation for Operator Serve lines. The server always
// resolves catalogue prices again; values shown in the browser are guidance.

export const MAX_CUSTOM_PRICE_GBP = 1000;
export const MAX_WEIGHT_KG = 50;
export const MAX_COUNT_QUANTITY = 99;

export type ServeProductLite = {
  id: string;
  name: string;
  unit_type: "kg" | "each" | "box";
  price_per_unit: string | number;
};

export type CleanServeLine = {
  productId: string | null;
  name: string | null;
  quantity: number;
  priceGbp: number | null;
};

export type ResolvedServeLine = {
  product: ServeProductLite | null;
  name: string;
  unit: "kg" | "each" | "box";
  price: number;
  total: number;
  quantity: number;
  needsCheck: boolean;
};

export function validCustomPrice(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0 && value <= MAX_CUSTOM_PRICE_GBP;
}

export function serveSubtotal(lines: ResolvedServeLine[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.total, 0) * 100) / 100;
}

/**
 * Decide how a retry treats an order header already written for this run.
 * Header-only rows are repaired only when the persisted and freshly-resolved
 * totals agree; money is never silently changed during repair.
 */
export type ServeRepairDecision = "proceed" | "insert-items" | "escalate";

export function serveRepairDecision(input: {
  status: "incoming" | "prepping" | "ready" | "collected" | "cancelled";
  itemCount: number;
  persistedSubtotal: number;
  resolvedSubtotal: number;
}): ServeRepairDecision {
  if (input.status === "collected" || input.status === "cancelled") return "proceed";
  if (input.itemCount > 0) return "proceed";
  const persisted = Math.round(input.persistedSubtotal * 100);
  const resolved = Math.round(input.resolvedSubtotal * 100);
  if (Number.isFinite(persisted) && persisted === resolved) return "insert-items";
  return "escalate";
}

function money(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function validQuantity(quantity: number, unit: ServeProductLite["unit_type"] | "custom") {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (unit === "each" || unit === "box") return Number.isInteger(quantity) && quantity <= MAX_COUNT_QUANTITY;
  return quantity <= MAX_WEIGHT_KG;
}

export type ResolveServeLinesResult =
  | { ok: true; lines: ResolvedServeLine[] }
  | { ok: false; message: string };

export function resolveServeLines(
  lines: CleanServeLine[],
  byId: Map<string, ServeProductLite>,
): ResolveServeLinesResult {
  for (const line of lines) {
    const product = line.productId ? byId.get(line.productId) ?? null : null;

    if (line.productId && !product) {
      return { ok: false, message: "That item is no longer available." };
    }

    if (!product && !validCustomPrice(line.priceGbp)) {
      return { ok: false, message: "Enter the price for that item." };
    }

    const unit = product?.unit_type ?? "custom";
    if (!validQuantity(line.quantity, unit)) {
      return unit === "each" || unit === "box"
        ? { ok: false, message: "Enter a whole number from 1 to 99." }
        : { ok: false, message: "Enter a valid weight." };
    }
  }

  const resolved = lines.map<ResolvedServeLine>((line) => {
    const product = line.productId ? byId.get(line.productId) ?? null : null;
    const name = product?.name ?? line.name ?? "Other";
    const unit = product?.unit_type ?? "kg";
    // Catalogue lines are quantity x current catalogue price. For a custom
    // Other line, the entered pounds are the whole line total.
    const total = product
      ? Math.round(line.quantity * money(product.price_per_unit) * 100) / 100
      : Math.round((line.priceGbp as number) * 100) / 100;
    const price = product
      ? money(product.price_per_unit)
      : Math.round((total / line.quantity) * 100) / 100;

    return {
      product,
      name,
      unit,
      price,
      total,
      quantity: line.quantity,
      needsCheck: !product,
    };
  });

  return { ok: true, lines: resolved };
}
