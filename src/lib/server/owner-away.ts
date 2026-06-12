import "server-only";

import { buildOwnerAwayHeadline, ownerAwayStatusLabel } from "@/lib/domain/owner-away";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type SettingsRow = {
  owner_away: boolean;
  away_since: string | null;
  summary_time: string | null;
  owner_contact: string | null;
  updated_at: string | null;
};

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
  status: string | null;
  is_test: boolean | null;
  created_at: string;
};

type WorkflowRow = {
  workflow: "serve" | "delivery" | "waste" | "certificate" | "open" | "close";
  status: string | null;
  result_ref: string | null;
  updated_at: string;
};

type InventoryBatchRow = {
  id: string;
  received_weight_kg: string | number | null;
  created_at: string;
};

type MovementRow = {
  movement_type: string | null;
  quantity_kg: string | number | null;
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

function startOfToday(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

function latestCompleted(rows: ChecklistRow[], kind: "opening" | "closing") {
  return rows
    .filter((row) => row.kind === kind)
    .sort((a, b) => String(b.completed_at ?? b.started_at).localeCompare(String(a.completed_at ?? a.started_at)))[0];
}

function countCompleted(rows: WorkflowRow[], workflow: WorkflowRow["workflow"]) {
  return rows.filter((row) => row.workflow === workflow && row.status === "completed").length;
}

export async function getOwnerAwaySummary(branchId: string, now = new Date()): Promise<OwnerAwaySummary> {
  const generatedAt = now.toISOString();

  if (!hasSupabaseServiceEnv()) {
    return buildSummary({
      configured: false,
      generatedAt,
      settings: null,
      windowStart: startOfToday(now),
      checklists: [],
      orders: [],
      workflows: [],
      batches: [],
      movements: [],
      evidence: [],
      alerts: [],
      documents: [],
    });
  }

  const supabase = createSupabaseServiceClient();
  const { data: settings } = await supabase
    .from("branch_operator_settings")
    .select("owner_away, away_since, summary_time, owner_contact, updated_at")
    .eq("branch_id", branchId)
    .maybeSingle<SettingsRow>();

  const windowStart = settings?.owner_away && settings.away_since ? settings.away_since : startOfToday(now);

  const [checklists, orders, workflows, batches, movements, evidence, alerts, documents] = await Promise.all([
    supabase
      .from("ops_checklist_sessions")
      .select("kind,status,started_at,completed_at")
      .eq("branch_id", branchId)
      .gte("started_at", windowStart)
      .order("started_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id,order_ref,subtotal,status,is_test,created_at")
      .eq("branch_id", branchId)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("operator_workflow_runs")
      .select("workflow,status,result_ref,updated_at")
      .eq("branch_id", branchId)
      .gte("updated_at", windowStart)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("inventory_batches")
      .select("id,received_weight_kg,created_at")
      .eq("branch_id", branchId)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("inventory_movements")
      .select("movement_type,quantity_kg")
      .eq("branch_id", branchId)
      .gte("created_at", windowStart)
      .limit(200),
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
  ]);

  return buildSummary({
    configured: true,
    generatedAt,
    settings: settings ?? null,
    windowStart,
    checklists: ((checklists.data ?? []) as ChecklistRow[]) ?? [],
    orders: ((orders.data ?? []) as OrderRow[]) ?? [],
    workflows: ((workflows.data ?? []) as WorkflowRow[]) ?? [],
    batches: ((batches.data ?? []) as InventoryBatchRow[]) ?? [],
    movements: ((movements.data ?? []) as MovementRow[]) ?? [],
    evidence: ((evidence.data ?? []) as EvidenceRow[]) ?? [],
    alerts: ((alerts.data ?? []) as AlertRow[]) ?? [],
    documents: ((documents.data ?? []) as ComplianceDocumentRow[]) ?? [],
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
  batches: InventoryBatchRow[];
  movements: MovementRow[];
  evidence: EvidenceRow[];
  alerts: AlertRow[];
  documents: ComplianceDocumentRow[];
}): OwnerAwaySummary {
  const ownerAway = input.settings?.owner_away ?? false;
  const open = latestCompleted(input.checklists, "opening");
  const close = latestCompleted(input.checklists, "closing");
  const realOrders = input.orders.filter((order) => !order.is_test && order.status !== "cancelled");
  const reviewEvidence = input.evidence.filter((item) => item.review_required || item.status === "needs_owner_review");
  const failedEvidence = input.evidence.filter((item) => item.status === "failed");
  const reviewDocuments = input.documents.filter((doc) => doc.status === "needs_owner_review");
  const wasteMovements = input.movements.filter((row) => row.movement_type === "WASTE");
  const saleMovements = input.movements.filter((row) => row.movement_type === "SALE");
  const criticalAlerts = input.alerts.filter((alert) => alert.severity === "critical");

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
      openAlertCount: input.alerts.length,
      orderCount: realOrders.length,
      evidenceReviewCount: reviewEvidence.length + failedEvidence.length,
      certificateReviewCount: reviewDocuments.length,
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
      orderCount: realOrders.length,
      revenue: realOrders.reduce((sum, order) => sum + toNumber(order.subtotal), 0),
      latestOrders: realOrders.slice(0, 5).map((order) => ({
        id: order.id,
        orderRef: order.order_ref ?? order.id.slice(0, 8),
        subtotal: toNumber(order.subtotal),
        createdAt: order.created_at,
      })),
    },
    stock: {
      deliveryCount: input.batches.length,
      deliveredKg: input.batches.reduce((sum, batch) => sum + toNumber(batch.received_weight_kg), 0),
      wasteCount: wasteMovements.length,
      wasteKg: wasteMovements.reduce((sum, movement) => sum + toNumber(movement.quantity_kg), 0),
      saleKg: saleMovements.reduce((sum, movement) => sum + toNumber(movement.quantity_kg), 0),
    },
    workflows: {
      serve: countCompleted(input.workflows, "serve"),
      delivery: countCompleted(input.workflows, "delivery"),
      waste: countCompleted(input.workflows, "waste"),
      certificate: countCompleted(input.workflows, "certificate"),
      latest: input.workflows
        .filter((row) => row.status === "completed")
        .slice(0, 6)
        .map((row) => ({ workflow: row.workflow, resultRef: row.result_ref, updatedAt: row.updated_at })),
    },
    evidence: {
      total: input.evidence.length,
      needsReview: reviewEvidence.length,
      failed: failedEvidence.length,
      latest: input.evidence.slice(0, 6).map((item) => ({
        id: item.id,
        evidenceType: item.evidence_type,
        status: item.status,
        source: item.source_ref ?? item.source_type ?? "operator",
        createdAt: item.created_at,
      })),
    },
    certificates: {
      captured: input.documents.length,
      needsReview: reviewDocuments.length,
      latest: input.documents.slice(0, 6).map((doc) => ({
        id: doc.id,
        docType: doc.doc_type ?? "paper",
        status: doc.status,
        createdAt: doc.created_at,
      })),
    },
    alerts: {
      openCount: input.alerts.length,
      criticalCount: criticalAlerts.length,
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
