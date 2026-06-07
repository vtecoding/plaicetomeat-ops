import "server-only";

import { getDemoOrders } from "@/lib/data/demo";
import { getLocalIsoDate } from "@/lib/domain/checkout-rules";
import type { BasketItem, Order, OrderItem, OrderNote, OrderStatus, UnitType } from "@/lib/domain/types";
import { checkRateLimit, clientNetworkHash } from "@/lib/server/rate-limit";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { createCheckoutSchema, mergeCheckoutBasketItems, type CheckoutInput } from "@/lib/validation/checkout";

type CheckoutResult =
  | {
      ok: true;
      orderRef: string;
      publicAccessId: string;
      message: string;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

type OrderItemRow = {
  id: string;
  product_name_snapshot: string;
  quantity: string | number;
  unit_type: UnitType;
  unit_price_snapshot: string | number;
  line_total: string | number;
};

type OrderRow = {
  id: string;
  branch_id: string;
  order_ref: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  status: OrderStatus;
  pickup_window_id: string | null;
  pickup_date: string;
  subtotal: string | number;
  notes: string | null;
  ready_sms_sent_at: string | null;
  sms_status: Order["smsStatus"];
  sms_failure_reason: string | null;
  is_test: boolean | null;
  created_at: string;
  order_items?: OrderItemRow[];
};

const ORDER_SELECT = `
  id,
  branch_id,
  order_ref,
  customer_name,
  customer_phone,
  customer_email,
  status,
  pickup_window_id,
  pickup_date,
  subtotal,
  notes,
  ready_sms_sent_at,
  sms_status,
  sms_failure_reason,
  is_test,
  created_at,
  order_items (
    id,
    product_name_snapshot,
    quantity,
    unit_type,
    unit_price_snapshot,
    line_total
  )
`;

/**
 * The single hardened checkout service. Both the storefront server action and
 * the public POST /api/checkout route go through here, so validation, payload
 * caps, duplicate-SKU merging, rate limiting, the server-only test-order gate,
 * and the service-role RPC are identical on every path.
 */
export async function submitCheckout(rawInput: unknown, options: { now?: Date } = {}): Promise<CheckoutResult> {
  // Merge duplicate SKUs BEFORE validation so per-SKU caps and the distinct-SKU
  // limit apply to aggregate quantities, never per-line.
  const prepared = prepareCheckoutInput(rawInput);
  const parsed = createCheckoutSchema({ now: options.now }).safeParse(prepared);

  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: parsed.error.issues[0]?.message ?? "Checkout details are invalid.",
    };
  }

  if (!hasSupabaseServiceEnv()) {
    return {
      ok: false,
      status: 503,
      message: "Live checkout needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before orders can be written.",
    };
  }

  // Throttle BEFORE any mutation. Fail closed: a limiter outage must not become a
  // free pass to spam order creation. Keyed on the hashed network identity.
  const rate = await checkRateLimit("checkout", await clientNetworkHash(), { failClosed: true });
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      message: "Too many checkout attempts just now. Please wait a moment and try again.",
    };
  }

  // Test orders are only honoured when explicitly enabled server-side, so the
  // flag cannot be abused from the public client in production.
  const isTest = Boolean(parsed.data.isTest) && isCheckoutTestModeEnabled();

  return createCheckoutOrder({ ...parsed.data, isTest });
}

/** Normalise raw checkout input by merging duplicate basket SKUs (if present). */
function prepareCheckoutInput(rawInput: unknown): unknown {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }
  const record = rawInput as Record<string, unknown>;
  if (!("basket" in record)) {
    return rawInput;
  }
  return { ...record, basket: mergeCheckoutBasketItems(record.basket) };
}

/** Server-side gate for safe test orders. Default OFF. */
export function isCheckoutTestModeEnabled(): boolean {
  return process.env.CHECKOUT_TEST_MODE_ENABLED === "true";
}

