export type OwnerAwayAggregates = {
  orderCount: number;
  revenue: number;
  deliveryCount: number;
  deliveredKg: number;
  wasteCount: number;
  wasteKg: number;
  saleKg: number;
  serveCount: number;
  deliveryWorkflowCount: number;
  wasteWorkflowCount: number;
  certificateWorkflowCount: number;
  evidenceTotal: number;
  evidenceNeedsReview: number;
  evidenceFailed: number;
  certificateCaptured: number;
  certificateNeedsReview: number;
  openAlertCount: number;
  criticalAlertCount: number;
};

export const EMPTY_OWNER_AWAY_AGGREGATES: OwnerAwayAggregates = {
  orderCount: 0, revenue: 0, deliveryCount: 0, deliveredKg: 0,
  wasteCount: 0, wasteKg: 0, saleKg: 0, serveCount: 0,
  deliveryWorkflowCount: 0, wasteWorkflowCount: 0, certificateWorkflowCount: 0,
  evidenceTotal: 0, evidenceNeedsReview: 0, evidenceFailed: 0,
  certificateCaptured: 0, certificateNeedsReview: 0,
  openAlertCount: 0, criticalAlertCount: 0,
};

type ClockParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function clockParts(at: Date, timeZone: string): ClockParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** UTC instant at midnight for the branch-local calendar day containing `at`. */
export function branchLocalDayStartIso(at: Date, timeZone: string): string {
  const day = clockParts(at, timeZone);
  const targetLocalStamp = Date.UTC(day.year, day.month - 1, day.day);
  let candidate = targetLocalStamp;

  // Resolve the IANA offset at the target local wall time. Iteration handles an
  // offset that differs between the initial UTC guess and local midnight.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = clockParts(new Date(candidate), timeZone);
    const representedLocalStamp = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const delta = representedLocalStamp - targetLocalStamp;
    if (delta === 0) break;
    candidate -= delta;
  }
  return new Date(candidate).toISOString();
}

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseOwnerAwayAggregates(value: unknown): OwnerAwayAggregates {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    orderCount: n(row.order_count), revenue: n(row.revenue),
    deliveryCount: n(row.delivery_count), deliveredKg: n(row.delivered_kg),
    wasteCount: n(row.waste_count), wasteKg: n(row.waste_kg), saleKg: n(row.sale_kg),
    serveCount: n(row.serve_count), deliveryWorkflowCount: n(row.delivery_workflow_count),
    wasteWorkflowCount: n(row.waste_workflow_count), certificateWorkflowCount: n(row.certificate_workflow_count),
    evidenceTotal: n(row.evidence_total), evidenceNeedsReview: n(row.evidence_needs_review),
    evidenceFailed: n(row.evidence_failed), certificateCaptured: n(row.certificate_captured),
    certificateNeedsReview: n(row.certificate_needs_review), openAlertCount: n(row.open_alert_count),
    criticalAlertCount: n(row.critical_alert_count),
  };
}
