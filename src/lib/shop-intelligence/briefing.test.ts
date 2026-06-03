import { describe, expect, it } from "vitest";

import { buildDailyBriefing } from "./briefing";
import type { Finding } from "./types";

function finding(over: Partial<Finding>): Finding {
  return {
    id: "f",
    area: "stock",
    finding: "Something",
    severity: "warning",
    explanation: "",
    consequence: "",
    recommendedAction: "",
    confidence: "medium",
    basis: { confidence: "medium", summary: "", points: [] },
    playbook: null,
    metrics: [],
    source: "engine",
    ...over,
  };
}

describe("buildDailyBriefing (V8.3)", () => {
  it("greets by time of day", () => {
    expect(buildDailyBriefing([], new Date("2026-06-03T08:00:00Z")).greeting).toBe("Good morning.");
    expect(buildDailyBriefing([], new Date("2026-06-03T14:00:00Z")).greeting).toBe("Good afternoon.");
    expect(buildDailyBriefing([], new Date("2026-06-03T19:00:00Z")).greeting).toBe("Good evening.");
  });

  it("counts only warning/urgent findings as things to do", () => {
    const briefing = buildDailyBriefing(
      [
        finding({ id: "a", severity: "urgent", finding: "Cert expired" }),
        finding({ id: "b", severity: "warning", finding: "Stock low" }),
        finding({ id: "c", severity: "info", finding: "Add costs" }),
      ],
      new Date("2026-06-03T08:00:00Z"),
    );
    expect(briefing.actionCount).toBe(2);
    expect(briefing.headline).toBe("2 things need your attention today.");
    expect(briefing.items.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("uses singular phrasing for one item", () => {
    const briefing = buildDailyBriefing([finding({ severity: "urgent" })], new Date("2026-06-03T08:00:00Z"));
    expect(briefing.headline).toBe("1 thing needs your attention today.");
  });

  it("reassures and mentions counter work when nothing is wrong", () => {
    const briefing = buildDailyBriefing([finding({ severity: "info" })], new Date("2026-06-03T08:00:00Z"), {
      orders: { awaitingPrep: 2, ready: 1 },
    });
    expect(briefing.actionCount).toBe(0);
    expect(briefing.headline).toContain("3 orders");
    expect(briefing.reassurance).toContain("Keep an eye");
  });

  it("respects the limit but keeps the full count", () => {
    const many = Array.from({ length: 8 }, (_, i) => finding({ id: `f${i}`, severity: "warning" }));
    const briefing = buildDailyBriefing(many, new Date("2026-06-03T08:00:00Z"), { limit: 3 });
    expect(briefing.items).toHaveLength(3);
    expect(briefing.actionCount).toBe(8);
  });

  it("offers calm reassurance when nothing is an emergency", () => {
    const briefing = buildDailyBriefing([finding({ severity: "warning" })], new Date("2026-06-03T08:00:00Z"));
    expect(briefing.reassurance).toContain("emergencies");
  });

  it("gives no soft reassurance when something is urgent", () => {
    const briefing = buildDailyBriefing([finding({ severity: "urgent" })], new Date("2026-06-03T08:00:00Z"));
    expect(briefing.reassurance).toBeNull();
  });
});
