import { describe, expect, it } from "vitest";

import { getChecklist } from "./checklists";
import { buildReceipt, latestEventByStep, stockVarianceKg, summariseChecklist } from "./progress";
import type { OpsEvent } from "./types";

function event(stepKey: string, state: OpsEvent["state"], createdAt: string, payload: Record<string, unknown> = {}): OpsEvent {
  return { id: `${stepKey}-${createdAt}`, stepKey, state, payload, createdAt };
}

const opening = getChecklist("opening");

describe("latestEventByStep", () => {
  it("keeps the most recent event per step (append-only → current state)", () => {
    const events = [
      event("fridge_temp", "skipped", "2026-06-04T08:00:00Z"),
      event("fridge_temp", "done", "2026-06-04T08:05:00Z", { value: 3 }),
    ];
    const latest = latestEventByStep(events);
    expect(latest.get("fridge_temp")?.state).toBe("done");
    expect(latest.get("fridge_temp")?.payload).toEqual({ value: 3 });
  });
});

describe("summariseChecklist (resume)", () => {
  it("an empty session points at the first step and nothing handled", () => {
    const summary = summariseChecklist(opening, []);
    expect(summary.handledCount).toBe(0);
    expect(summary.totalCount).toBe(opening.steps.length);
    expect(summary.nextStepKey).toBe(opening.steps[0].key);
    expect(summary.allHandled).toBe(false);
  });

  it("resumes at the first un-recorded step after a refresh", () => {
    // First two steps handled (one done, one skipped) → resume at the third.
    const events = [
      event(opening.steps[0].key, "done", "2026-06-04T08:00:00Z"),
      event(opening.steps[1].key, "skipped", "2026-06-04T08:01:00Z"),
    ];
    const summary = summariseChecklist(opening, events);
    expect(summary.handledCount).toBe(2);
    expect(summary.nextStepKey).toBe(opening.steps[2].key);
    expect(summary.allHandled).toBe(false);
  });

  it("reports all handled when every step has an event", () => {
    const events = opening.steps.map((step, i) => event(step.key, "done", `2026-06-04T08:0${i}:00Z`));
    const summary = summariseChecklist(opening, events);
    expect(summary.allHandled).toBe(true);
    expect(summary.nextStepKey).toBeNull();
    expect(summary.handledCount).toBe(opening.steps.length);
  });

  it("counts a skipped step as handled but keeps its real state", () => {
    const events = [event(opening.steps[0].key, "skipped", "2026-06-04T08:00:00Z")];
    const summary = summariseChecklist(opening, events);
    expect(summary.steps[0].state).toBe("skipped");
    expect(summary.handledCount).toBe(1);
  });
});

describe("buildReceipt", () => {
  it("renders recorded number payloads with their unit, and preserves skipped state", () => {
    const events = [
      event("fridge_temp", "done", "2026-06-04T08:00:00Z", { value: 3.5 }),
      event("float_ready", "done", "2026-06-04T08:01:00Z", { value: 120 }),
      event("display_ready", "skipped", "2026-06-04T08:02:00Z"),
    ];
    const receipt = buildReceipt(opening, events, "today at 8:02am");

    const fridge = receipt.lines.find((l) => l.title.includes("fridge"));
    const float = receipt.lines.find((l) => l.title.includes("float"));
    const display = receipt.lines.find((l) => l.title.includes("Counter and display"));

    expect(fridge?.detail).toBe("3.5 °C");
    expect(float?.detail).toBe("£120.00");
    expect(display?.state).toBe("skipped");
    expect(receipt.handledCount).toBe(3);
    expect(receipt.completedAtLabel).toBe("today at 8:02am");
  });

  it("keeps legacy receipts readable while carrying new definition metadata", () => {
    const legacy = buildReceipt(opening, [event("fridge_temp", "done", "2026-06-04T08:00:00Z", { value: 3.5 })], "today");
    expect(legacy.sessionId).toBeNull();
    expect(legacy.definitionVersion).toBeNull();
    expect(legacy.lines[0].detail).toContain("3.5");
    expect(legacy.lines[0].detail).toContain("C");

    const receipt = buildReceipt(opening, [], "today", {
      sessionId: "session-1",
      definitionKey: "opening",
      definitionVersion: 1,
      actorId: "actor-1",
      branchId: "branch-1",
      completedAt: "2026-06-04T08:00:00Z",
    });

    expect(receipt.sessionId).toBe("session-1");
    expect(receipt.definitionKey).toBe("opening");
    expect(receipt.definitionVersion).toBe(1);
    expect(receipt.actorId).toBe("actor-1");
    expect(receipt.branchId).toBe("branch-1");
    expect(receipt.completedAt).toBe("2026-06-04T08:00:00Z");
  });
});

describe("stockVarianceKg", () => {
  it("is counted minus system, rounded to grams", () => {
    expect(stockVarianceKg(10, 8)).toBe(-2);
    expect(stockVarianceKg(8, 10)).toBe(2);
    expect(stockVarianceKg(10, 10)).toBe(0);
    expect(stockVarianceKg(10, 9.4995)).toBe(-0.501);
  });
});
