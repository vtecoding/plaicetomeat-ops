import { describe, expect, it } from "vitest";

import {
  buildCollectionStockMessage,
  joinNames,
  type CollectionStockSummary,
} from "./collection-stock";

const base: CollectionStockSummary = {
  status: "completed",
  weightTrackedLines: 0,
  nonWeightTrackedLines: 0,
  shortfall: [],
};

// No developer/ledger vocabulary may ever reach the operator.
const FORBIDDEN = /movement|ledger|delta|deplet|shortfall|negative|insert|rpc|sale_collect|variance|batch|null|undefined|error|fail/i;

describe("buildCollectionStockMessage", () => {
  it("confirms a plain collection when there is no summary", () => {
    expect(buildCollectionStockMessage(null)).toBe("Collected.");
    expect(buildCollectionStockMessage(undefined)).toBe("Collected.");
  });

  it("says stock updated when weight-tracked lines depleted cleanly", () => {
    expect(buildCollectionStockMessage({ ...base, weightTrackedLines: 2 })).toBe("Collected — stock updated.");
  });

  it("says counted manually when nothing is weight-tracked", () => {
    expect(buildCollectionStockMessage({ ...base, nonWeightTrackedLines: 1 })).toBe(
      "Collected. Stock for these items is counted manually.",
    );
  });

  it("asks for a manual count on a single shortfall, naming the product", () => {
    const msg = buildCollectionStockMessage({
      ...base,
      status: "completed_with_shortfall",
      weightTrackedLines: 1,
      shortfall: [{ productName: "Chicken Breast Fillets", shortKg: 0.5 }],
    });
    expect(msg).toBe("Collected. Please count Chicken Breast Fillets when convenient.");
  });

  it("lists multiple short products naturally", () => {
    const msg = buildCollectionStockMessage({
      ...base,
      status: "completed_with_shortfall",
      weightTrackedLines: 2,
      shortfall: [
        { productName: "Chicken Breast Fillets", shortKg: 0.5 },
        { productName: "Beef Diced", shortKg: 0.2 },
      ],
    });
    expect(msg).toBe("Collected. Please count Chicken Breast Fillets and Beef Diced when convenient.");
  });

  it("never leaks technical or alarming language for any case", () => {
    const cases: (CollectionStockSummary | null)[] = [
      null,
      { ...base, weightTrackedLines: 3 },
      { ...base, nonWeightTrackedLines: 2 },
      {
        ...base,
        status: "completed_with_shortfall",
        weightTrackedLines: 1,
        shortfall: [{ productName: "Lamb Leg Steaks", shortKg: 1 }],
      },
    ];
    for (const c of cases) {
      // Product names are allowed even if they contain a forbidden substring; we test
      // the fixed wording around them, which here uses no flagged products.
      expect(buildCollectionStockMessage(c)).not.toMatch(FORBIDDEN);
    }
  });
});

describe("joinNames", () => {
  it("joins zero, one, two and many", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});
