// Pure resolution + validation for Operator Serve lines. Kept out of the
// "use server" action file so it can be unit-tested directly (F5/F6 regression).
//
// Two invariants this enforces, server-side, regardless of what the client sends:
//   F5 — a custom line (no resolved product) must carry a valid positive price;
//        it can never be persisted at £0.
//   F6 — the serve flow is weight-priced (quantity in kg). A resolved product
//        that isn't sold by kg cannot be sold here at all.

export const MAX_CUSTOM_PRICE_GBP = 1000;

export type ServeProductLite = {
  id: string;
  name: string;
  unit_type: "kg" | "each" | "box";
  price_per_unit: string | number;
};

export type CleanServeLine = {
  productId: string | null;
  name: string | null;
  quantityKg: number;
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

function money(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

export type ResolveServeLinesResult =
  | { ok: true; lines: ResolvedServeLine[] }
  | { ok: false; message: string };

export function resolveServeLines(
  lines: CleanServeLine[],
  byId: Map<string, ServeProductLite>,
): ResolveServeLinesResult {
  // F6: reject any resolved product that isn't sold by kg.
  const hasNonKgProduct = lines.some((line) => {
    const product = line.productId ? byId.get(line.productId) ?? null : null;
    return product != null && product.unit_type !== "kg";
  });
  if (hasNonKgProduct) {
    return { ok: false, message: "That item is sold each, not by weight. Tell owner." };
  }

  // F5: every custom (no-product) line must carry a valid price.
  const hasInvalidCustomPrice = lines.some((line) => {
    const product = line.productId ? byId.get(line.productId) ?? null : null;
    return !product && !validCustomPrice(line.priceGbp);
  });
  if (hasInvalidCustomPrice) {
    return { ok: false, message: "Enter the price for that item." };
  }

  const resolved = lines.map<ResolvedServeLine>((line) => {
    const product = line.productId ? byId.get(line.productId) ?? null : null;
    const name = product?.name ?? line.name ?? "Other";
    const unit = product?.unit_type ?? "kg";
    // Matched product -> priced per kg from the catalogue. Custom line -> the
    // entered pounds ARE the line total; derive a per-unit price so that
    // quantity * unit_price === line_total stays consistent.
    const total = product
      ? Math.round(line.quantityKg * money(product.price_per_unit) * 100) / 100
      : Math.round((line.priceGbp as number) * 100) / 100;
    const price = product
      ? money(product.price_per_unit)
      : Math.round((total / line.quantityKg) * 100) / 100;
    return {
      product,
      name,
      unit,
      price,
      total,
      quantity: line.quantityKg,
      needsCheck: !product,
    };
  });

  return { ok: true, lines: resolved };
}
