import "server-only";

import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type AuditEvent = {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  actorRole: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  summary: string;
};

export type AuditEventFilters = {
  user?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
};

type AuditEventRow = {
  id: string;
  created_at: string;
  actor_email: string | null;
  actor_role: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
};

export async function getRecentAuditEvents(filters: AuditEventFilters = {}): Promise<AuditEvent[]> {
  if (!hasSupabaseServiceEnv()) return [];

  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("audit_events")
    .select("id, created_at, actor_email, actor_role, event_type, entity_type, entity_id, summary")
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.user?.trim()) {
    query = query.ilike("actor_email", `%${filters.user.trim()}%`);
  }

  if (filters.eventType?.trim()) {
    query = query.eq("event_type", filters.eventType.trim());
  }

  if (filters.dateFrom) {
    query = query.gte("created_at", `${filters.dateFrom}T00:00:00.000Z`);
  }

  if (filters.dateTo) {
    query = query.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);
  }

  const { data, error } = await query;

  if (error || !data) return [];

  return (data as AuditEventRow[]).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
  }));
}
