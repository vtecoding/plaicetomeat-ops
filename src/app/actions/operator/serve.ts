"use server";

import { revalidatePath } from "next/cache";

import {
  auditOperatorRun,
  createOwnerAlert,
  isUuid,
  readCompletedRun,
  saveOperatorRun,
  simpleText,
  type OperatorActionResult,
} from "@/app/actions/operator/escalation";
import {
  resolveServeLines,
  serveRepairDecision,
  serveSubtotal,
  type ResolvedServeLine,
} from "@/lib/operator/workflows/serve-lines";
import { emitAuditLog } from "@/lib/server/audit";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient, createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type PayKind = "cash" | "card";

type ServeLineInput = {
  productId?: string | null;
  name?: string | null;
  quantityKg: number;
  // F5: pounds the customer paid for a custom ("Other") line that resolves to no
  // known product. Required for those lines; ignored for matched products (which
  // are priced from the catalogue).
  priceGbp?: number | null;
};

type ProductRow = {
  id: string;
  branch_id: string;
  name: string;
  unit_type: "kg" | "each" | "box";
  price_per_unit: string | number;
};

type OrderRow = {
  id: string;
  order_ref: string;
  status: "incoming" | "prepping" | "ready" | "collected" | "cancelled";
};

type DepleteRow = {
  status: "completed" | "completed_with_shortfall";
  shortfall_detail: Array<{ product_name?: string }> | null;
};

async function requireOperator() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id } : ctx;
}

function todayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

function cleanPay(value: string): PayKind | null {
  return value === "cash" || value === "card" ? value : null;
}

function cleanLines(lines: ServeLineInput[]) {
  return lines
    .slice(0, 12)
    .map((line) => ({
      productId: isUuid(line.productId) ? line.productId! : null,
      name: simpleText(line.name, 80),
      quantityKg: Number(line.quantityKg),
      priceGbp: line.priceGbp == null ? null : Number(line.priceGbp),
    }))
    .filter((line) => Number.isFinite(line.quantityKg) && line.quantityKg > 0 && line.quantityKg <= 50);
}

async function getExistingByRun(runId: string): Promise<OrderRow | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("orders")
    .select("id,order_ref,status")
    .eq("idempotency_key", `operator-serve:${runId}`)
    .maybeSingle<OrderRow>();
  return data ?? null;
}

async function nextRef(branchId: string, date: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("next_order_ref", {
    target_branch_id: branchId,
    target_date: date,
  });
  if (error || !data) return null;
  return String(data);
}

async function collectOrder(
  order: OrderRow,
  payKind: PayKind,
  runId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (order.status === "collected") return { ok: true };
  if (order.status === "cancelled") return { ok: false, message: "Try again." };

  const supabase = await createSupabaseServerClient();
  const hops = order.status === "incoming" ? ["prepping", "ready"] : order.status === "prepping" ? ["ready"] : [];

  for (const next of hops) {
    const { error } = await supabase.rpc("transition_order_status", {
      p_order_id: order.id,
      p_next_status: next,
      p_note: "Shop sale.",
    });
    if (error) {
      const { data } = await createSupabaseServiceClient()
        .from("orders")
        .select("id,order_ref,status")
        .eq("id", order.id)
        .maybeSingle<OrderRow>();
      if (data?.status === "collected") return { ok: true };
      return { ok: false, message: "Try again." };
    }
  }

  // V18 A1: the final hop records collection AND the tender of record in one
  // RPC transaction. Retries replay by the run-scoped key — a run can never
  // write a second payment event (verified by the serve retry unit path).
  const { error: tenderError } = await supabase.rpc("collect_order_with_tender", {
    p_order_id: order.id,
    p_method: payKind,
    p_idempotency_key: `operator-serve:${runId}:tender`,
    p_note: "Shop sale.",
  });
  if (tenderError) {
    const { data } = await createSupabaseServiceClient()
      .from("orders")
      .select("id,order_ref,status")
      .eq("id", order.id)
      .maybeSingle<OrderRow>();
    if (data?.status === "collected") return { ok: true };
    return { ok: false, message: "Try again." };
  }

  return { ok: true };
}

