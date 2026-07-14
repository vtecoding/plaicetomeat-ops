import "server-only";

import { buildOwnerAwayHeadline, ownerAwayStatusLabel } from "@/lib/domain/owner-away";
import {
  branchLocalDayStartIso,
  EMPTY_OWNER_AWAY_AGGREGATES,
  parseOwnerAwayAggregates,
  type OwnerAwayAggregates,
} from "@/lib/domain/owner-away-accuracy";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type SettingsRow = {
  owner_away: boolean;
  away_since: string | null;
  summary_time: string | null;
  owner_contact: string | null;
  updated_at: string | null;
};

type BranchRow = { timezone: string | null };

type ChecklistRow = {
  kind: "opening" | "closing" | "stock_count";
  status: "in_progress" | "completed" | "abandoned";
  started_at: string | null;
  completed_at: string | null;
};

type OrderRow = {
  id: string;
  order_ref: string | null;
  subtotal: string | number | null;
  created_at: string;
};

type WorkflowRow = {
  workflow: "serve" | "delivery" | "waste" | "certificate" | "open" | "close";
  status: string | null;
  result_ref: string | null;
  updated_at: string;
};

type EvidenceRow = {
  id: string;
  evidence_type: string;
  source_type: string | null;
  source_ref: string | null;
  status: string;
  review_required: boolean | null;
  created_at: string;
};

type AlertRow = {
  id: string;
  severity: "warning" | "critical";
  kind: string;
  summary: string;
  entity_ref: string | null;
  created_at: string;
};

type ComplianceDocumentRow = {
  id: string;
  doc_type: string | null;
  status: string;
  created_at: string;
};

export type OwnerAwaySummary = {
  configured: boolean;
  generatedAt: string;
  windowStart: string;
  settings: {
    ownerAway: boolean;
    awaySince: string | null;
    summaryTime: string;
    ownerContact: string | null;
    updatedAt: string | null;
  };
  statusLabel: string;
  headline: string;
  shop: {
    opened: boolean;
    closed: boolean;
    openingStatus: string | null;
    closingStatus: string | null;
    latestOpenAt: string | null;
    latestCloseAt: string | null;
  };
  sales: {
    orderCount: number;
    revenue: number;
    latestOrders: Array<{ id: string; orderRef: string; subtotal: number; createdAt: string }>;
  };
  stock: {
    deliveryCount: number;
    deliveredKg: number;
    wasteCount: number;
    wasteKg: number;
    saleKg: number;
  };
  workflows: {
    serve: number;
    delivery: number;
    waste: number;
    certificate: number;
    latest: Array<{ workflow: string; resultRef: string | null; updatedAt: string }>;
  };
  evidence: {
    total: number;
    needsReview: number;
    failed: number;
    latest: Array<{ id: string; evidenceType: string; status: string; source: string; createdAt: string }>;
  };
  certificates: {
    captured: number;
    needsReview: number;
    latest: Array<{ id: string; docType: string; status: string; createdAt: string }>;
  };
  alerts: {
    openCount: number;
    criticalCount: number;
    latest: Array<{ id: string; severity: "warning" | "critical"; kind: string; summary: string; createdAt: string }>;
  };
};

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

function latestCompleted(rows: ChecklistRow[], kind: "opening" | "closing") {
  return rows
    .filter((row) => row.kind === kind)
    .sort((a, b) => String(b.completed_at ?? b.started_at).localeCompare(String(a.completed_at ?? a.started_at)))[0];
}

