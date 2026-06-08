import { describe, expect, it } from "vitest";

import { complianceCompletionSchema, complianceReadingSchema } from "@/lib/validation/compliance";

const BRANCH = "00000000-0000-4000-8000-000000000001";

describe("complianceReadingSchema", () => {
  it("accepts a valid reading", () => {
    const r = complianceReadingSchema.safeParse({
      branchId: BRANCH,
      readingType: "opening",
      chillerTempC: 3.2,
      freezerTempC: -18.5,
      displayTempC: 4,
    });
    expect(r.success).toBe(true);
  });

  it("allows display temp to be omitted/null", () => {
    const r = complianceReadingSchema.safeParse({
      branchId: BRANCH,
      readingType: "closing",
      chillerTempC: 3,
      freezerTempC: -18,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown reading type", () => {
    const r = complianceReadingSchema.safeParse({ branchId: BRANCH, readingType: "midnight", chillerTempC: 3, freezerTempC: -18 });
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range temperatures", () => {
    expect(complianceReadingSchema.safeParse({ branchId: BRANCH, readingType: "opening", chillerTempC: 999, freezerTempC: -18 }).success).toBe(false);
    expect(complianceReadingSchema.safeParse({ branchId: BRANCH, readingType: "opening", chillerTempC: 3, freezerTempC: -200 }).success).toBe(false);
  });

  it("rejects a non-uuid branch", () => {
    expect(complianceReadingSchema.safeParse({ branchId: "nope", readingType: "opening", chillerTempC: 3, freezerTempC: -18 }).success).toBe(false);
  });
});

describe("complianceCompletionSchema", () => {
  it("accepts a full completion payload", () => {
    const r = complianceCompletionSchema.safeParse({
      branchId: BRANCH,
      cleaningCompleted: true,
      sanitisationCompleted: true,
      wasteChecked: true,
      notes: null,
    });
    expect(r.success).toBe(true);
  });

  it("requires boolean checks", () => {
    const r = complianceCompletionSchema.safeParse({
      branchId: BRANCH,
      cleaningCompleted: "yes",
      sanitisationCompleted: true,
      wasteChecked: true,
    });
    expect(r.success).toBe(false);
  });
});
