import "server-only";

import { healthy, noData, unavailable, type DataResult } from "@/lib/domain/data-result";
import type { ComplianceLog, ComplianceReading, ComplianceReadingType } from "@/lib/domain/types";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type ComplianceDay = {
  log: ComplianceLog | null;
  readings: ComplianceReading[];
};

type LogRow = {
  id: string;
  branch_id: string;
  log_date: string;
  cleaning_completed: boolean | null;
  sanitisation_completed: boolean | null;
  waste_checked: boolean | null;
  status: "open" | "completed" | null;
};

type ReadingRow = {
  id: string;
  compliance_log_id: string;
  reading_type: ComplianceReadingType;
  chiller_temp_c: string | number;
  freezer_temp_c: string | number;
  display_temp_c: string | number | null;
  recorded_at: string;
};

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function mapLog(row: LogRow): ComplianceLog {
  return {
    id: row.id,
    branchId: row.branch_id,
    logDate: row.log_date,
    cleaningCompleted: row.cleaning_completed ?? false,
    sanitisationCompleted: row.sanitisation_completed ?? false,
    wasteChecked: row.waste_checked ?? false,
    status: row.status ?? "open",
  };
}

function mapReading(row: ReadingRow): ComplianceReading {
  return {
    id: row.id,
    complianceLogId: row.compliance_log_id,
    readingType: row.reading_type,
    chillerTempC: toNumber(row.chiller_temp_c),
    freezerTempC: toNumber(row.freezer_temp_c),
    displayTempC: row.display_temp_c === null ? null : toNumber(row.display_temp_c),
    recordedAt: row.recorded_at,
  };
}

/**
 * Load today's compliance log + readings for a branch as an honest DataResult.
 * No demo fallback: an unconfigured/erroring environment returns UNAVAILABLE, and
 * a day with no log yet returns NO_DATA — never fabricated temperature evidence.
 */
export async function getComplianceDayResult(branchId: string, now = new Date()): Promise<DataResult<ComplianceDay>> {
  if (!hasSupabaseServiceEnv()) {
    return unavailable("Compliance records are unavailable until Supabase is configured.");
  }

  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const supabase = createSupabaseServiceClient();

  const { data: logRows, error: logError } = await supabase
    .from("compliance_logs")
    .select("id, branch_id, log_date, cleaning_completed, sanitisation_completed, waste_checked, status")
    .eq("branch_id", branchId)
    .eq("log_date", today)
    .limit(1);

  if (logError) {
    return unavailable("Compliance records are temporarily unavailable.", [logError.message]);
  }

  const log = (logRows as LogRow[])[0] ? mapLog((logRows as LogRow[])[0]) : null;

  if (!log) {
    return noData({ log: null, readings: [] }, "No temperature readings recorded yet today.");
  }

  const { data: readingRows, error: readingError } = await supabase
    .from("compliance_readings")
    .select("id, compliance_log_id, reading_type, chiller_temp_c, freezer_temp_c, display_temp_c, recorded_at")
    .eq("compliance_log_id", log.id)
    .order("recorded_at", { ascending: true });

  if (readingError) {
    return unavailable("Compliance records are temporarily unavailable.", [readingError.message]);
  }

  return healthy({ log, readings: (readingRows as ReadingRow[]).map(mapReading) });
}