function toItemRows(orderLines: ResolvedServeLine[], branchId: string, orderId: string) {
  return orderLines.map((line) => ({
    branch_id: branchId,
    order_id: orderId,
    product_id: line.product?.id ?? null,
    product_name_snapshot: line.name,
    quantity: line.quantity,
    unit_type: line.unit,
    unit_price_snapshot: line.price,
    line_total: line.total,
    staff_notes: line.needsCheck ? "Owner check needed." : null,
  }));
}

/**
 * A first attempt can persist the order header and then fail before the item rows
 * land. Collecting that order on retry would record money with no lines and no
 * stock depletion. Repair before collection: if the order has no items, write them
 * (same-subtotal retries only — money is never silently changed).
 */
async function repairMissingItems(
  order: OrderRow,
  orderLines: ResolvedServeLine[],
  auth: { branchId: string; profileId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createSupabaseServiceClient();

  const { count, error: countError } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);
  if (countError) return { ok: false, message: "Try again." };

  const { data: row, error: rowError } = await supabase
    .from("orders")
    .select("subtotal")
    .eq("id", order.id)
    .single<{ subtotal: string | number }>();
  if (rowError || !row) return { ok: false, message: "Try again." };

  const decision = serveRepairDecision({
    status: order.status,
    itemCount: count ?? 0,
    persistedSubtotal: Number(row.subtotal),
    resolvedSubtotal: serveSubtotal(orderLines),
  });

  if (decision === "proceed") return { ok: true };

  if (decision === "insert-items") {
    const { error: itemError } = await supabase
      .from("order_items")
      .insert(toItemRows(orderLines, auth.branchId, order.id));
    if (itemError) return { ok: false, message: "Try again." };
    return { ok: true };
  }

  // escalate: header-only order whose retry resolves to different money.
  await createOwnerAlert({
    branchId: auth.branchId,
    profileId: auth.profileId,
    kind: "operator_sale_check_needed",
    summary: "A shop sale did not save cleanly and needs the owner.",
    entityRef: `${order.id}:repair`,
    metadata: { orderId: order.id, orderRef: order.order_ref, reason: "retry_subtotal_mismatch" },
  });
  return { ok: false, message: "This did not save. Do not enter it again. The owner has been told." };
}

async function getAfterCare(orderId: string) {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("order_inventory_depletions")
    .select("status,shortfall_detail")
    .eq("order_id", orderId)
    .eq("source_event", "SALE_COLLECT")
    .maybeSingle<DepleteRow>();
  return data ?? null;
}

function firstShortName(row: DepleteRow | null) {
  const name = row?.shortfall_detail?.[0]?.product_name;
  return typeof name === "string" && name.trim() ? name.trim() : "this item";
}

