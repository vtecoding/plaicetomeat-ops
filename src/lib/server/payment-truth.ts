import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * V18 A1 — Payment truth (PTM-OPS-001).
 *
 * The day's money picture, windowed on the branch-local business date (never
 * naive UTC). The expected-money EQUATION lives in exactly one place — the
 * `day_money_expected_v18` SQL function — so the closing checklist's variance
 * stamp and every screen that shows "expected in till" can never disagree.
 * This module fetches that authoritative result and decorates it with the
 * explanatory lists (till movements, orders collected without a tender of
 * record) that screens render alongside it.
 */

export type TillMovement = {
  id: string;
  kind: "paid_in" | "paid_out" | "cash_drop" | "correction";
  signedAmountPence: number;
  reasonCode: "change" | "supplier" | "owner" | "other";
  note: string | null;
  createdAt: string;
};

export type MissingTenderOrder = { orderId: string; orderRef: string | null };

export type DayPaymentPicture = {
  businessDate: string;
  /** Opening float in pence, or null when the opening ritual recorded no float. */
  floatPence: number | null;
  cashSalesPence: number;
  cashRefundsPence: number;
  cardSalesPence: number;
  cardRefundsPence: number;
  tillMovementsPence: number;
  /** Null when the float is unknown — expected cash is never guessed. */
  expectedCashPence: number | null;
  expectedCardPence: number;
  tillMovements: TillMovement[];
  /** Orders collected this day with no payment event (legacy/pre-A1). Listed, never guessed. */
  ordersMissingTender: MissingTenderOrder[];
};

type ExpectedRow = {
  float_pence: number | null;
  cash_sales_pence: number;
  cash_refunds_pence: number;
  card_sales_pence: number;
  card_refunds_pence: number;
  till_movements_pence: number;
  expected_cash_pence: number | null;
  expected_card_pence: number;
  missing_tender_count: number;
};

/** The branch-local trading day (yyyy-mm-dd) for an instant, DST-correct. */
export function branchLocalDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Shift an ISO calendar date without applying the process timezone or DST. */
export function addBusinessCalendarDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isInteger(days)) {
    throw new RangeError("Invalid business calendar date shift.");
  }
  const anchor = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== isoDate) {
    throw new RangeError("Invalid business calendar date.");
  }
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

async function getBranchTimezone(branchId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("branches").select("timezone").eq("id", branchId).maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return typeof tz === "string" && tz.length > 0 ? tz : "Europe/London";
}

export async function getBranchBusinessDate(branchId: string, at: Date = new Date()): Promise<string> {
  return branchLocalDate(await getBranchTimezone(branchId), at);
}

export async function getDayPaymentPicture(
  branchId: string,
  businessDate?: string,
): Promise<DayPaymentPicture | null> {
  const supabase = await createSupabaseServerClient();
  const timezone = await getBranchTimezone(branchId);
  const date = businessDate ?? branchLocalDate(timezone);

  const { data: expectedRaw, error: expectedError } = await supabase.rpc("day_money_expected_v18", {
    p_branch_id: branchId,
    p_business_date: date,
  });
  if (expectedError || !expectedRaw) return null;
  const expected = expectedRaw as ExpectedRow;

  const { data: tillRows } = await supabase
    .from("till_events")
    .select("id,kind,signed_amount_pence,reason_code,note,created_at")
    .eq("branch_id", branchId)
    .eq("business_date", date)
    .order("created_at", { ascending: true });

  const tillMovements: TillMovement[] = (tillRows ?? []).map((row) => ({
    id: String(row.id),
    kind: row.kind as TillMovement["kind"],
    signedAmountPence: Number(row.signed_amount_pence),
    reasonCode: row.reason_code as TillMovement["reasonCode"],
    note: (row.note as string | null) ?? null,
    createdAt: String(row.created_at),
  }));

  const ordersMissingTender =
    expected.missing_tender_count > 0 ? await listMissingTenderOrders(branchId, date, timezone) : [];

  return {
    businessDate: date,
    floatPence: expected.float_pence,
    cashSalesPence: expected.cash_sales_pence,
    cashRefundsPence: expected.cash_refunds_pence,
    cardSalesPence: expected.card_sales_pence,
    cardRefundsPence: expected.card_refunds_pence,
    tillMovementsPence: expected.till_movements_pence,
    expectedCashPence: expected.expected_cash_pence,
    expectedCardPence: expected.expected_card_pence,
    tillMovements,
    ordersMissingTender,
  };
}

/**
 * Orders whose collection landed on this branch-local day but that have no sale
 * payment event. Fetched over a generous UTC window and filtered by converting
 * each event instant to the branch-local date (matches the SQL attribution).
 */
