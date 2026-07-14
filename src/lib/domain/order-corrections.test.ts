import { describe, expect, it } from "vitest";

import type { OrderItem, Product } from "./types";
import {
  isSubstituteSellable,
  isValidCorrectionQuantity,
  previewOrderAmendment,
  refundDispositionLabel,
} from "./order-corrections";

const line: OrderItem = {
  id: "line-1",
  productId: "beef",
  productNameSnapshot: "Beef roasting joint",
  quantity: 1,
  unitType: "kg",
  unitPriceSnapshot: 10,
  lineTotal: 10,
};

describe("display-only amendment preview", () => {
  it("composes substitute, weight adjustment and partial removal using pence rounding", () => {
    const lamb = { id: "lamb", name: "Lamb leg", unitType: "kg", pricePerUnit: 12 } satisfies Pick<
      Product,
      "id" | "name" | "unitType" | "pricePerUnit"
    >;
    const substituted = previewOrderAmendment(line, { kind: "substitute", substituteProductId: lamb.id }, lamb);
    expect(substituted).toMatchObject({ productId: "lamb", quantity: 1, unitPrice: 12, lineTotal: 12 });

    const lambLine = {
      ...line,
      productId: substituted.productId,
      productNameSnapshot: substituted.productName,
      unitPriceSnapshot: substituted.unitPrice,
      lineTotal: substituted.lineTotal,
    };
    const adjusted = previewOrderAmendment(lambLine, { kind: "weight_adjust", newQuantity: 1.245 });
    expect(adjusted.lineTotal).toBe(14.94);

    const adjustedLine = { ...lambLine, quantity: adjusted.quantity, lineTotal: adjusted.lineTotal };
    expect(previewOrderAmendment(adjustedLine, { kind: "remove", newQuantity: 1.1 })).toMatchObject({
      quantity: 1.1,
      lineTotal: 13.2,
      removed: false,
    });
  });

  it("marks a higher substitute total for explicit customer confirmation", () => {
    const result = previewOrderAmendment(
      line,
      { kind: "substitute", substituteProductId: "premium" },
      { id: "premium", name: "Premium beef", unitType: "kg", pricePerUnit: 14 },
    );
    expect(result.priceIncrease).toBe(true);
  });

  it("uses catalogue availability and stock status for substitute options", () => {
    expect(isSubstituteSellable({ isAvailable: true, stockStatus: "in_stock" })).toBe(true);
    expect(isSubstituteSellable({ isAvailable: true, stockStatus: "low_stock" })).toBe(true);
    expect(isSubstituteSellable({ isAvailable: true, stockStatus: "out_of_stock" })).toBe(false);
    expect(isSubstituteSellable({ isAvailable: false, stockStatus: "in_stock" })).toBe(false);
  });

  it("shows all three physical stock outcomes without suggesting a second depletion", () => {
    expect(refundDispositionLabel("customer_kept")).toContain("no stock movement");
    expect(refundDispositionLabel("returned_restockable")).toContain("original stock");
    expect(refundDispositionLabel("returned_discarded")).toContain("returned waste");
  });

  it("accepts canonical three-decimal quantities despite binary floating-point representation", () => {
    expect(isValidCorrectionQuantity(1.001)).toBe(true);
    expect(isValidCorrectionQuantity(1.005)).toBe(true);
    expect(isValidCorrectionQuantity(1.0001)).toBe(false);
    expect(isValidCorrectionQuantity(Number.NaN)).toBe(false);
  });
});
