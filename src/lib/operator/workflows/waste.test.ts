import { describe, expect, it } from "vitest";

import { wasteReasonLabel } from "./waste";

describe("operator waste workflow helpers", () => {
  it("keeps reason labels plain", () => {
    expect(wasteReasonLabel("expired")).toBe("Expired");
    expect(wasteReasonLabel("review")).toBe("Other / not sure");
    expect(wasteReasonLabel(undefined)).toBe("Other / not sure");
  });
});
