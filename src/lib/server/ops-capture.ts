import "server-only";

import { getChecklist } from "@/lib/ops-capture/checklists";
import { buildReceipt, summariseChecklist } from "@/lib/ops-capture/progress";
import type { ChecklistReceipt, ChecklistSummary, OpsEvent, OpsSession } from "@/lib/ops-capture/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDisplayDate } from "@/lib/utils";

type ChecklistKind = "opening" | "closing";

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

/** A persisted completion receipt for a finished opening/closing ritual. */
export async function getChecklistReceipt(sessionId: string): Promise<ChecklistReceipt | null> {
  const supabase = await createSupabaseServerClient();
  const { data: sessionRow } = await supabase.from("ops_checklist_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!sessionRow || sessionRow.kind === "stock_count") return null;

  const events = await loadEvents(sessionId);
  const label = sessionRow.completed_at ? formatDisplayDate(new Date(String(sessionRow.completed_at))) : null;
  return buildReceipt(getChecklist(sessionRow.kind as ChecklistKind), events, label);
}
