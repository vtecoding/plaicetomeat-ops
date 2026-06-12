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
    pricePerUnit: 10,
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
  it("maps simple tiles to kg products first", () => {
    const tiles = buildServeTiles([
      product({ id: "whole", name: "Whole Chicken", unitType: "each", sortOrder: 1 }),
      product({ id: "breast", name: "Chicken Breast Fillets", unitType: "kg", sortOrder: 9 }),
      product({ id: "lamb", name: "Lamb Leg Steaks", unitType: "kg" }),
      product({ id: "steak", name: "Ribeye Steak", unitType: "kg" }),
    ]);

    expect(tiles.find((tile) => tile.id === "chicken")).toMatchObject({ label: "Chicken", productId: "breast" });
    expect(tiles.find((tile) => tile.id === "lamb")).toMatchObject({ label: "Lamb", productId: "lamb" });
    expect(tiles.find((tile) => tile.id === "steak")).toMatchObject({ label: "Steak", productId: "steak" });
  });

  it("keeps simple tiles even when no matching product exists", () => {
    const tiles = buildServeTiles([product({ id: "beef", name: "Beef Diced", unitType: "kg" })]);

    expect(tiles.find((tile) => tile.id === "mutton")).toMatchObject({
      label: "Mutton",
      productId: null,
      fallbackName: "Mutton",
    });
    expect(tiles.at(-1)).toMatchObject({ id: "other", label: "Other", productId: null });
  });
});
