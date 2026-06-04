import { describe, expect, it } from "vitest";

import { buildDayShape } from "./day";
import type { OwnerDecision } from "./types";

function decision(id: string, category: OwnerDecision["category"]): OwnerDecision {
  return {
    id,
    category,
    priority: 100,
    title: `Decision ${id}`,
    whatHappened: "",
    whyItMatters: "",
    recommendedAction: "",
    estimatedImpact: { kind: "none", label: "Hard to put a figure on yet" },
    owner: "You / Owner",
    dueWindow: category === "urgent" ? "today" : "this_week",
    sourceEvidence: { basis: { confidence: "high", summary: "", points: [] }, metrics: [] },
    playbook: null,
  };
}

describe("buildDayShape", () => {
  it("reports a clear day when nothing is urgent or important", () => {
    const shape = buildDayShape({ urgent: [], important: [] });
    expect(shape.allClear).toBe(true);
    expect(shape.needsYouCount).toBe(0);
    expect(shape.steps).toHaveLength(0);
    expect(shape.estimateMinutes).toBe(0);
    expect(shape.timeLabel).toBeNull();
    expect(shape.headline).toBe("Nothing needs you — you're clear to trade.");
  });

  it("walks urgent before important", () => {
    const shape = buildDayShape({
      urgent: [decision("u1", "urgent"), decision("u2", "urgent")],
      important: [decision("i1", "important")],
    });
    expect(shape.steps.map((s) => s.id)).toEqual(["u1", "u2", "i1"]);
    expect(shape.needsYouCount).toBe(3);
    expect(shape.allClear).toBe(false);
  });

  it("pluralises a single thing and uses a friendly short estimate", () => {
    const shape = buildDayShape({ urgent: [decision("u1", "urgent")], important: [] });
    // 1 urgent = 3 min, rounded up to a 5-minute floor → "a few minutes".
    expect(shape.estimateMinutes).toBe(5);
    expect(shape.timeLabel).toBe("a few minutes");
    expect(shape.headline).toBe("1 thing needs you today — a few minutes.");
  });

  it("rounds a longer day to the nearest 5 minutes", () => {
    // 4 urgent (12) + 3 important (6) = 18 → rounds to 20.
    const shape = buildDayShape({
      urgent: [decision("u1", "urgent"), decision("u2", "urgent"), decision("u3", "urgent"), decision("u4", "urgent")],
      important: [decision("i1", "important"), decision("i2", "important"), decision("i3", "important")],
    });
    expect(shape.estimateMinutes).toBe(20);
    expect(shape.timeLabel).toBe("about 20 minutes");
    expect(shape.headline).toBe("7 things need you today — about 20 minutes.");
  });

  it("never reports zero minutes for real work", () => {
    const shape = buildDayShape({ urgent: [], important: [decision("i1", "important")] });
    expect(shape.estimateMinutes).toBe(5);
    expect(shape.timeLabel).toBe("a few minutes");
  });
});
