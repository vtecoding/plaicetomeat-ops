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

type Lapsed = NonNullable<ActionEngineInput["customers"]["lapsedRegulars"]>[number];

function withLapsed(lapsedRegulars: Lapsed[], aggregate?: { firstTimeCustomers: number; repeatCustomers: number; repeatRate: number }): ActionEngineInput {
  return {
    ...baseInput,
    customers: { ...(aggregate ?? { firstTimeCustomers: 0, repeatCustomers: 0, repeatRate: 0 }), lapsedRegulars },
  };
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

  it("emits a named win-back action per lapsed regular, with basket value and favourite attached", () => {
    const actions = buildCustomerActions(
      withLapsed([{ customerName: "Aisha", averageOrderValue: 47, daysSinceLastOrder: 28, orders: 6, favouriteProduct: "Lamb Shoulder" }]),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "customer-winback-aisha-0",
      title: "Win back Aisha",
      category: "customer",
      group: "customer_growth",
    });
    expect(actions[0]?.explanation).toContain("4 weeks");
    expect(actions[0]?.explanation).toContain("They usually buy Lamb Shoulder.");
    expect(actions[0]?.estimatedImpact).toContain("£47");
    expect(actions[0]?.recommendedAction).toBe("Call or message Aisha with a return offer.");
  });

  it("omits the favourite line when there is no item history", () => {
    const actions = buildCustomerActions(
      withLapsed([{ customerName: "Bilal", averageOrderValue: 30, daysSinceLastOrder: 21, orders: 4 }]),
    );
    expect(actions[0]?.explanation).not.toContain("They usually buy");
  });

  it("prefers named win-backs over the aggregate nudge", () => {
    const actions = buildCustomerActions(
      withLapsed([{ customerName: "Bilal", averageOrderValue: 30, daysSinceLastOrder: 21, orders: 4 }], {
        firstTimeCustomers: 20,
        repeatCustomers: 0,
        repeatRate: 0,
      }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("customer-winback-bilal-0");
  });

  it("caps win-back actions at three even with more lapsed regulars", () => {
    const lapsed = Array.from({ length: 5 }, (_, index) => ({
      customerName: `Regular ${index}`,
      averageOrderValue: 25,
      daysSinceLastOrder: 30,
      orders: 4,
    }));
    expect(buildCustomerActions(withLapsed(lapsed))).toHaveLength(3);
  });
});
