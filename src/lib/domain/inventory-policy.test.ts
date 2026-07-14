import { describe, expect, it } from "vitest";

import {
  deriveInventoryPolicy,
  isStockCounted,
  STOCK_NOT_COUNTED_LABEL,
  stockCountedOnly,
} from "@/lib/domain/inventory-policy";

describe("V18 inventory policy", () => {
  it("derives each and box as untracked while kg starts batch-counted", () => {
    expect(deriveInventoryPolicy("kg")).toBe("kg_batch");
    expect(deriveInventoryPolicy("each")).toBe("untracked_manual");
    expect(deriveInventoryPolicy("box")).toBe("untracked_manual");
  });

  it("keeps untracked rows out of stock totals", () => {
    const rows = stockCountedOnly([
      { id: "tracked", inventoryPolicy: "kg_batch" as const, quantity: 8, stockValue: 64 },
      { id: "each", inventoryPolicy: "untracked_manual" as const, quantity: 99, stockValue: 999 },
    ]);

    expect(rows.map((row) => row.id)).toEqual(["tracked"]);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(8);
    expect(rows.reduce((sum, row) => sum + row.stockValue, 0)).toBe(64);
  });

  it("uses one plain label everywhere stock would otherwise be implied", () => {
    expect(isStockCounted("untracked_manual")).toBe(false);
    expect(STOCK_NOT_COUNTED_LABEL).toBe("Stock not counted");
  });
});
