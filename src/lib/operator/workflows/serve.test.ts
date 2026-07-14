import { describe, expect, it } from "vitest";

import type { Product } from "@/lib/domain/types";
import { buildServeTiles } from "@/lib/operator/workflows/serve";

function product(input: Partial<Product> & { id: string; name: string; unitType: Product["unitType"] }): Product {
  return {
    id: input.id,
    branchId: "branch",
    categoryId: null,
    name: input.name,
    slug: input.name.toLowerCase().replace(/\s+/g, "-"),
    description: null,
    unitType: input.unitType,
    inventoryPolicy: input.inventoryPolicy ?? (input.unitType === "kg" ? "kg_batch" : "untracked_manual"),
    pricePerUnit: input.pricePerUnit ?? 10,
    minOrderQuantity: 0.1,
    maxOrderQuantity: null,
    imageUrl: null,
    isAvailable: input.isAvailable ?? true,
    stockStatus: input.stockStatus ?? "in_stock",
    requiresWeightConfirmation: input.requiresWeightConfirmation ?? false,
    sortOrder: input.sortOrder ?? 0,
  };
}

describe("buildServeTiles", () => {
  it("maps familiar weight shortcuts to kg products and their current prices", () => {
    const tiles = buildServeTiles([
      product({ id: "whole", name: "Whole Chicken", unitType: "each", sortOrder: 1, pricePerUnit: 6.5 }),
      product({ id: "breast", name: "Chicken Breast Fillets", unitType: "kg", sortOrder: 9, pricePerUnit: 9 }),
      product({ id: "lamb", name: "Lamb Leg Steaks", unitType: "kg" }),
      product({ id: "steak", name: "Ribeye Steak", unitType: "kg" }),
    ]);

    expect(tiles.find((tile) => tile.id === "chicken")).toMatchObject({
      label: "Chicken",
      productId: "breast",
      unitType: "kg",
      pricePerUnit: 9,
    });
    expect(tiles.find((tile) => tile.id === "lamb")?.productId).toBe("lamb");
    expect(tiles.find((tile) => tile.id === "steak")?.productId).toBe("steak");
  });

  it("keeps simple weight tiles when no matching product exists", () => {
    const tiles = buildServeTiles([product({ id: "beef", name: "Beef Diced", unitType: "kg" })]);

    expect(tiles.find((tile) => tile.id === "mutton")).toMatchObject({
      label: "Mutton",
      productId: null,
      fallbackName: "Mutton",
      unitType: "kg",
      pricePerUnit: null,
    });
    expect(tiles.at(-1)).toMatchObject({ id: "other", label: "Other", productId: null });
  });

  it("adds explicit each and box catalogue tiles without mapping them to weight shortcuts", () => {
    const tiles = buildServeTiles([
      product({ id: "whole", name: "Whole Chicken", unitType: "each", pricePerUnit: 6.5 }),
      product({ id: "boxbeef", name: "Beef Box", unitType: "box", pricePerUnit: 25 }),
    ]);

    expect(tiles.find((tile) => tile.id === "chicken")?.productId).toBeNull();
    expect(tiles.find((tile) => tile.id === "beef")?.productId).toBeNull();
    expect(tiles.find((tile) => tile.productId === "whole")).toMatchObject({
      label: "Whole Chicken",
      unitType: "each",
      pricePerUnit: 6.5,
    });
    expect(tiles.find((tile) => tile.productId === "boxbeef")).toMatchObject({
      label: "Beef Box",
      unitType: "box",
      pricePerUnit: 25,
    });
  });

  it("prefers the kg product even when an each product matches the same shortcut", () => {
    const tiles = buildServeTiles([
      product({ id: "whole", name: "Whole Chicken", unitType: "each", sortOrder: 0 }),
      product({ id: "diced", name: "Chicken Diced", unitType: "kg", sortOrder: 9 }),
    ]);

    expect(tiles.find((tile) => tile.id === "chicken")?.productId).toBe("diced");
    expect(tiles.find((tile) => tile.productId === "whole")?.id).toBe("product:whole");
  });
});
