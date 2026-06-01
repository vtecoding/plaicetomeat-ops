import { describe, expect, it } from "vitest";

import { buildSeasonalActions } from "./seasonal-actions";
import type { ActionEngineInput } from "./action-types";
import { getActiveSeasonalEvents } from "./seasonal-calendar";

function inputAt(iso: string): ActionEngineInput {
  return {
    createdAt: iso,
    expiringStock: [],
    waste: { weekValue: 0, byProduct: [] },
    margin: { worst: [], highestWasteDrag: null },
    customers: { firstTimeCustomers: 0, repeatCustomers: 0, repeatRate: 0 },
    basket: { status: "insufficient_history", realOrderCount: 0, bundleSuggestion: null, topPairings: [] },
    compliance: { rows: [] },
    system: { failedSmsToday: 0, realtimeMode: "websocket" },
  };
}

describe("seasonal calendar", () => {
  it("is quiet when no peak day is within its lead window", () => {
    // Early June: the next event (Christmas) is ~200 days away, well outside lead time.
    expect(getActiveSeasonalEvents(new Date("2026-06-01T09:00:00.000Z"))).toHaveLength(0);
  });

  it("opens the prep window once an event is within lead days", () => {
    const active = getActiveSeasonalEvents(new Date("2026-12-10T09:00:00.000Z"));
    expect(active.map((event) => event.id)).toContain("christmas-2026");
    expect(active[0]?.daysUntil).toBe(14);
  });

  it("never surfaces a day that has already passed", () => {
    const active = getActiveSeasonalEvents(new Date("2026-12-26T09:00:00.000Z"));
    expect(active.map((event) => event.id)).not.toContain("christmas-2026");
  });

  it("sorts overlapping events soonest-first", () => {
    // 23 Dec 2026: Christmas (tomorrow) and New Year (8 days) are both in-window.
    const active = getActiveSeasonalEvents(new Date("2026-12-23T09:00:00.000Z"));
    expect(active.map((event) => event.id)).toEqual(["christmas-2026", "new-year-2026"]);
  });
});

describe("seasonal actions", () => {
  it("produces no actions outside any prep window", () => {
    expect(buildSeasonalActions(inputAt("2026-06-01T12:00:00.000Z"))).toHaveLength(0);
  });

  it("escalates to urgent in the final three days", () => {
    const [action] = buildSeasonalActions(inputAt("2026-12-22T08:00:00.000Z"));
    expect(action).toMatchObject({
      id: "seasonal-christmas-2026",
      group: "urgent",
      severity: "urgent",
      confidence: "high",
    });
    expect(action?.title).toBe("Christmas is in 2 days");
  });

  it("treats a fixed event further out as a money-making heads-up", () => {
    const [action] = buildSeasonalActions(inputAt("2026-12-10T08:00:00.000Z"));
    expect(action).toMatchObject({ group: "money_saving", severity: "info" });
    expect(action?.title).toBe("Christmas is in 14 days");
  });

  it("flags moon-dependent Islamic dates as estimated with medium confidence", () => {
    const [action] = buildSeasonalActions(inputAt("2027-04-20T08:00:00.000Z"));
    expect(action?.id).toBe("seasonal-eid-al-adha-2027");
    expect(action?.confidence).toBe("medium");
    expect(action?.explanation).toContain("estimated — confirm the exact day locally");
  });

  it("uses friendly countdown wording on the day and the day before", () => {
    expect(buildSeasonalActions(inputAt("2026-12-24T08:00:00.000Z"))[0]?.title).toBe("Christmas is today");
    expect(buildSeasonalActions(inputAt("2026-12-23T08:00:00.000Z"))[0]?.title).toBe("Christmas is tomorrow");
  });
});
