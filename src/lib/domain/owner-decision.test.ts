import { describe, expect, it } from "vitest";

import { ALERT_KIND_LIST, alertSpecFor } from "./alert-registry";
import { toOwnerDecisionCopy } from "./owner-decision";

describe("owner decision projection", () => {
  it.each(ALERT_KIND_LIST)("gives %s the four plain decision answers", (kind) => {
    const spec = alertSpecFor(kind);
    const decision = toOwnerDecisionCopy({
      kind,
      summary: "A shop fact needs checking.",
      severity: "warning",
      action: spec.action,
    });

    expect(decision.problem).toBe("A shop fact needs checking.");
    expect(decision.whyItMatters.length).toBeGreaterThan(10);
    expect(decision.recommendation.length).toBeGreaterThan(10);
    expect(decision.ifIgnored.length).toBeGreaterThan(10);
    expect(Object.values(decision).join(" ")).not.toMatch(/rpc|json|schema|confidence score|algorithm/i);
  });

  it("makes critical consequences visibly stronger", () => {
    const warning = toOwnerDecisionCopy({ kind: "operator_help", summary: "Help needed.", severity: "warning", action: "note-resolve" });
    const critical = toOwnerDecisionCopy({ kind: "operator_help", summary: "Help needed.", severity: "critical", action: "note-resolve" });

    expect(critical.whyItMatters).not.toBe(warning.whyItMatters);
    expect(critical.ifIgnored).toContain("could get worse");
  });
});
