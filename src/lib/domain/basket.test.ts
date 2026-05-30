import { describe, expect, it } from "vitest";

import { demoProducts } from "@/lib/data/demo";

import type { BasketItem } from "./types";
import { isBasketExpired, recalculateBasket } from "./basket";

describe("basket rules", () => {
  it("expires baskets older than 24 hours", () => {
    expect(isBasketExpired("2026-05-28T08:00:00.000Z", new Date("2026-05-29T08:00:01.000Z"))).toBe(true);
    expect(isBasketExpired("2026-05-28T08:00:00.000Z", new Date("2026-05-29T07:59:59.000Z"))).toBe(false);
  });

  it("recalculates totals from product prices and ignores tampered client prices", () => {
    const item: BasketItem = {
      productId: demoProducts[0].id,
      productSlug: demoProducts[0].slug,
      name: demoProducts[0].name,
      quantity: 2,
      unitType: demoProducts[0].unitType,
      unitPriceSnapshot: 0.01,
    };

    const recalculated = recalculateBasket([item], demoProducts);

    expect(recalculated.lines[0].unitPriceSnapshot).toBe(demoProducts[0].pricePerUnit);
    expect(recalculated.subtotal).toBe(17.98);
  });

  it("rejects unavailable products and quantity bounds", () => {
    const unavailable = { ...demoProducts[0], isAvailable: false };

    expect(() =>
      recalculateBasket(
        [
          {
            productId: unavailable.id,
            productSlug: unavailable.slug,
            name: unavailable.name,
            quantity: 1,
            unitType: unavailable.unitType,
            unitPriceSnapshot: unavailable.pricePerUnit,
          },
        ],
        [unavailable],
      ),
    ).toThrow("Chicken Breast Fillets is no longer available.");

    expect(() =>
      recalculateBasket(
        [
          {
            productId: demoProducts[0].id,
            productSlug: demoProducts[0].slug,
            name: demoProducts[0].name,
            quantity: 0.001,
            unitType: demoProducts[0].unitType,
            unitPriceSnapshot: demoProducts[0].pricePerUnit,
          },
        ],
        demoProducts,
      ),
    ).toThrow("minimum order");
  });
});
