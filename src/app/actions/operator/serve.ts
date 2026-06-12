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
import { emitAuditLog } from "@/lib/server/audit";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient, createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type PayKind = "cash" | "card";

type ServeLineInput = {
  productId?: string | null;
  name?: string | null;
  quantityKg: number;
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

function money(value: string | number) {
  return typeof value === "number" ? value : Number(value);
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

async function collectOrder(order: OrderRow): Promise<{ ok: true } | { ok: false; message: string }> {
  if (order.status === "collected") return { ok: true };
  if (order.status === "cancelled") return { ok: false, message: "Try again." };

  const supabase = await createSupabaseServerClient();
  const path =
    order.status === "incoming"
      ? ["prepping", "ready", "collected"]
      : order.status === "prepping"
        ? ["ready", "collected"]
        : ["collected"];

  for (const next of path) {
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

  return { ok: true };
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

  const existing = await getExistingByRun(input.runId);
  if (existing) {
    const collected = await collectOrder(existing);
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

  const supabase = createSupabaseServiceClient();
  const ids = [...new Set(lines.map((line) => line.productId).filter(Boolean))] as string[];
  const products = ids.length
    ? await supabase.from("products").select("id,branch_id,name,unit_type,price_per_unit").eq("branch_id", auth.branchId).in("id", ids)
    : { data: [], error: null };

  if (products.error) return { ok: false, message: "Try again." };

  const byId = new Map((products.data as ProductRow[]).map((product) => [product.id, product]));
  const orderLines = lines.map((line) => {
    const product = line.productId ? byId.get(line.productId) ?? null : null;
    const name = product?.name ?? line.name ?? "Other";
    const unit = product?.unit_type ?? "kg";
    const price = product ? money(product.price_per_unit) : 0;
    const total = Math.round(line.quantityKg * price * 100) / 100;
    return {
      product,
      name,
      unit,
      price,
      total,
      quantity: line.quantityKg,
      needsCheck: !product,
    };
  });

  const date = todayIso();
  const orderRef = await nextRef(auth.branchId, date);
  if (!orderRef) return { ok: false, message: "Try again." };

  const subtotal = orderLines.reduce((sum, line) => sum + line.total, 0);
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      branch_id: auth.branchId,
      order_ref: orderRef,
      customer_name: "Shop sale",
      customer_phone: "07000000000",
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

  const itemRows = orderLines.map((line) => ({
    branch_id: auth.branchId,
    order_id: order.id,
    product_id: line.product?.id ?? null,
    product_name_snapshot: line.name,
    quantity: line.quantity,
    unit_type: line.unit,
    unit_price_snapshot: line.price,
    line_total: line.total,
    staff_notes: line.needsCheck ? "Owner check needed." : null,
  }));

  const { error: itemError } = await supabase.from("order_items").insert(itemRows);
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

  const collected = await collectOrder(order);
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