export async function getOwnerAwaySummary(branchId: string, now = new Date()): Promise<OwnerAwaySummary> {
  const generatedAt = now.toISOString();

  if (!hasSupabaseServiceEnv()) {
    return buildSummary({
      configured: false,
      generatedAt,
      settings: null,
      windowStart: branchLocalDayStartIso(now, "Europe/London"),
      checklists: [],
      orders: [],
      workflows: [],
      evidence: [],
      alerts: [],
      documents: [],
      aggregates: EMPTY_OWNER_AWAY_AGGREGATES,
    });
  }

  const supabase = createSupabaseServiceClient();
  const [settingsResult, branchResult] = await Promise.all([
    supabase
      .from("branch_operator_settings")
      .select("owner_away, away_since, summary_time, owner_contact, updated_at")
      .eq("branch_id", branchId)
      .maybeSingle<SettingsRow>(),
    supabase.from("branches").select("timezone").eq("id", branchId).maybeSingle<BranchRow>(),
  ]);
  const settings = settingsResult.data;
  const timezone = branchResult.data?.timezone ?? "Europe/London";

  const windowStart = settings?.owner_away && settings.away_since
    ? settings.away_since
    : branchLocalDayStartIso(now, timezone);

  const [checklists, orders, workflows, evidence, alerts, documents, aggregates] = await Promise.all([
    supabase
      .from("ops_checklist_sessions")
      .select("kind,status,started_at,completed_at")
      .eq("branch_id", branchId)
      .gte("started_at", windowStart)
      .order("started_at", { ascending: false }),
    supabase.rpc("owner_away_latest_sales_v18", {
      p_branch_id: branchId,
      p_since: windowStart,
      p_limit: 20,
    }),
    supabase
      .from("operator_workflow_runs")
      .select("workflow,status,result_ref,updated_at")
      .eq("branch_id", branchId)
      .gte("updated_at", windowStart)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("operator_evidence")
      .select("id,evidence_type,source_type,source_ref,status,review_required,created_at")
      .eq("branch_id", branchId)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("owner_alerts")
      .select("id,severity,kind,summary,entity_ref,created_at")
      .eq("branch_id", branchId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("compliance_documents")
      .select("id,doc_type,status,created_at")
      .eq("branch_id", branchId)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("owner_away_aggregates_v18", { p_branch_id: branchId, p_since: windowStart }),
  ]);

  return buildSummary({
    configured: true,
    generatedAt,
    settings: settings ?? null,
    windowStart,
    checklists: ((checklists.data ?? []) as ChecklistRow[]) ?? [],
    orders: ((orders.data ?? []) as OrderRow[]) ?? [],
    workflows: ((workflows.data ?? []) as WorkflowRow[]) ?? [],
    evidence: ((evidence.data ?? []) as EvidenceRow[]) ?? [],
    alerts: ((alerts.data ?? []) as AlertRow[]) ?? [],
    documents: ((documents.data ?? []) as ComplianceDocumentRow[]) ?? [],
    aggregates: parseOwnerAwayAggregates(aggregates.data),
  });
}

function buildSummary(input: {
  configured: boolean;
  generatedAt: string;
  settings: SettingsRow | null;
  windowStart: string;
  checklists: ChecklistRow[];
  orders: OrderRow[];
  workflows: WorkflowRow[];
  evidence: EvidenceRow[];
  alerts: AlertRow[];
  documents: ComplianceDocumentRow[];
  aggregates: OwnerAwayAggregates;
}): OwnerAwaySummary {
  const ownerAway = input.settings?.owner_away ?? false;
  const open = latestCompleted(input.checklists, "opening");
  const close = latestCompleted(input.checklists, "closing");

  return {
    configured: input.configured,
    generatedAt: input.generatedAt,
    windowStart: input.windowStart,
    settings: {
      ownerAway,
      awaySince: input.settings?.away_since ?? null,
      summaryTime: input.settings?.summary_time ?? "19:00",
      ownerContact: input.settings?.owner_contact ?? null,
      updatedAt: input.settings?.updated_at ?? null,
    },
    statusLabel: ownerAwayStatusLabel(ownerAway),
    headline: buildOwnerAwayHeadline({
      ownerAway,
      shopOpened: open?.status === "completed",
      openAlertCount: input.aggregates.openAlertCount,
      orderCount: input.aggregates.orderCount,
      evidenceReviewCount: input.aggregates.evidenceNeedsReview + input.aggregates.evidenceFailed,
      certificateReviewCount: input.aggregates.certificateNeedsReview,
    }),
    shop: {
      opened: open?.status === "completed",
      closed: close?.status === "completed",
      openingStatus: open?.status ?? null,
      closingStatus: close?.status ?? null,
      latestOpenAt: open?.completed_at ?? open?.started_at ?? null,
      latestCloseAt: close?.completed_at ?? close?.started_at ?? null,
    },
    sales: {
      orderCount: input.aggregates.orderCount,
      revenue: input.aggregates.revenue,
      latestOrders: input.orders.slice(0, 5).map((order) => ({
        id: order.id,
        orderRef: order.order_ref ?? order.id.slice(0, 8),
        subtotal: toNumber(order.subtotal),
        createdAt: order.created_at,
      })),
    },
    stock: {
      deliveryCount: input.aggregates.deliveryCount,
      deliveredKg: input.aggregates.deliveredKg,
      wasteCount: input.aggregates.wasteCount,
      wasteKg: input.aggregates.wasteKg,
      saleKg: input.aggregates.saleKg,
    },
    workflows: {
      serve: input.aggregates.serveCount,
      delivery: input.aggregates.deliveryWorkflowCount,
      waste: input.aggregates.wasteWorkflowCount,
      certificate: input.aggregates.certificateWorkflowCount,
      latest: input.workflows
        .filter((row) => row.status === "completed")
        .slice(0, 6)
        .map((row) => ({ workflow: row.workflow, resultRef: row.result_ref, updatedAt: row.updated_at })),
    },
    evidence: {
      total: input.aggregates.evidenceTotal,
      needsReview: input.aggregates.evidenceNeedsReview,
      failed: input.aggregates.evidenceFailed,
      latest: input.evidence.slice(0, 6).map((item) => ({
        id: item.id,
        evidenceType: item.evidence_type,
        status: item.status,
        source: item.source_ref ?? item.source_type ?? "operator",
        createdAt: item.created_at,
      })),
    },
    certificates: {
      captured: input.aggregates.certificateCaptured,
      needsReview: input.aggregates.certificateNeedsReview,
      latest: input.documents.slice(0, 6).map((doc) => ({
        id: doc.id,
        docType: doc.doc_type ?? "paper",
        status: doc.status,
        createdAt: doc.created_at,
      })),
    },
    alerts: {
      openCount: input.aggregates.openAlertCount,
      criticalCount: input.aggregates.criticalAlertCount,
      latest: input.alerts.slice(0, 8).map((alert) => ({
        id: alert.id,
        severity: alert.severity,
        kind: alert.kind,
        summary: alert.summary,
        createdAt: alert.created_at,
      })),
    },
  };
}
