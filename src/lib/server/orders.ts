import "server-only";

import { getDemoOrders } from "@/lib/data/demo";
import { getLocalIsoDate } from "@/lib/domain/checkout-rules";
import type { BasketItem, Order, OrderItem, OrderStatus, UnitType } from "@/lib/domain/types";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { createCheckoutSchema, type CheckoutInput } from "@/lib/validation/checkout";

type CheckoutResult =
  | {
      ok: true;
      orderRef: string;
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

export async function submitCheckout(rawInput: unknown, options: { now?: Date } = {}): Promise<CheckoutResult> {
  const parsed = createCheckoutSchema({ now: options.now }).safeParse(rawInput);

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

  return createCheckoutOrder(parsed.data);
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

export async function getOrderByRef(orderRef: string): Promise<Order | null> {
  if (!hasSupabaseServiceEnv()) {
    return getDemoOrders().find((order) => order.orderRef === orderRef) ?? null;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("order_ref", orderRef).maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapOrderRow(data as OrderRow);
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
  });

  if (error) {
    return {
      ok: false,
      status: error.message.includes("no longer available") ? 409 : 400,
      message: error.message,
    };
  }

  return {
    ok: true,
    orderRef: String(data),
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
