import { describe, expect, it } from "vitest";

import { buildOwnerActions } from "./action-engine";
import type { ActionEngineInput } from "./action-types";

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

describe("action engine", () => {
  it("emits only metric-backed deterministic actions", () => {
    const actions = buildOwnerActions({
      ...baseInput,
      expiringStock: [{ productName: "Beef Diced", remainingWeightKg: 2, valueAtRisk: 10, daysToExpiry: 2 }],
      waste: { weekValue: 10, byProduct: [{ label: "Beef Diced", value: 10 }] },
    });

    expect(actions.map((action) => action.id)).toContain("stock-beef-diced-2");
    expect(actions.map((action) => action.id)).toContain("waste-beef-diced-reduce-order");
    expect(actions.every((action) => Object.keys(action.sourceMetrics).length > 0)).toBe(true);
  });

  it("marks expired certificates as urgent", () => {
    const actions = buildOwnerActions({
      ...baseInput,
      compliance: { rows: [{ supplierName: "Halal Co", daysToExpiry: -1, band: "expired" }] },
    });

    expect(actions[0]).toMatchObject({
      severity: "urgent",
      group: "urgent",
      title: "Halal Co certificate is expired",
    });
  });
});
