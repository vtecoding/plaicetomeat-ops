import { z } from "zod";

// Physical sanity bounds for temperature entry. These match the DB-side guard in
// record_compliance_reading: out-of-safe-range temps are still recordable (so a
// breach can be logged honestly); only physically-implausible typos are rejected.
export const COMPLIANCE_TEMP_MIN_C = -50;
export const COMPLIANCE_TEMP_MAX_C = 50;

export const COMPLIANCE_READING_TYPES = ["opening", "midday", "closing", "ad_hoc"] as const;

const tempField = z
  .number({ message: "Enter a temperature." })
  .min(COMPLIANCE_TEMP_MIN_C, { message: "Temperature is out of range." })
  .max(COMPLIANCE_TEMP_MAX_C, { message: "Temperature is out of range." });

export const complianceReadingSchema = z.object({
  branchId: z.string().uuid({ message: "A valid branch is required." }),
  readingType: z.enum(COMPLIANCE_READING_TYPES, { message: "Choose a reading type." }),
  chillerTempC: tempField,
  freezerTempC: tempField,
  displayTempC: tempField.nullable().optional(),
});

export type ComplianceReadingInput = z.infer<typeof complianceReadingSchema>;

export const complianceCompletionSchema = z.object({
  branchId: z.string().uuid({ message: "A valid branch is required." }),
  cleaningCompleted: z.boolean(),
  sanitisationCompleted: z.boolean(),
  wasteChecked: z.boolean(),
  notes: z.string().max(2000).nullable().optional(),
});

export type ComplianceCompletionInput = z.infer<typeof complianceCompletionSchema>;
