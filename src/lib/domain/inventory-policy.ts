import type { InventoryPolicy, Product, UnitType } from "@/lib/domain/types";

export const STOCK_NOT_COUNTED_LABEL = "Stock not counted";

/**
 * Product writes derive this value from the unit instead of trusting a client
 * supplied policy. A kg product may later be deliberately marked untracked by
 * an owner-only path, but each/box products are always untracked.
 */
export function deriveInventoryPolicy(unitType: UnitType): InventoryPolicy {
  return unitType === "kg" ? "kg_batch" : "untracked_manual";
}

export function isStockCounted(policy: InventoryPolicy): boolean {
  return policy === "kg_batch";
}

export function isStockCountedProduct(product: Pick<Product, "inventoryPolicy">): boolean {
  return isStockCounted(product.inventoryPolicy);
}

export function stockCountedOnly<T extends { inventoryPolicy: InventoryPolicy }>(rows: T[]): T[] {
  return rows.filter((row) => isStockCounted(row.inventoryPolicy));
}
