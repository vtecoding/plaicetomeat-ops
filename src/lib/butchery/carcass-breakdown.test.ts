import { describe, expect, it } from "vitest";

import { calculateCarcassBreakdown } from "./carcass-breakdown";
import { CUT_SHEETS, getCutSheet } from "./cut-sheets";

describe("cut sheet data integrity", () => {
  it("every animal's cut yields (incl. waste) sum to ~100%", () => {
    for (const sheet of CUT_SHEETS) {
      const total = sheet.cuts.reduce((sum, cut) => sum + cut.yieldPct, 0);
      expect(Math.abs(total - 1), `${sheet.id} yields should sum to 1, got ${total}`).toBeLessThan(0.001);
    }
  });

  it("every animal has exactly one waste line and some saleable meat", () => {
    for (const sheet of CUT_SHEETS) {
      expect(sheet.cuts.filter((c) => c.isWaste).length, sheet.id).toBe(1);
      expect(sheet.cuts.some((c) => !c.isWaste)).toBe(true);
    }
  });

  it("margins are sane (0..0.95)", () => {
    for (const sheet of CUT_SHEETS) {
      for (const cut of sheet.cuts) {
        expect(cut.defaultMarginPct).toBeGreaterThanOrEqual(0);
        expect(cut.defaultMarginPct).toBeLessThanOrEqual(0.95);
      }
    }
  });
});

describe("carcass breakdown calculator", () => {
  const lamb = getCutSheet("lamb")!;

  it("shows saleable meat costs more per kg than the carcass (the key insight)", () => {
    const result = calculateCarcassBreakdown({ sheet: lamb, carcassWeightKg: 18, carcassCost: 108 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.costPerKgCarcass).toBe(6); // £108 / 18kg
    // 6% waste -> 16.92kg saleable -> blended cost ~£6.38/kg, higher than £6 carcass.
    expect(result.saleableKg).toBeCloseTo(16.92, 2);
    expect(result.blendedCostPerKgSaleable).toBeGreaterThan(result.costPerKgCarcass);
    // Pricing at the carcass rate would lose roughly the bone/fat value.
    expect(result.lossIfPricedAtCarcassRate).toBeCloseTo(6.48, 1);
  });

  it("breaks even at the blended cost and prices premium cuts highest", () => {
    const result = calculateCarcassBreakdown({ sheet: lamb, carcassWeightKg: 18, carcassCost: 108 });
    if (!result.ok) return;

    const rack = result.rows.find((r) => r.id === "rack")!;
    const mince = result.rows.find((r) => r.id === "mince-trim")!;
    // Premium rack priced above value mince.
    expect(rack.suggestedPricePerKg!).toBeGreaterThan(mince.suggestedPricePerKg!);
    // Every saleable cut is priced above the break-even (blended) cost.
    for (const row of result.rows.filter((r) => !r.isWaste)) {
      expect(row.suggestedPricePerKg!).toBeGreaterThan(result.blendedCostPerKgSaleable);
    }
  });

  it("turns a profit overall and the total profit reconciles", () => {
    const result = calculateCarcassBreakdown({ sheet: lamb, carcassWeightKg: 18, carcassCost: 108 });
    if (!result.ok) return;

    expect(result.totalProfit).toBeGreaterThan(0);
    expect(result.totalProfit).toBeCloseTo(result.totalSuggestedRevenue - result.carcassCost, 1);
    expect(result.overallMarginPct).toBeGreaterThan(20);
    expect(result.overallMarginPct).toBeLessThan(50);
  });

  it("honours a per-cut margin override", () => {
    const base = calculateCarcassBreakdown({ sheet: lamb, carcassWeightKg: 18, carcassCost: 108 });
    const bumped = calculateCarcassBreakdown({
      sheet: lamb,
      carcassWeightKg: 18,
      carcassCost: 108,
      marginOverrides: { leg: 0.5 },
    });
    if (!base.ok || !bumped.ok) return;
    const baseLeg = base.rows.find((r) => r.id === "leg")!;
    const bumpedLeg = bumped.rows.find((r) => r.id === "leg")!;
    expect(bumpedLeg.suggestedPricePerKg!).toBeGreaterThan(baseLeg.suggestedPricePerKg!);
  });

  it("leaves the waste line unpriced", () => {
    const result = calculateCarcassBreakdown({ sheet: lamb, carcassWeightKg: 18, carcassCost: 108 });
    if (!result.ok) return;
    const waste = result.rows.find((r) => r.isWaste)!;
    expect(waste.suggestedPricePerKg).toBeNull();
    expect(waste.lineRevenue).toBeNull();
    expect(waste.weightKg).toBeGreaterThan(0);
  });

  it("rejects invalid inputs without guessing", () => {
    expect(calculateCarcassBreakdown({ sheet: lamb, carcassWeightKg: 0, carcassCost: 108 }).ok).toBe(false);
    expect(calculateCarcassBreakdown({ sheet: lamb, carcassWeightKg: 18, carcassCost: -5 }).ok).toBe(false);
  });
});
