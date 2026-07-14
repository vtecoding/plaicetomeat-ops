import { describe, expect, it } from "vitest";

import { buildHelpSummary, helpOperationEntityRef, helpProblemLabel, helpProblemSeverity, isHelpOperationId } from "./help";

describe("operator help workflow helpers", () => {
  it("keeps problem labels plain", () => {
    expect(helpProblemLabel("fridge")).toBe("Fridge or freezer problem");
    expect(helpProblemLabel("ran_out")).toBe("Ran out of something");
    expect(helpProblemLabel(undefined)).toBe("Something else");
    expect(helpProblemLabel("nonsense")).toBe("Something else");
  });

  it("treats fridge and equipment problems as urgent external interrupts", () => {
    expect(helpProblemSeverity("fridge")).toBe("critical");
    expect(helpProblemSeverity("equipment")).toBe("critical");
    expect(helpProblemSeverity(undefined)).toBe("warning");
  });

  it("builds a plain owner summary, with and without a note", () => {
    expect(buildHelpSummary("fridge")).toBe("Help from the shop: Fridge or freezer problem.");
    expect(buildHelpSummary("ran_out", "no lamb left")).toBe(
      'Help from the shop: Ran out of something. "no lamb left"',
    );
    expect(buildHelpSummary("other", "   ")).toBe("Help from the shop: Something else.");
    expect(buildHelpSummary("mistake", "wrong weight")).toBe(
      'Help from the shop: I made a mistake just now. "wrong weight"',
    );
  });

  it("uses a validated stable operation reference for replay-safe help", () => {
    const operationId = "d9428888-122b-4c21-bc86-1889a335f7f1";
    expect(isHelpOperationId(operationId)).toBe(true);
    expect(isHelpOperationId("not-a-uuid")).toBe(false);
    expect(helpOperationEntityRef(operationId)).toBe(`operator-help:${operationId}`);
  });
});
