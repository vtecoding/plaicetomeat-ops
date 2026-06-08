"use server";

import { ORDER_STATUSES, type Order, type OrderNote, type OrderStatus } from "@/lib/domain/types";
import { getCollectionStockMessage } from "@/lib/server/inventory-depletion";
import { getCounterOrders, getOrderById, getOrderNotes } from "@/lib/server/orders";
import { buildReadySmsOutcome } from "@/lib/server/sms";
import { resolveBranchScopedAccess, resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UpdateOrderStatusResult =
  | { ok: true; order: Order; stockNote?: string }
  | { ok: false; message: string };

export type AddOrderNoteResult =
  | { ok: true; notes: OrderNote[] }
  | { ok: false; message: string };

export type CounterSnapshot = {
  orders: Order[];
  notesByOrderId: Record<string, OrderNote[]>;
};

// Only surface curated, user-safe messages. Anything unexpected becomes generic.
const SAFE_MESSAGE_PATTERNS = [
  "Invalid transition",
  "Order not found",
  "Not authorised",
  "Not authenticated",
  "Unknown order status",
  "Note cannot be empty",
  "Note is too long",
];

function safeMessage(raw: string | undefined, fallback: string): string {
  if (raw && SAFE_MESSAGE_PATTERNS.some((pattern) => raw.includes(pattern))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

async function requireBranchStaff(branchId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  // Owner is branch-global; everyone else may only touch their own branch. A null
  // branch (or any mismatch) fails closed and is audited as a security event.
  const access = await resolveBranchScopedAccess("staff", branchId);
  return access.ok ? { ok: true } : { ok: false, message: access.message };
}

export async function updateOrderStatus(input: {
  orderId: string;
  nextStatus: OrderStatus;
  note?: string;
}): Promise<UpdateOrderStatusResult> {
  const ctx = await resolveStaffContext("staff");

  if (!ctx.ok) {
    return { ok: false, message: ctx.message };
  }

  if (!ORDER_STATUSES.includes(input.nextStatus)) {
    return { ok: false, message: "Unknown order status." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transition_order_status", {
    p_order_id: input.orderId,
    p_next_status: input.nextStatus,
    p_note: input.note ?? null,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not update this order. Please refresh and try again.") };
  }

  let order = await getOrderById(input.orderId);

  if (!order) {
    return { ok: false, message: "Order updated, but it could not be reloaded. Please refresh." };
  }

  // On collection, stock moved (V14.1). Surface a calm, plain-English confirmation
  // of what happened to stock — including a gentle "count this" nudge if the order
  // took more than the system believed it had. Never blocks; never technical.
  if (input.nextStatus === "collected") {
    const stockNote = await getCollectionStockMessage(supabase, input.orderId);
    return { ok: true, order, stockNote };
  }

  // On transition to "ready", attempt the ready SMS. Business rule: the status
  // change must NOT be undone if SMS fails — we record the failure and surface it.
  if (input.nextStatus === "ready") {
    try {
      const outcome = await buildReadySmsOutcome(order);
      await supabase.rpc("record_sms_attempt", {
        p_order_id: order.id,
        p_event_type: "ready",
        p_status: outcome.status,
        p_template_key: outcome.templateKey,
        p_recipient_redacted: outcome.recipientRedacted,
        p_message_preview: outcome.messagePreview,
        p_provider_response: outcome.providerResponse,
        p_failure_reason: outcome.failureReason,
      });
      const refreshed = await getOrderById(input.orderId);
      if (refreshed) {
        order = refreshed;
      }
    } catch {
      // Never let an SMS bookkeeping failure corrupt the (already committed)
      // status transition. The order remains "ready"; SMS simply stays unknown.
    }
  }

  return { ok: true, order };
}

export async function addOrderNote(input: { orderId: string; note: string }): Promise<AddOrderNoteResult> {
  const ctx = await resolveStaffContext("staff");

  if (!ctx.ok) {
    return { ok: false, message: ctx.message };
  }

  const note = input.note.trim();

  if (note.length === 0) {
    return { ok: false, message: "Note cannot be empty." };
  }

  if (note.length > 1000) {
    return { ok: false, message: "Note is too long (max 1000 characters)." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_order_note", {
    p_order_id: input.orderId,
    p_note: note,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not save this note. Please try again.") };
  }

  const notesByOrderId = await getOrderNotes([input.orderId]);

  return { ok: true, notes: notesByOrderId[input.orderId] ?? [] };
}

/**
 * Canonical branch snapshot used for realtime refetch and polling fallback.
 * Re-derives orders + notes from the database so two tabs cannot diverge.
 */
export async function getCounterSnapshot(branchId: string): Promise<CounterSnapshot | { error: string }> {
  const auth = await requireBranchStaff(branchId);

  if (!auth.ok) {
    return { error: auth.message };
  }

  const orders = await getCounterOrders(branchId);
  const notesByOrderId = await getOrderNotes(orders.map((order) => order.id));

  return { orders, notesByOrderId };
}
