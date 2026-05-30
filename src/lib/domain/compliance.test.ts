import { describe, expect, it } from "vitest";

import type { ComplianceLog, ComplianceReading } from "./types";
import { validateComplianceCompletion } from "./compliance";

const completeLog: ComplianceLog = {
  id: "log-1",
  branchId: "branch-1",
  logDate: "2026-05-29",
  cleaningCompleted: true,
  sanitisationCompleted: true,
  wasteChecked: true,
  status: "open",
};

const readings: ComplianceReading[] = [
  {
    id: "reading-1",
    complianceLogId: "log-1",
    readingType: "opening",
    chillerTempC: 3.4,
    freezerTempC: -18.1,
    displayTempC: 4.2,
    recordedAt: "2026-05-29T08:00:00.000Z",
  },
  {
    id: "reading-2",
    complianceLogId: "log-1",
    readingType: "closing",
    chillerTempC: 3.8,
    freezerTempC: -18.5,
    displayTempC: 4.4,
    recordedAt: "2026-05-29T18:00:00.000Z",
  },
];

describe("compliance completion", () => {
  it("accepts a complete daily log", () => {
    expect(validateComplianceCompletion(completeLog, readings)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects missing closing reading and checklist booleans", () => {
    const result = validateComplianceCompletion(
      {
        ...completeLog,
        cleaningCompleted: false,
      },
      readings.filter((reading) => reading.readingType !== "closing"),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Add at least one closing temperature reading.");
    expect(result.errors).toContain("Cleaning must be completed.");
  });
});
