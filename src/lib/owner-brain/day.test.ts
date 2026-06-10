import { describe, expect, it } from "vitest";

import { buildDayShape } from "./day";
import type { OperatorAction } from "./types";

/** A minimal operator action — buildDayShape only reads `id` and the list length. */
function action(id: string): OperatorAction {
  return {
    id,
    actionType: "count",
    title: `Action ${id}`,
    whatHappened: "",
    whyItMatters: "",
    recommendedAction: "",
    reason: "",
    impactLabel: "Hard to put a figure on yet",
    impactTone: "none",
    owner: "You / Owner",
    dueLabel: "Today",
    destination: "/admin/stock-count",
    entityLabel: null,
    href: "/admin/stock-count",
    basisSummary: "",
    supportingFacts: [],
    playbook: null,
    completion: "available",
  };
}

describe("buildDayShape", () => {
  it("reports a clear day when there are no steps", () => {
    const shape = buildDayShape([]);
    expect(shape.allClear).toBe(true);
    expect(shape.needsYouCount).toBe(0);
    expect(shape.steps).toHaveLength(0);
    expect(shape.estimateMinutes).toBe(0);
    expect(shape.timeLabel).toBeNull();
    expect(shape.headline).toBe("Nothing needs you — you're clear to trade.");
  });

  it("walks the steps in the order given", () => {
    const shape = buildDayShape([action("a1"), action("a2"), action("a3")]);
    expect(shape.steps.map((s) => s.id)).toEqual(["a1", "a2", "a3"]);
    expect(shape.needsYouCount).toBe(3);
    expect(shape.allClear).toBe(false);
  });

  it("pluralises a single thing and uses a friendly short estimate", () => {
    const shape = buildDayShape([action("a1")]);
    // 1 step = 3 min, rounded up to a 5-minute floor → "a few minutes".
    expect(shape.estimateMinutes).toBe(5);
    expect(shape.timeLabel).toBe("a few minutes");
    expect(shape.headline).toBe("1 thing needs you today — a few minutes.");
  });

  it("rounds a longer day to the nearest 5 minutes", () => {
    // 7 steps × 3 min = 21 → rounds to 20.
    const shape = buildDayShape(Array.from({ length: 7 }, (_, i) => action(`a${i}`)));
    expect(shape.estimateMinutes).toBe(20);
    expect(shape.timeLabel).toBe("about 20 minutes");
    expect(shape.headline).toBe("7 things need you today — about 20 minutes.");
  });

  it("never reports zero minutes for real work", () => {
    const shape = buildDayShape([action("a1")]);
    expect(shape.estimateMinutes).toBe(5);
    expect(shape.timeLabel).toBe("a few minutes");
  });
});