async function listMissingTenderOrders(
  branchId: string,
  businessDate: string,
  timezone: string,
): Promise<MissingTenderOrder[]> {
  const supabase = await createSupabaseServerClient();

  const dayStart = new Date(`${businessDate}T00:00:00Z`);
  const windowStart = new Date(dayStart.getTime() - 24 * 3600 * 1000).toISOString();
  const windowEnd = new Date(dayStart.getTime() + 48 * 3600 * 1000).toISOString();

  const { data: events } = await supabase
    .from("order_status_events")
    .select("order_id,created_at")
    .eq("branch_id", branchId)
    .eq("status", "collected")
    .gte("created_at", windowStart)
    .lt("created_at", windowEnd)
    .limit(500);

  const collectedIds = [
    ...new Set(
      (events ?? [])
        .filter((event) => branchLocalDate(timezone, new Date(String(event.created_at))) === businessDate)
        .map((event) => String(event.order_id)),
    ),
  ];
  if (collectedIds.length === 0) return [];

  const { data: tendered } = await supabase
    .from("payment_events")
    .select("order_id")
    .eq("direction", "sale")
    .in("order_id", collectedIds);

  const tenderedIds = new Set((tendered ?? []).map((row) => String(row.order_id)));
  const missingIds = collectedIds.filter((id) => !tenderedIds.has(id));
  if (missingIds.length === 0) return [];

  const { data: orders } = await supabase.from("orders").select("id,order_ref").in("id", missingIds);
  const refById = new Map((orders ?? []).map((row) => [String(row.id), (row.order_ref as string | null) ?? null]));

  return missingIds.map((orderId) => ({ orderId, orderRef: refById.get(orderId) ?? null }));
}

/** Plain-English money formatting shared by the closing steps and Today card. */
export function formatPence(pence: number): string {
  const pounds = Math.abs(pence) / 100;
  return `${pence < 0 ? "-" : ""}£${pounds.toFixed(2)}`;
}

export type YesterdayMoneyCard = {
  businessDate: string;
  cashSalesPence: number;
  cardSalesPence: number;
  refundsPence: number;
  /** Null until a closing session with money metadata exists for the day. */
  cashVariancePence: number | null;
  cardVariancePence: number | null;
  varianceSuppressed: boolean;
  closed: boolean;
  missingTenderCount: number;
};

type CompletionMetadata = {
  cash_variance_pence?: number | null;
  card_variance_pence?: number | null;
  variance_alert_suppressed?: boolean;
  missing_tender_count?: number;
} | null;

/**
 * Yesterday's money for the owner's Today card (audit PTM-OPS-001): takings
 * split plus the till result stamped by the closing ritual. Returns null when
 * there is nothing truthful to show (no payment events and no completed close
 * — e.g. pre-A1 days), so the card simply doesn't render.
 */
export async function getYesterdayMoneyCard(branchId: string): Promise<YesterdayMoneyCard | null> {
  const supabase = await createSupabaseServerClient();
  const timezone = await getBranchTimezone(branchId);
  const today = branchLocalDate(timezone);
  const yesterday = addBusinessCalendarDays(today, -1);

  const [{ data: expectedRaw }, { data: session }] = await Promise.all([
    supabase.rpc("day_money_expected_v18", { p_branch_id: branchId, p_business_date: yesterday }),
    supabase
      .from("ops_checklist_sessions")
      .select("id,completion_metadata")
      .eq("branch_id", branchId)
      .eq("kind", "closing")
      .eq("business_date", yesterday)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const expected = (expectedRaw ?? null) as ExpectedRow | null;
  const metadata = ((session?.completion_metadata as CompletionMetadata) ?? null) as CompletionMetadata;

  const hadMoney =
    !!expected &&
    (expected.cash_sales_pence > 0 ||
      expected.card_sales_pence > 0 ||
      expected.cash_refunds_pence > 0 ||
      expected.card_refunds_pence > 0);

  if (!hadMoney && !metadata) return null;

  return {
    businessDate: yesterday,
    cashSalesPence: expected?.cash_sales_pence ?? 0,
    cardSalesPence: expected?.card_sales_pence ?? 0,
    refundsPence: (expected?.cash_refunds_pence ?? 0) + (expected?.card_refunds_pence ?? 0),
    cashVariancePence: typeof metadata?.cash_variance_pence === "number" ? metadata.cash_variance_pence : null,
    cardVariancePence: typeof metadata?.card_variance_pence === "number" ? metadata.card_variance_pence : null,
    varianceSuppressed: metadata?.variance_alert_suppressed === true,
    closed: !!session,
    missingTenderCount: expected?.missing_tender_count ?? 0,
  };
}
