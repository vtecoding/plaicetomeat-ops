import type { ComplianceLog, ComplianceReading } from "./types";

export function validateComplianceCompletion(log: ComplianceLog, readings: ComplianceReading[]) {
  const errors: string[] = [];

  if (!readings.some((reading) => reading.readingType === "opening")) {
    errors.push("Add at least one opening temperature reading.");
  }

  if (!readings.some((reading) => reading.readingType === "closing")) {
    errors.push("Add at least one closing temperature reading.");
  }

  if (!log.cleaningCompleted) {
    errors.push("Cleaning must be completed.");
  }

  if (!log.sanitisationCompleted) {
    errors.push("Sanitisation must be completed.");
  }

  if (!log.wasteChecked) {
    errors.push("Waste check must be completed.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
