import { describe, expect, it } from "vitest";

import type { ActionEngineInput } from "./action-types";
import { buildWasteActions } from "./waste-actions";

const baseInput: ActionEngineInput = {
  createdAt: "2026-06-01T12:00:00.000Z",
  expiringStock: [],
  waste: { weekValue: 0, byProduct: [] },
  margin: { worst: [], highestWasteDrag: null },
  customers: { firstTimeCustomers: 0, repeatCustomers: 0, repeatRate: 0 },
  basket: { status: "insufficient_history", realOrderCount: 0, bundleSuggestion: null, topPairings: [] },
  compliance: { rows: [] },
  system: { failedSmsToday: 0, realtimeMode: "websocket" },
};

function withWaste(weekValue: number, byProduct: Array<{ label: string; value: number }>): ActionEngineInput {
  return { ...baseInput, waste: { weekValue, byProduct } };
}

describe("buildWasteActions", () => {
  it("says nothing when there is no waste", () => {
    expect(buildWasteActions(baseInput)).toEqual([]);
  });

  it("names the product when one dominates the week's waste", () => {
    const actions = buildWasteActions(
      withWaste(30, [
        { label: "Beef Diced", value: 22 },
        { label: "Lamb Chops", value: 8 },
      ]),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "waste-beef-diced-reduce-order",
      title: "Beef Diced is costing money",
      group: "money_saving",
    });
  });

  it("surfaces the running total when waste is material but spread out", () => {
    const actions = buildWasteActions(
      withWaste(45, [
        { label: "Beef Diced", value: 15 },
        { label: "Lamb Chops", value: 15 },
        { label: "Chicken Breast", value: 15 },
      ]),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "waste-week-review",
      title: "Waste is adding up this week",
      severity: "info",
    });
    expect(actions[0]?.explanation).toContain("3 products");
    // Diffuse guidance must never leak a percent sign onto the operator surface.
    expect(actions[0]?.title).not.toContain("%");
    expect(actions[0]?.recommendedAction).not.toContain("%");
  });

  it("stays quiet when spread waste is small enough to be normal trade", () => {
    const actions = buildWasteActions(
      withWaste(12, [
        { label: "Beef Diced", value: 6 },
        { label: "Lamb Chops", value: 6 },
      ]),
    );
    expect(actions).toEqual([]);
  });

  it("does not fire the diffuse rule for a single material product (concentration wins)", () => {
    const actions = buildWasteActions(withWaste(40, [{ label: "Beef Diced", value: 40 }]));
    expect(actions[0]?.id).toBe("waste-beef-diced-reduce-order");
  });
});
