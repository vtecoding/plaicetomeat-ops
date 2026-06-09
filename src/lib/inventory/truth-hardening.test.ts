import { describe, expect, it } from "vitest";

import {
  buildCompensatingMovement,
  buildReconciliationReport,
  calculateInventoryConfidence,
  canMutateHistoricalMovement,
  eachBoxFutureRecommendation,
  saleDepletionKeysAreUnique,
  summarizeFailureVisibility,
} from "./truth-hardening";

describe("append-only movement invariant", () => {
  it("allows only inserts, never historical mutation", () => {
    expect(canMutateHistoricalMovement("INSERT")).toBe(true);
    expect(canMutateHistoricalMovement("UPDATE")).toBe(false);
    expect(canMutateHistoricalMovement("DELETE")).toBe(false);
    expect(canMutateHistoricalMovement("TRUNCATE")).toBe(false);
  });
});

describe("reversal and correction safety", () => {
  it("reversals create new compensating movements instead of editing sale rows", () => {
    const reversal = buildCompensatingMovement({
      originalMovementId: "movement-sale-1",
      orderId: "order-1",
      batchId: "batch-1",
      orderItemId: "item-1",
      originalDeltaKg: -1.25,
      balanceBeforeKg: 3,
      sourceEvent: "REFUND_REVERSAL",
    });

    expect(reversal).toMatchObject({
      reversalOfMovementId: "movement-sale-1",
      deltaKg: 1.25,
      quantityKg: 1.25,
      balanceBeforeKg: 3,
      balanceAfterKg: 4.25,
      sourceEvent: "REFUND_REVERSAL",
    });
  });

  it("rejects attempts to auto-reverse non-sale movements", () => {
    expect(() =>
      buildCompensatingMovement({
        originalMovementId: "movement-adjustment-1",
        orderId: "order-1",
        batchId: "batch-1",
        originalDeltaKg: 0.5,
        balanceBeforeKg: 3,
        sourceEvent: "OPERATOR_CORRECTION",
      }),
    ).toThrow("Only negative sale movements");
  });
});

describe("inventory confidence engine", () => {
  it("keeps trusted stock calm and internal score private", () => {
    const confidence = calculateInventoryConfidence({
      productId: "chicken",
      productName: "Chicken Breast",
      lastCountDaysAgo: 2,
    });

    expect(confidence.internalScore).toBe(100);
    expect(confidence.signal).toBe("trusted");
    expect(confidence.operatorMessage).toBe("Stock available.");
  });

  it("downgrades confidence when counts age or corrections repeat", () => {
    const confidence = calculateInventoryConfidence({
      productId: "lamb",
      productName: "Lamb Leg",
      correctionCount30d: 2,
      lastCountDaysAgo: 9,
    });

    expect(confidence.signal).toBe("count_soon");
    expect(confidence.internalReasons).toEqual(expect.arrayContaining(["correction", "count_aging"]));
    expect(confidence.operatorMessage).toBe("Please count Lamb Leg soon.");
  });

  it("turns repeated shortfalls and cache mismatches into count-today signals", () => {
    const confidence = calculateInventoryConfidence({
      productId: "beef",
      productName: "Beef Diced",
      cacheMismatch: true,
      shortfallCount30d: 2,
      lastCountDaysAgo: 1,
    });

    expect(confidence.signal).toBe("count_today");
    expect(confidence.internalScore).toBeLessThan(60);
    expect(confidence.operatorMessage).toBe("Please count Beef Diced today.");
  });
});

describe("reconciliation monitor", () => {
  it("proves repeated collection cannot be represented as duplicate sale depletion keys", () => {
    expect(
      saleDepletionKeysAreUnique([
        { sourceEvent: "SALE_COLLECT", orderItemId: "line-1", batchId: "batch-1" },
        { sourceEvent: "SALE_COLLECT", orderItemId: "line-1", batchId: "batch-1" },
      ]),
    ).toBe(false);

    expect(
      saleDepletionKeysAreUnique([
        { sourceEvent: "SALE_COLLECT", orderItemId: "line-1", batchId: "batch-1" },
        { sourceEvent: "SALE_COLLECT", orderItemId: "line-1", batchId: "batch-2" },
      ]),
    ).toBe(true);
  });

  it("identifies mismatches without silently disappearing stock", () => {
    const report = buildReconciliationReport([
      {
        productId: "chicken",
        productName: "Chicken Breast",
        cacheMismatch: true,
        recurringMismatches: 1,
        lastCountDaysAgo: 1,
      },
    ]);

    expect(report).toEqual([
      {
        productId: "chicken",
        productName: "Chicken Breast",
        severity: "count_today",
        reason: "ledger_cache_mismatch",
        operatorMessage: "Please count Chicken Breast today.",
      },
    ]);
  });

  it("keeps shortfalls auditable and repeated collection from creating duplicate prompts", () => {
    const report = buildReconciliationReport([
      {
        productId: "chicken",
        productName: "Chicken Breast",
        shortfallCount30d: 2,
        repeatedShortfalls: 2,
        lastCountDaysAgo: 1,
      },
      {
        productId: "chicken",
        productName: "Chicken Breast",
        shortfallCount30d: 2,
        repeatedShortfalls: 2,
        lastCountDaysAgo: 1,
      },
    ]);

    expect(report).toHaveLength(2);
    expect(report.every((finding) => finding.reason === "repeated_shortfall")).toBe(true);
    expect(report.every((finding) => finding.operatorMessage === "Please count Chicken Breast today.")).toBe(true);
  });
});

describe("failure visibility", () => {
  it("escalates repeated internal failure classes only", () => {
    const trends = summarizeFailureVisibility([
      { type: "depletion_failure", count30d: 1 },
      { type: "oversell_flag", count30d: 3 },
      { type: "unmapped_product", count30d: 2 },
      { type: "non_weight_tracked_sale", count30d: 1 },
    ]);

    expect(trends).toEqual([
      { type: "oversell_flag", count30d: 3 },
      { type: "unmapped_product", count30d: 2 },
    ]);
  });
});

describe("each/box future path", () => {
  it("documents a recommendation without implementing depletion", () => {
    expect(eachBoxFutureRecommendation()).toContain("defer automatic each/box depletion");
    expect(eachBoxFutureRecommendation()).toContain("weighed-at-collection");
    expect(eachBoxFutureRecommendation()).toContain("manual-counted");
  });
});
