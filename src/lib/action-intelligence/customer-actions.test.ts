import { describe, expect, it } from "vitest";

import type { ActionEngineInput } from "./action-types";
import { buildCustomerActions } from "./customer-actions";

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

function withCustomers(firstTimeCustomers: number, repeatCustomers: number, repeatRate: number): ActionEngineInput {
  return { ...baseInput, customers: { firstTimeCustomers, repeatCustomers, repeatRate } };
}

describe("buildCustomerActions", () => {
  it("says nothing without any customers", () => {
    expect(buildCustomerActions(baseInput)).toEqual([]);
  });

  it("fires when repeat custom is exactly zero across a meaningful sample", () => {
    const actions = buildCustomerActions(withCustomers(5, 0, 0));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("customer-repeat-rate-follow-up");
  });

  it("fires on a low but non-zero repeat rate (the de-brittled case)", () => {
    const actions = buildCustomerActions(withCustomers(48, 2, 4));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("Recent customers have not returned");
    // repeatRate is internal only — it must never reach an operator-facing string.
    expect(actions[0]?.explanation).not.toContain("%");
    expect(actions[0]?.recommendedAction).not.toContain("%");
  });

  it("stays quiet when plenty of customers are returning", () => {
    expect(buildCustomerActions(withCustomers(10, 20, 67))).toEqual([]);
  });

  it("stays quiet on too small a sample to mean anything", () => {
    expect(buildCustomerActions(withCustomers(1, 0, 0))).toEqual([]);
  });
});