export async function saveSimpleSale(input: {
  runId: string;
  lines: ServeLineInput[];
  payKind: PayKind;
}): Promise<OperatorActionResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };
  if (!isUuid(input.runId)) return { ok: false, message: "Go back and try again." };

  const payKind = cleanPay(input.payKind);
  if (!payKind) return { ok: false, message: "How did they pay?" };

  const completed = await readCompletedRun(input.runId);
  if (completed) return { ok: true, message: "Saved.", id: completed.replace(/^order:/, "") };

  const lines = cleanLines(input.lines);
  if (lines.length === 0) return { ok: false, message: "What did they buy?" };

  const supabase = createSupabaseServiceClient();
  const ids = [...new Set(lines.map((line) => line.productId).filter(Boolean))] as string[];
  const products = ids.length
    ? await supabase.from("products").select("id,branch_id,name,unit_type,price_per_unit").eq("branch_id", auth.branchId).in("id", ids)
    : { data: [], error: null };

  if (products.error) return { ok: false, message: "Try again." };

  const byId = new Map((products.data as ProductRow[]).map((product) => [product.id, product]));

  // F5/F6: resolve + validate lines through the shared pure helper. Rejects any
  // each/box product (weight flow only) and any custom line without a real price.
  const resolved = resolveServeLines(lines, byId);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const orderLines = resolved.lines;

  const existing = await getExistingByRun(input.runId);
  if (existing) {
    const repaired = await repairMissingItems(existing, orderLines, auth);
    if (!repaired.ok) return repaired;
    const collected = await collectOrder(existing, payKind, input.runId);
    if (!collected.ok) return collected;
    await saveOperatorRun({
      runId: input.runId,
      branchId: auth.branchId,
      profileId: auth.profileId,
      workflow: "serve",
      status: "completed",
      steps: { lines, payKind },
      resultRef: `order:${existing.id}`,
    });
    return { ok: true, message: "Saved.", id: existing.id };
  }

  const date = todayIso();
  const orderRef = await nextRef(auth.branchId, date);
  if (!orderRef) return { ok: false, message: "Try again." };

  const subtotal = serveSubtotal(orderLines);
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      branch_id: auth.branchId,
      order_ref: orderRef,
      // A walk-in counter sale has no customer. Store no identity rather than the old
      // fiction ('Shop sale' / '07000000000') — see the phase2 phantom-customer
      // migration. Stock/audit/money key off branch+order, not the customer.
      customer_name: null,
      customer_phone: null,
      status: "incoming",
      pickup_date: date,
      subtotal,
      payment_method: payKind,
      notes: orderLines.some((line) => line.needsCheck) ? "Owner check needed." : null,
      idempotency_key: `operator-serve:${input.runId}`,
      idempotency_fingerprint: `operator-serve:${input.runId}`,
      is_test: false,
    })
    .select("id,order_ref,status")
    .single<OrderRow>();

  if (orderError || !order) {
    const repeated = await getExistingByRun(input.runId);
    if (repeated) return saveSimpleSale(input);
    return { ok: false, message: "Try again." };
  }

  const { error: itemError } = await supabase.from("order_items").insert(toItemRows(orderLines, auth.branchId, order.id));
  if (itemError) return { ok: false, message: "Try again." };

  await supabase.from("order_status_events").insert({
    branch_id: auth.branchId,
    order_id: order.id,
    status: "incoming",
    actor_id: auth.profileId,
    note: "Shop sale.",
  });

  await emitAuditLog({
    eventType: "order_created",
    targetType: "order",
    targetId: order.id,
    branchId: auth.branchId,
    metadata: { order_ref: order.order_ref, subtotal, source: "operator_serve" },
    systemReason: "operator_serve",
  });

  const collected = await collectOrder(order, payKind, input.runId);
  if (!collected.ok) return collected;

  const afterCare = await getAfterCare(order.id);
  const needsCheck = orderLines.some((line) => line.needsCheck);
  const countNeeded = afterCare?.status === "completed_with_shortfall";

  if (needsCheck) {
    await createOwnerAlert({
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_sale_check_needed",
      summary: "Shop sale needs owner check.",
      entityRef: `${order.id}:check`,
      metadata: { orderId: order.id, orderRef: order.order_ref },
    });
  }

  if (countNeeded) {
    await createOwnerAlert({
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_sale_count_needed",
      summary: `${firstShortName(afterCare)} was sold with low stock.`,
      entityRef: `${order.id}:count`,
      metadata: { orderId: order.id, orderRef: order.order_ref },
    });
  }

  await saveOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "serve",
    status: "completed",
    steps: { lines, payKind, orderId: order.id, orderRef: order.order_ref, needsCheck, countNeeded },
    resultRef: `order:${order.id}`,
  });
  await auditOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "serve",
    metadata: { orderId: order.id, orderRef: order.order_ref, lineCount: lines.length, needsCheck, countNeeded },
  });

  revalidatePath("/operator");
  revalidatePath("/operator/serve");
  revalidatePath("/counter");
  revalidatePath("/admin");
  revalidatePath("/admin/today");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/purchasing");

  return {
    ok: true,
    message: needsCheck ? "Saved. Owner will check it." : countNeeded ? "Saved. Tell owner to check this item." : "Saved.",
    id: order.id,
    needsOwner: needsCheck || countNeeded,
  };
}
