import { describe, expect, it } from "vitest";

import { buildHelpSummary, helpProblemLabel, helpProblemSeverity } from "./help";

describe("operator help workflow helpers", () => {
  it("keeps problem labels plain", () => {
    expect(helpProblemLabel("fridge")).toBe("Fridge or freezer problem");
    expect(helpProblemLabel("ran_out")).toBe("Ran out of something");
    expect(helpProblemLabel(undefined)).toBe("Something else");
    expect(helpProblemLabel("nonsense")).toBe("Something else");
  });

  it("treats a fridge problem as urgent and everything else as a heads-up", () => {
    expect(helpProblemSeverity("fridge")).toBe("critical");
    expect(helpProblemSeverity("equipment")).toBe("warning");
    expect(helpProblemSeverity(undefined)).toBe("warning");
  });

  it("builds a plain owner summary, with and without a note", () => {
    expect(buildHelpSummary("fridge")).toBe("Help from the shop: Fridge or freezer problem.");
    expect(buildHelpSummary("ran_out", "no lamb left")).toBe(
      'Help from the shop: Ran out of something. "no lamb left"',
    );
    expect(buildHelpSummary("other", "   ")).toBe("Help from the shop: Something else.");
  });
});
