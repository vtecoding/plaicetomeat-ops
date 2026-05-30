"use server";

import { ORDER_STATUSES, type Order, type OrderNote, type OrderStatus } from "@/lib/domain/types";
import { getCurrentProfile } from "@/lib/server/auth";
import { getCounterOrders, getOrderById, getOrderNotes } from "@/lib/server/orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UpdateOrderStatusResult =
  | { ok: true; order: Order }
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
  const profile = await getCurrentProfile();

  if (!profile) {
    return { ok: false, message: "Your session has expired. Please sign in again." };
  }

  if (profile.role !== "owner" && profile.branchId !== branchId) {
    return { ok: false, message: "Not authorised for this branch." };
  }

  return { ok: true };
}

export async function updateOrderStatus(input: {
  orderId: string;
  nextStatus: OrderStatus;
  note?: string;
}): Promise<UpdateOrderStatusResult> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return { ok: false, message: "Your session has expired. Please sign in again." };
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

  const order = await getOrderById(input.orderId);

  if (!order) {
    return { ok: false, message: "Order updated, but it could not be reloaded. Please refresh." };
  }

  return { ok: true, order };
}

export async function addOrderNote(input: { orderId: string; note: string }): Promise<AddOrderNoteResult> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return { ok: false, message: "Your session has expired. Please sign in again." };
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
