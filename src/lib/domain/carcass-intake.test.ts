import { describe, expect, it } from "vitest";

import { calculateCarcassBreakdown } from "@/lib/butchery/carcass-breakdown";
import { getCutSheet } from "@/lib/butchery/cut-sheets";
import {
  buildIntakePlan,
  buildIntakePreview,
  toRpcCuts,
  validateIntakeInputs,
  type IntakeMapping,
} from "@/lib/domain/carcass-intake";

function lambBreakdown() {
  const sheet = getCutSheet("lamb")!;
  const result = calculateCarcassBreakdown({ sheet, carcassWeightKg: 18, carcassCost: 108 });
  if (!result.ok) throw new Error("expected a valid breakdown");
  return result;
}

describe("carcass intake plan", () => {
  it("turns the breakdown into saleable cuts plus a separate processing-loss line", () => {
    const plan = buildIntakePlan(lambBreakdown());

    const saleable = plan.cuts.filter((cut) => !cut.isWaste);
    const loss = plan.cuts.filter((cut) => cut.isWaste);

    expect(saleable.length).toBeGreaterThan(0);
    expect(loss.length).toBe(1);
    // Processing loss is never treated as a saleable cut and carries no cost/product.
    expect(loss[0].productId).toBeNull();
    expect(loss[0].costPerKg).toBeNull();
    expect(plan.processingLossKg).toBeGreaterThan(0);
  });

  it("uses the honest blended real meat cost for every saleable cut and never invents one", () => {
    const breakdown = lambBreakdown();
    const plan = buildIntakePlan(breakdown);

    for (const cut of plan.cuts.filter((c) => !c.isWaste)) {
      expect(cut.costPerKg).toBe(breakdown.blendedCostPerKgSaleable);
    }
    expect(plan.blendedCostPerKg).toBe(breakdown.blendedCostPerKgSaleable);
  });

  it("flags unmapped saleable cuts for review and never auto-assigns a product", () => {
    const breakdown = lambBreakdown();
    const mapping: Record<string, IntakeMapping> = { leg: { productId: "prod-leg" } };
    const plan = buildIntakePlan(breakdown, mapping);

    const leg = plan.cuts.find((cut) => cut.cutId === "leg");
    const shoulder = plan.cuts.find((cut) => cut.cutId === "shoulder");

    expect(leg?.productId).toBe("prod-leg");
    expect(shoulder?.productId).toBeNull(); // not silently filled
    expect(plan.mappedCount).toBe(1);
    expect(plan.unmappedCount).toBeGreaterThan(0);
    expect(plan.stockCount).toBe(1);
  });

  it("builds a preview that matches exactly what will be written", () => {
    const breakdown = lambBreakdown();
    const mapping: Record<string, IntakeMapping> = {
      leg: { productId: "prod-leg", updateCost: true, updatePrice: false },
      shoulder: { productId: "prod-shoulder", updateCost: true, updatePrice: true },
    };
    const plan = buildIntakePlan(breakdown, mapping);
    const preview = buildIntakePreview(plan);

    // Only mapped, saleable, weight > 0 cuts create stock; the loss line is excluded.
    expect(preview.stockLines.map((line) => line.cutId).sort()).toEqual(["leg", "shoulder"]);
    expect(preview.stockLines.some((line) => line.cutId === "waste")).toBe(false);

    // Review lines = mapped-missing saleable cuts.
    expect(preview.reviewLines.length).toBe(plan.unmappedCount);

    // Cost updates follow updateCost; price updates only when explicitly chosen.
    expect(preview.costUpdates.map((c) => c.cutName).sort()).toEqual(["Leg", "Shoulder"]);
    expect(preview.priceUpdates.map((c) => c.cutName)).toEqual(["Shoulder"]);

    // Processing loss is surfaced separately and is positive.
    expect(preview.processingLossKg).toBe(plan.processingLossKg);
  });

  it("shapes RPC cuts with margin as a percentage and waste flagged", () => {
    const plan = buildIntakePlan(lambBreakdown(), { leg: { productId: "prod-leg" } });
    const rpcCuts = toRpcCuts(plan);

    const leg = rpcCuts.find((cut) => cut.cut_id === "leg")!;
    expect(leg.product_id).toBe("prod-leg");
    expect(leg.is_waste).toBe(false);
    expect(leg.margin_pct).toBeGreaterThan(0);
    expect(leg.margin_pct).toBeLessThanOrEqual(100);

    const waste = rpcCuts.find((cut) => cut.cut_id === "waste")!;
    expect(waste.is_waste).toBe(true);
    expect(waste.product_id).toBeNull();
  });
});

describe("intake input validation", () => {
  const base = {
    intakeType: "side",
    receivedWeightKg: 60,
    totalCostGbp: 360,
    receivedAt: "2026-06-02",
    expiryDate: "2026-06-07",
    saleableWeightKg: 50,
  };

  it("accepts a sensible intake", () => {
    expect(validateIntakeInputs(base)).toBeNull();
  });

  it("rejects invalid intake type", () => {
    expect(validateIntakeInputs({ ...base, intakeType: "loin" })).toMatch(/whole, side/i);
  });

  it("rejects zero or negative weight and cost", () => {
    expect(validateIntakeInputs({ ...base, receivedWeightKg: 0 })).toMatch(/weight above 0/i);
    expect(validateIntakeInputs({ ...base, totalCostGbp: 0 })).toMatch(/total amount paid/i);
  });

  it("rejects an intake with no saleable weight", () => {
    expect(validateIntakeInputs({ ...base, saleableWeightKg: 0 })).toMatch(/no saleable cuts/i);
  });

  it("rejects an expiry before the received date", () => {
    expect(validateIntakeInputs({ ...base, expiryDate: "2026-06-01" })).toMatch(/expiry date cannot be before/i);
  });
});