export async function getCounterOrders(branchId: string, now = new Date()): Promise<Order[]> {
  if (!hasSupabaseServiceEnv()) {
    return getDemoOrders(now);
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("branch_id", branchId)
    .eq("pickup_date", getLocalIsoDate(now))
    .order("created_at", { ascending: false });

  if (error || !data) {
    return getDemoOrders(now);
  }

  return (data as OrderRow[]).map(mapOrderRow);
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  if (!hasSupabaseServiceEnv()) {
    return getDemoOrders().find((order) => order.id === orderId) ?? null;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("id", orderId).maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapOrderRow(data as OrderRow);
}

// NOTE: getOrderByRef was removed in V11.1. The public order flow must never read
// an internal order by its (enumerable) reference. Public routes use the safe
// access-id RPCs in src/lib/server/public-order-access.ts instead.

type OrderNoteRow = {
  id: string;
  order_id: string;
  note: string;
  created_at: string;
  author: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
};

/**
 * Fetch staff notes for a set of orders, grouped by order id. Internal-only:
 * order_notes are never exposed to customer-facing routes.
 */
export async function getOrderNotes(orderIds: string[]): Promise<Record<string, OrderNote[]>> {
  if (orderIds.length === 0 || !hasSupabaseServiceEnv()) {
    return {};
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("order_notes")
    .select("id, order_id, note, created_at, author:profiles!order_notes_created_by_fkey(full_name, email)")
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return {};
  }

  const grouped: Record<string, OrderNote[]> = {};

  for (const row of data as OrderNoteRow[]) {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    const note: OrderNote = {
      id: row.id,
      orderId: row.order_id,
      note: row.note,
      authorName: author?.full_name ?? author?.email ?? null,
      createdAt: row.created_at,
    };

    (grouped[row.order_id] ??= []).push(note);
  }

  return grouped;
}

// Customer-safe fragments raised intentionally by create_checkout_order. Anything
// else (raw DB/constraint/network errors) is replaced with a generic message and
// logged server-side, so customers never see internal database detail.
const SAFE_CHECKOUT_MESSAGES = [
  "no longer available",
  "Branch is not available",
  "Pickup window is not available",
  "Pickup date cannot be in the past",
  "Same-day orders close",
  "shop is closed",
  "pickup window is full",
  "Minimum order is",
];

function safeCheckoutMessage(raw: string | undefined): string {
  if (raw && SAFE_CHECKOUT_MESSAGES.some((fragment) => raw.includes(fragment))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return "Sorry — we couldn't place your order just now. Please check your details and try again, or call the shop.";
}

async function createCheckoutOrder(input: CheckoutInput): Promise<CheckoutResult> {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase.rpc("create_checkout_order", {
    p_branch_id: input.branchId,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_email: input.customerEmail ?? null,
    p_pickup_date: input.pickupDate,
    p_pickup_window_id: input.pickupWindowId,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_items: input.basket.map(toRpcBasketItem),
    p_is_test: input.isTest ?? false,
  });

  if (error) {
    const isKnown = SAFE_CHECKOUT_MESSAGES.some((fragment) => error.message.includes(fragment));
    if (!isKnown) {
      // Real fault, not a business rule — keep the detail for developers only.
      console.error("[checkout] create_checkout_order failed", { branchId: input.branchId, error: error.message });
    }
    return {
      ok: false,
      status: error.message.includes("no longer available") ? 409 : 400,
      message: safeCheckoutMessage(error.message),
    };
  }

  // create_checkout_order now returns { orderRef, publicAccessId }.
  const result = data as { orderRef?: string; publicAccessId?: string } | null;
  if (!result?.orderRef || !result?.publicAccessId) {
    console.error("[checkout] unexpected RPC result shape", { branchId: input.branchId });
    return {
      ok: false,
      status: 500,
      message: "Sorry — we couldn't place your order just now. Please call the shop.",
    };
  }

  return {
    ok: true,
    orderRef: result.orderRef,
    publicAccessId: result.publicAccessId,
    message: "Order created.",
  };
}

function toRpcBasketItem(item: BasketItem) {
  return {
    productId: item.productId,
    quantity: item.quantity,
  };
}

function mapOrderRow(row: OrderRow): Order {
  return {
    id: row.id,
    branchId: row.branch_id,
    orderRef: row.order_ref,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    status: row.status,
    pickupWindowId: row.pickup_window_id,
    pickupDate: row.pickup_date,
    subtotal: toNumber(row.subtotal),
    notes: row.notes,
    readySmsSentAt: row.ready_sms_sent_at,
    smsStatus: row.sms_status ?? null,
    smsFailureReason: row.sms_failure_reason,
    isTest: row.is_test ?? false,
    createdAt: row.created_at,
    items: (row.order_items ?? []).map(mapOrderItemRow),
  };
}

function mapOrderItemRow(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    productNameSnapshot: row.product_name_snapshot,
    quantity: toNumber(row.quantity),
    unitType: row.unit_type,
    unitPriceSnapshot: toNumber(row.unit_price_snapshot),
    lineTotal: toNumber(row.line_total),
  };
}

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}
