import { describe, expect, it } from "vitest";

import { buildWeeklyReport } from "./weekly-report";
import { makeSnapshot } from "./test-helpers";

const NOW = new Date("2026-06-03T08:00:00Z");

describe("buildWeeklyReport (V8.10)", () => {
  it("summarises the week from existing performance signals", () => {
    const report = buildWeeklyReport(makeSnapshot(), NOW);
    expect(report.revenue).toBe(1450);
    expect(report.topProduct).toBe("Chicken breast");
    expect(report.lowestProduct).toBe("Lamb neck");
    expect(report.biggestWasteSource).toBe("Chicken thighs");
    expect(report.mostFrequentStockRisk).toBe("Beef mince"); // least cover left
    expect(report.complianceSummary).toBe("No compliance issues.");
    expect(report.rangeLabel).toContain("–");
  });

  it("never repeats the same product as both best and worst", () => {
    const report = buildWeeklyReport(
      makeSnapshot({
        margin: {
          best: { productName: "Only Product", grossProfit: 10 },
          worst: { productName: "Only Product", grossProfit: 10, grossMarginPercentage: 10 },
          highestWasteDrag: null,
          rows: [{ productName: "Only Product", revenue: 100, grossProfit: 10, grossMarginPercentage: 10, unitsSold: 5 }],
          unavailableCount: 0,
        },
      }),
      NOW,
    );
    expect(report.topProduct).toBe("Only Product");
    expect(report.lowestProduct).toBeNull();
  });

  it("is honest about missing costs and revenue history", () => {
    const report = buildWeeklyReport(
      makeSnapshot({
        revenue: { today: 0, yesterday: 0, weekToDate: null },
        margin: {
          best: null,
          worst: null,
          highestWasteDrag: null,
          rows: [],
          unavailableCount: 4,
        },
      }),
      NOW,
    );
    expect(report.revenue).toBeNull();
    expect(report.notes.some((note) => note.includes("4 product"))).toBe(true);
    expect(report.notes.some((note) => note.includes("revenue isn't shown"))).toBe(true);
  });

  it("reports an expired certificate in the compliance summary", () => {
    const report = buildWeeklyReport(
      makeSnapshot({
        compliance: {
          rows: [{ supplierName: "X", daysToExpiry: -1, band: "expired" }],
          expired: 1,
          expiringSoon: 0,
          missing: 0,
          status: "Critical",
        },
      }),
      NOW,
    );
    expect(report.complianceSummary).toContain("expired");
  });
});
