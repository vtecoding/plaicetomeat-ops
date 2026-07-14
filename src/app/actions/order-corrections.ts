"use server";

import { revalidatePath } from "next/cache";

import type {
  AmendmentKind,
  RefundDisposition,
  RefundPreview,
  RefundReceipt,
} from "@/lib/domain/order-corrections";
import { isValidCorrectionQuantity } from "@/lib/domain/order-corrections";
import type { Order } from "@/lib/domain/types";
import { getOrderById } from "@/lib/server/orders";
import { resolveBranchScopedAccess, resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMENDMENT_KINDS: AmendmentKind[] = ["weight_adjust", "substitute", "remove"];
const DISPOSITIONS: RefundDisposition[] = ["customer_kept", "returned_restockable", "returned_discarded"];

type CorrectionFailure = { ok: false; message: string };

function correctionMessage(raw: string | undefined, fallback: string) {
  const safe = [
    "Order not found",
    "Not authorised",
    "Only a collected order",
    "no recorded tender",
    "remaining refundable",
    "net payment received",
    "per-method tender balance",
    "Choose at least one",
    "stock disposition",
    "original depletion",
    "recalled or disposed",
    "Expired returned stock",
    "different details",
    "changed on another screen",
    "can only be adjusted",
    "Order line not found",
    "removed line",
    "Actual weight",
    "kg line",
    "Substitute",
    "substitute product",
    "unit type",
    "customer confirmation",
    "higher final price",
    "Removed quantity",
  ];
  return raw && safe.some((part) => raw.toLowerCase().includes(part.toLowerCase()))
    ? `${raw.replace(/\.$/, "")}.`
    : fallback;
}

function revalidateOrderTruth(orderId: string) {
  revalidatePath("/counter");
  revalidatePath(`/counter/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin/today");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/purchasing");
}

export async function saveOrderAmendment(input: {
  orderId: string;
  orderItemId: string;
  kind: AmendmentKind;
  newQuantity?: number | null;
  substituteProductId?: string | null;
  reason?: string | null;
  idempotencyKey: string;
  expectedSequence: number;
  confirmPriceIncrease: boolean;
}): Promise<{ ok: true; order: Order; sequence: number; priceIncrease: boolean; replayed: boolean } | CorrectionFailure> {
  const ctx = await resolveStaffContext("staff");
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (!UUID_RE.test(input.orderId) || !UUID_RE.test(input.orderItemId) || !UUID_RE.test(input.idempotencyKey)) {
    return { ok: false, message: "This adjustment is invalid. Refresh and try again." };
  }
  if (!AMENDMENT_KINDS.includes(input.kind)) return { ok: false, message: "Choose a valid adjustment." };
  if (!Number.isInteger(input.expectedSequence) || input.expectedSequence < 0) {
    return { ok: false, message: "Refresh this order before adjusting it." };
  }
  if (input.newQuantity != null && !isValidCorrectionQuantity(input.newQuantity)) {
    return { ok: false, message: "Enter a valid quantity with at most three decimal places." };
  }
  if (input.kind === "substitute" && (!input.substituteProductId || !UUID_RE.test(input.substituteProductId))) {
    return { ok: false, message: "Choose a substitute product." };
  }
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 500) return { ok: false, message: "Reason is too long." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("amend_order_item_v18", {
    p_order_id: input.orderId,
    p_order_item_id: input.orderItemId,
    p_kind: input.kind,
    p_new_quantity: input.newQuantity ?? null,
    p_substitute_product_id: input.substituteProductId ?? null,
    p_reason: reason,
    p_idempotency_key: input.idempotencyKey,
    p_expected_seq: input.expectedSequence,
    p_confirm_price_increase: input.confirmPriceIncrease,
  });
  if (error) {
    return { ok: false, message: correctionMessage(error.message, "Could not save this adjustment. Refresh and try again.") };
  }

  const order = await getOrderById(input.orderId);
  if (!order) return { ok: false, message: "Adjustment saved, but the order could not be reloaded. Refresh now." };
  revalidateOrderTruth(input.orderId);
  const result = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    order,
    sequence: Number(result.sequence ?? order.amendmentSequence ?? 0),
    priceIncrease: result.price_increase === true,
    replayed: result.replayed === true,
  };
}

export async function previewOrderRefund(input: {
  orderId: string;
  lines: Array<{ orderItemId: string; quantity: number }>;
}): Promise<{ ok: true; preview: RefundPreview } | CorrectionFailure> {
  const order = UUID_RE.test(input.orderId) ? await getOrderById(input.orderId) : null;
  if (!order) return { ok: false, message: "Order not found." };
  const access = await resolveBranchScopedAccess("manager", order.branchId);
  if (!access.ok) return { ok: false, message: access.message };
  const lines = normalizeRefundLines(input.lines);
  if (!lines) return { ok: false, message: "Choose valid refund quantities." };
  if (hasFractionalCountLine(order, lines)) {
    return { ok: false, message: "Each and box refund quantities must be whole counts." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_refund_order_v18", {
    p_order_id: input.orderId,
    p_lines: lines.map((line) => ({ order_item_id: line.orderItemId, quantity: line.quantity })),
  });
  if (error) {
    return { ok: false, message: correctionMessage(error.message, "Could not check this refund. Refresh and try again.") };
  }
  return { ok: true, preview: mapRefundPreview(data as Record<string, unknown>) };
}

export async function refundOrder(input: {
  refundOperationId: string;
  orderId: string;
  lines: Array<{ orderItemId: string; quantity: number; disposition: RefundDisposition }>;
  reason: string;
}): Promise<{ ok: true; receipt: RefundReceipt } | CorrectionFailure> {
  if (!UUID_RE.test(input.refundOperationId) || !UUID_RE.test(input.orderId)) {
    return { ok: false, message: "This refund is invalid. Refresh and try again." };
  }
  const order = await getOrderById(input.orderId);
  if (!order) return { ok: false, message: "Order not found." };
  const access = await resolveBranchScopedAccess("manager", order.branchId);
  if (!access.ok) return { ok: false, message: access.message };
  const lines = normalizeRefundLines(input.lines, true);
  if (!lines) return { ok: false, message: "Choose valid refund quantities and stock outcomes." };
  if (hasFractionalCountLine(order, lines)) {
    return { ok: false, message: "Each and box refund quantities must be whole counts." };
  }
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 500) {
    return { ok: false, message: "Add a refund reason (maximum 500 characters)." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("refund_order_v18", {
    p_refund_operation_id: input.refundOperationId,
    p_order_id: input.orderId,
    p_lines: lines.map((line) => ({ order_item_id: line.orderItemId, quantity: line.quantity })),
    p_stock_dispositions: lines.map((line) => ({
      order_item_id: line.orderItemId,
      disposition: line.disposition,
    })),
    p_reason: reason,
  });
  if (error) {
    return { ok: false, message: correctionMessage(error.message, "Could not complete this refund. Nothing was changed.") };
  }

  const receipt = mapRefundReceipt(data as Record<string, unknown>);
  revalidateOrderTruth(input.orderId);

  return { ok: true, receipt };
}

function hasFractionalCountLine(
  order: Order,
  lines: Array<{ orderItemId: string; quantity: number }>,
) {
  return lines.some((line) => {
    const orderLine = order.items.find((item) => item.id === line.orderItemId);
    return orderLine?.unitType !== "kg" && !Number.isInteger(line.quantity);
  });
}

function normalizeRefundLines(
  raw: Array<{ orderItemId: string; quantity: number; disposition?: RefundDisposition }>,
  requireDisposition = false,
) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const ids = new Set<string>();
  const lines: Array<{ orderItemId: string; quantity: number; disposition?: RefundDisposition }> = [];
  for (const line of raw) {
    if (!UUID_RE.test(line.orderItemId) || ids.has(line.orderItemId) || !isValidCorrectionQuantity(line.quantity) || line.quantity <= 0) {
      return null;
    }
    if (requireDisposition && (!line.disposition || !DISPOSITIONS.includes(line.disposition))) return null;
    ids.add(line.orderItemId);
    lines.push(line);
  }
  return lines;
}

function objectArray(raw: unknown) {
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function mapRefundPreview(raw: Record<string, unknown>): RefundPreview {
  return {
    totalAmountPence: Number(raw.total_amount_pence ?? 0),
    lines: objectArray(raw.lines).map((line) => ({
      orderItemId: String(line.order_item_id ?? ""),
      productName: String(line.product_name ?? ""),
      unitType: String(line.unit_type ?? ""),
      quantity: Number(line.quantity ?? 0),
      amountPence: Number(line.amount_pence ?? 0),
      remainingRefundableQuantity: Number(line.remaining_refundable_quantity ?? 0),
    })),
    money: objectArray(raw.money).map((money) => ({
      method: money.method === "card" ? "card" : "cash",
      amountPence: Number(money.amount_pence ?? 0),
      remainingRefundablePence: Number(money.remaining_refundable_pence ?? 0),
    })),
  };
}

function mapRefundReceipt(raw: Record<string, unknown>): RefundReceipt {
  const preview = mapRefundPreview(raw);
  return {
    ...preview,
    refundOperationId: String(raw.refund_operation_id ?? ""),
    orderId: String(raw.order_id ?? ""),
    orderRef: String(raw.order_ref ?? ""),
    businessDate: String(raw.business_date ?? ""),
    ownerAlertId: typeof raw.owner_alert_id === "string" ? raw.owner_alert_id : null,
    reason: String(raw.reason ?? ""),
    replayed: raw.replayed === true,
    lines: objectArray(raw.lines).map((line) => ({
      orderItemId: String(line.order_item_id ?? ""),
      productName: String(line.product_name ?? ""),
      unitType: String(line.unit_type ?? ""),
      quantity: Number(line.quantity ?? 0),
      amountPence: Number(line.amount_pence ?? 0),
      remainingRefundableQuantity: Number(line.remaining_refundable_quantity ?? 0),
      disposition: DISPOSITIONS.includes(line.disposition as RefundDisposition)
        ? (line.disposition as RefundDisposition)
        : "customer_kept",
      restockedKg: Number(line.restocked_kg ?? 0),
      discardedKg: Number(line.discarded_kg ?? 0),
      netStockEffectKg: Number(line.net_stock_effect_kg ?? 0),
    })),
  };
}
