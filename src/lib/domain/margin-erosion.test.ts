import { describe, expect, it } from "vitest";

import { analyseMarginErosion, buildProductMargins, detectMarginErosion } from "./margin-erosion";

describe("analyseMarginErosion", () => {
  it("flags a real cost rise that eroded margin and suggests a price that restores it", () => {
    // Priced at £10/kg on a £6 cost (40% margin). Cost rose to £7 → margin now 30%.
    const finding = analyseMarginErosion({ productName: "Chicken Breast", pricePerKg: 10, currentCostPerKg: 7, priorCostPerKg: 6 });
    expect(finding).not.toBeNull();
    expect(finding!.perKgProfitDrop).toBe(1); // £1/kg less profit
    expect(finding!.marginDropPct).toBe(25); // 40% → 30% is a 25% relative drop (metrics only)
    // Restore the 40% margin against the £7 cost: 7 / (1 - 0.4) = 11.67.
    expect(finding!.suggestedPricePerKg).toBeCloseTo(11.67, 2);
  });

  it("ignores a cost that did not rise", () => {
    expect(analyseMarginErosion({ productName: "X", pricePerKg: 10, currentCostPerKg: 6, priorCostPerKg: 6 })).toBeNull();
    expect(analyseMarginErosion({ productName: "X", pricePerKg: 10, currentCostPerKg: 5, priorCostPerKg: 6 })).toBeNull();
  });

  it("ignores a trivial drop below the money threshold", () => {
    // 5p/kg rise is below MIN_PER_KG_DROP — not worth interrupting for.
    expect(analyseMarginErosion({ productName: "X", pricePerKg: 10, currentCostPerKg: 6.05, priorCostPerKg: 6 })).toBeNull();
  });

  it("does not treat already-underwater stock as erosion (that's a worse, separate finding)", () => {
    expect(analyseMarginErosion({ productName: "X", pricePerKg: 8, currentCostPerKg: 9, priorCostPerKg: 6 })).toBeNull();
  });
});

describe("detectMarginErosion", () => {
  it("returns worst money-per-kg erosion first and caps the list", () => {
    const findings = detectMarginErosion([
      { productName: "Small", pricePerKg: 10, currentCostPerKg: 6.5, priorCostPerKg: 6 },
      { productName: "Big", pricePerKg: 20, currentCostPerKg: 14, priorCostPerKg: 11 },
      { productName: "None", pricePerKg: 10, currentCostPerKg: 6, priorCostPerKg: 6 },
    ]);
    expect(findings.map((f) => f.productName)).toEqual(["Big", "Small"]);
  });
});

describe("buildProductMargins", () => {
  it("derives current vs prior cost from batch history (most recent first)", () => {
    const margins = buildProductMargins(
      [{ id: "p1", name: "Chicken Breast", pricePerKg: 10 }],
      [
        { productId: "p1", costPerKg: 7, receivedDate: "2026-06-28" },
        { productId: "p1", costPerKg: 6, receivedDate: "2026-06-10" },
      ],
    );
    expect(margins).toEqual([{ productName: "Chicken Breast", pricePerKg: 10, currentCostPerKg: 7, priorCostPerKg: 6 }]);
  });

  it("skips a run of identical-cost deliveries (no real change) and price-less products", () => {
    expect(
      buildProductMargins(
        [{ id: "p1", name: "Steady", pricePerKg: 10 }],
        [
          { productId: "p1", costPerKg: 6, receivedDate: "2026-06-28" },
          { productId: "p1", costPerKg: 6, receivedDate: "2026-06-10" },
        ],
      ),
    ).toEqual([]);
    expect(
      buildProductMargins([{ id: "p1", name: "NoPrice", pricePerKg: 0 }], [{ productId: "p1", costPerKg: 6, receivedDate: "2026-06-28" }]),
    ).toEqual([]);
  });
});
