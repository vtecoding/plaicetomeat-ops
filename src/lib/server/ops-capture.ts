import "server-only";

import { getChecklist } from "@/lib/ops-capture/checklists";
import { buildReceipt, summariseChecklist } from "@/lib/ops-capture/progress";
import type { ChecklistReceipt, ChecklistSummary, OpsEvent, OpsSession } from "@/lib/ops-capture/types";
import { getInventoryBatches } from "@/lib/server/compliance-inventory";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDisplayDate } from "@/lib/utils";

export type ChecklistKind = "opening" | "closing";

/** Everything the open/close page needs in one read: resume state or a finished receipt. */
export type TodaysChecklistState = {
  sessionId: string | null;
  status: OpsSession["status"] | null;
  summary: ChecklistSummary;
  receipt: ChecklistReceipt | null;
};

/** The trading day, in UTC, matching the RPC default so reads and writes agree. */
export function businessDateUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function mapSession(row: Record<string, unknown>): OpsSession {
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    kind: row.kind as OpsSession["kind"],
    businessDate: String(row.business_date),
    status: row.status as OpsSession["status"],
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function receiptMetadata(row: Record<string, unknown>): Partial<ChecklistReceipt> {
  return {
    sessionId: String(row.id),
    definitionKey: row.definition_key ? String(row.definition_key) : null,
    definitionVersion: row.definition_version === null || row.definition_version === undefined ? null : Number(row.definition_version),
    actorId: row.completed_by ? String(row.completed_by) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function mapEvent(row: Record<string, unknown>): OpsEvent {
  return {
    id: String(row.id),
    stepKey: String(row.step_key),
    state: row.state as OpsEvent["state"],
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

async function loadEvents(sessionId: string): Promise<OpsEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("ops_checklist_events")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return (data ?? []).map(mapEvent);
}

/**
 * The resumable state of today's opening/closing ritual: the in-progress session (if any)
 * and a summary that replays recorded steps so a refresh picks up exactly where it left off.
 */
export async function getActiveChecklist(
  branchId: string,
  kind: ChecklistKind,
  now = new Date(),
): Promise<{ session: OpsSession | null; summary: ChecklistSummary }> {
  const supabase = await createSupabaseServerClient();
  const def = getChecklist(kind);

  const { data: sessionRow } = await supabase
    .from("ops_checklist_sessions")
    .select("*")
    .eq("branch_id", branchId)
    .eq("kind", kind)
    .eq("business_date", businessDateUtc(now))
    .eq("status", "in_progress")
    .maybeSingle();

  if (!sessionRow) {
    return { session: null, summary: summariseChecklist(def, []) };
  }

  const events = await loadEvents(String(sessionRow.id));
  return { session: mapSession(sessionRow), summary: summariseChecklist(def, events) };
}

/**
 * Today's opening/closing ritual in one shot: the latest session for the day plus its
 * resume summary, and — once finished — the persisted completion receipt. This is what
 * makes a refresh land back exactly where the owner left off (or on their receipt).
 */
export async function getTodaysChecklistState(
  branchId: string,
  kind: ChecklistKind,
  now = new Date(),
): Promise<TodaysChecklistState> {
  const supabase = await createSupabaseServerClient();
  const def = getChecklist(kind);

  const { data: sessionRow } = await supabase
    .from("ops_checklist_sessions")
    .select("*")
    .eq("branch_id", branchId)
    .eq("kind", kind)
    .eq("business_date", businessDateUtc(now))
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sessionRow) {
    return { sessionId: null, status: null, summary: summariseChecklist(def, []), receipt: null };
  }

  const events = await loadEvents(String(sessionRow.id));
  const summary = summariseChecklist(def, events);
  const receipt =
    sessionRow.status === "completed"
      ? buildReceipt(
          def,
          events,
          sessionRow.completed_at ? formatDisplayDate(new Date(String(sessionRow.completed_at))) : null,
          receiptMetadata(sessionRow),
        )
      : null;

  return { sessionId: String(sessionRow.id), status: sessionRow.status as OpsSession["status"], summary, receipt };
}

export type StockCountBatch = {
  batchId: string;
  productName: string;
  remainingKg: number;
  receivedKg: number;
  daysToExpiry: number;
};

export type StockCountLineState = {
  lineId: string;
  countedKg: number;
  systemKg: number;
  applied: boolean;
};

export type StockCountState = {
  sessionId: string | null;
  batches: StockCountBatch[];
  /** Keyed by batchId — the count already recorded for that batch this session. */
  lines: Record<string, StockCountLineState>;
};

/**
 * Today's stock count: the active batches to count, plus any counts already recorded this
 * session (so a refresh resumes mid-count). Counting records evidence only — stock is never
 * changed here, only by applying a line through the correction path.
 */
export async function getStockCountState(branchId: string, now = new Date()): Promise<StockCountState> {
  const supabase = await createSupabaseServerClient();

  const { data: sessionRow } = await supabase
    .from("ops_checklist_sessions")
    .select("id")
    .eq("branch_id", branchId)
    .eq("kind", "stock_count")
    .eq("business_date", businessDateUtc(now))
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const batches: StockCountBatch[] = (await getInventoryBatches(branchId))
    .filter((b) => b.status === "active" && b.remainingWeightKg > 0)
    .map((b) => ({
      batchId: b.id,
      productName: b.productName,
      remainingKg: b.remainingWeightKg,
      receivedKg: b.receivedWeightKg,
      daysToExpiry: b.daysToExpiry,
    }));

  const lines: Record<string, StockCountLineState> = {};
  if (sessionRow) {
    const { data: lineRows } = await supabase
      .from("stock_count_lines")
      .select("id, batch_id, counted_weight_kg, system_weight_kg, applied_at")
      .eq("session_id", sessionRow.id);
    for (const row of lineRows ?? []) {
      lines[String(row.batch_id)] = {
        lineId: String(row.id),
        countedKg: Number(row.counted_weight_kg),
        systemKg: Number(row.system_weight_kg),
        applied: row.applied_at !== null,
      };
    }
  }

  return { sessionId: sessionRow ? String(sessionRow.id) : null, batches, lines };
}

/** A persisted completion receipt for a finished opening/closing ritual. */
export async function getChecklistReceipt(sessionId: string): Promise<ChecklistReceipt | null> {
  const supabase = await createSupabaseServerClient();
  const { data: sessionRow } = await supabase.from("ops_checklist_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!sessionRow || sessionRow.kind === "stock_count") return null;

  const events = await loadEvents(sessionId);
  const label = sessionRow.completed_at ? formatDisplayDate(new Date(String(sessionRow.completed_at))) : null;
  return buildReceipt(getChecklist(sessionRow.kind as ChecklistKind), events, label, receiptMetadata(sessionRow));
}
