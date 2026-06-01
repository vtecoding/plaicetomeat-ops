import "server-only";

import { buildOwnerActions } from "@/lib/action-intelligence/action-engine";
import { getRealtimeMode } from "@/lib/domain/compliance-inventory";
import {
  buildBasketIntelligence,
  buildCertificateForecast,
  buildCustomerIntelligence,
  buildDailyProfitEstimate,
  buildExpiryCommandCentre,
  buildInventoryDepletionForecast,
  buildProductPerformance,
  buildWasteAnalytics,
  type ProductPerformanceInput,
} from "@/lib/domain/operations-intelligence";
import { getLocalIsoDate } from "@/lib/domain/checkout-rules";
import { getDemoOrders } from "@/lib/data/demo";
import { getInventoryBatches, getSuppliers } from "@/lib/server/compliance-inventory";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type OpsIntelligence = Awaited<ReturnType<typeof getOperationsIntelligence>>;

type OrderHistoryRow = {
  id: string;
  customer_name: string;
  customer_phone: string;
  subtotal: string | number;
  status: string;
  is_test: boolean | null;
  created_at: string;
};

type OrderItemHistoryRow = {
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  quantity: string | number;
  unit_type: string;
  unit_price_snapshot: string | number;
  line_total: string | number;
  order: { status: string; is_test: boolean | null; created_at: string } | { status: string; is_test: boolean | null; created_at: string }[] | null;
};

type WasteHistoryRow = {
  reason: string;
  waste_kg: string | number;
  created_at: string;
  product: { name: string | null } | { name: string | null }[] | null;
  batch: { cost_per_kg: string | number | null } | { cost_per_kg: string | number | null }[] | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toNum(value: string | number | null, fallback = 0) {
  if (value === null) return fallback;
  return typeof value === "number" ? value : Number(value);
}

export async function getOperationsIntelligence(branchId: string, now = new Date()) {
  const [suppliers, batches] = await Promise.all([getSuppliers(branchId), getInventoryBatches(branchId)]);
  const expiry = buildExpiryCommandCentre(
    batches
      .filter((batch) => batch.status === "active")
      .map((batch) => ({
        productName: batch.productName,
        remainingWeightKg: batch.remainingWeightKg,
        valueAtRisk: batch.estimatedValueAtRisk,
        expiryDate: batch.expiryDate,
        daysToExpiry: batch.daysToExpiry,
      })),
  );
  const compliance = buildCertificateForecast(
    suppliers.map((supplier) => ({
      supplierName: supplier.name,
      certExpiry: supplier.certExpiry,
      active: supplier.active,
    })),
    now,
  );

  if (!hasSupabaseServiceEnv()) {
    return buildFallbackIntelligence(branchId, now, expiry, compliance);
  }

  const supabase = createSupabaseServiceClient();
  const today = getLocalIsoDate(now);
  const yesterday = getLocalIsoDate(new Date(now.getTime() - 86_400_000));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - 120);

  const startOfDay = `${today}T00:00:00.000Z`;
  const [{ data: orderRows, error: orderError }, { data: itemRows, error: itemError }, { data: wasteRows, error: wasteError }, { count: failedSmsToday }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, customer_name, customer_phone, subtotal, status, is_test, created_at")
      .eq("branch_id", branchId)
      .gte("created_at", since.toISOString()),
    supabase
      .from("order_items")
      .select("order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total, order:orders(status, is_test, created_at)")
      .eq("branch_id", branchId)
      .gte("created_at", since.toISOString()),
    supabase
      .from("inventory_waste_events")
      .select("reason, waste_kg, created_at, product:products!inner(name, branch_id), batch:inventory_batches(cost_per_kg)")
      .eq("product.branch_id", branchId)
      .gte("created_at", monthStart),
    supabase
      .from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .eq("status", "failed")
      .gte("created_at", startOfDay),
  ]);

  const orders = ((orderRows ?? []) as OrderHistoryRow[]).filter((order) => !order.is_test && order.status !== "cancelled");
  const orderItems = ((itemRows ?? []) as OrderItemHistoryRow[]).filter((item) => {
    const order = first(item.order);
    return order && !order.is_test && order.status !== "cancelled";
  });
  const wasteEvents = ((wasteRows ?? []) as WasteHistoryRow[]).map((row) => {
    const batch = first(row.batch);
    const wasteKg = toNum(row.waste_kg);
    const costPerKg = toNum(batch?.cost_per_kg ?? null);

    return {
      productName: first(row.product)?.name ?? "Unknown product",
      wasteKg,
      reason: row.reason,
      value: wasteKg * costPerKg,
      createdAt: row.created_at,
    };
  });

  const costByProduct = new Map<string, number>();
  for (const batch of batches) {
    if (!costByProduct.has(batch.productId) && batch.costPerKg > 0) {
      costByProduct.set(batch.productId, batch.costPerKg);
    }
  }

  const todayRevenue = orders
    .filter((order) => order.created_at.startsWith(today))
    .reduce((total, order) => total + toNum(order.subtotal), 0);
  const yesterdayRevenue = orders
    .filter((order) => order.created_at.startsWith(yesterday))
    .reduce((total, order) => total + toNum(order.subtotal), 0);
  const todayInventoryCosts = orderItems
    .filter((item) => first(item.order)?.created_at.startsWith(today))
    .map((item) => estimatedLineCost(item, costByProduct));
  const knownInventoryCosts = todayInventoryCosts.filter((cost): cost is number => cost !== null);
  const todayInventoryCost =
    knownInventoryCosts.length === todayInventoryCosts.length
      ? knownInventoryCosts.reduce((total, cost) => total + cost, 0)
      : null;
  const todayWasteCost = wasteEvents
    .filter((event) => event.createdAt.startsWith(today))
    .reduce((total, event) => total + event.value, 0);
  const yesterdayWaste = wasteEvents
    .filter((event) => event.createdAt.startsWith(yesterday))
    .reduce((total, event) => total + event.value, 0);

  const performanceRows = buildPerformanceRows(orderItems, wasteEvents, costByProduct);
  const productPerformance = buildProductPerformance(performanceRows);
  const customerIntelligence = buildCustomerIntelligence(
    orders.map((order) => ({
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      subtotal: toNum(order.subtotal),
      createdAt: order.created_at,
    })),
  );
  const basket = buildBasketIntelligence(buildBasketOrders(orders, orderItems));
  const depletion = buildInventoryDepletionForecast(
    batches.map((batch) => ({
      batchId: batch.id,
      productId: batch.productId,
      productName: batch.productName,
      remainingWeightKg: batch.remainingWeightKg,
      status: batch.status,
      expiryDate: batch.expiryDate,
      daysToExpiry: batch.daysToExpiry,
    })),
    orderItems
      .filter((item) => item.unit_type === "kg")
      .map((item) => ({
        productId: item.product_id,
        quantity: toNum(item.quantity),
        createdAt: first(item.order)?.created_at ?? now.toISOString(),
      })),
    now,
  );
  const financial = buildDailyProfitEstimate({
    revenue: todayRevenue,
    inventoryCost: todayInventoryCost,
    wasteCost: todayWasteCost,
  });
  const waste = buildWasteAnalytics(wasteEvents, now);
  const dataErrorMessages = [orderError?.message, itemError?.message, wasteError?.message].filter(
    (message): message is string => Boolean(message),
  );
  // Raw database errors are for developers only — never shown to the owner.
  if (dataErrorMessages.length > 0) {
    console.error("[operations-intelligence] data load failed", { branchId, errors: dataErrorMessages });
  }
  const actions = buildOwnerActions({
    createdAt: now.toISOString(),
    expiringStock: expiry.expiresThisWeek
      .concat(expiry.expired)
      .map((item) => ({
        productName: item.productName,
        remainingWeightKg: item.remainingWeightKg,
        valueAtRisk: item.valueAtRisk,
        daysToExpiry: item.daysToExpiry,
      })),
    waste: {
      weekValue: waste.weekValue,
      byProduct: waste.byProduct,
    },
    margin: {
      worst: productPerformance.worst,
      highestWasteDrag: productPerformance.highestWasteDrag,
    },
    customers: customerIntelligence,
    basket,
    compliance,
    system: {
      failedSmsToday: failedSmsToday ?? 0,
      realtimeMode: getRealtimeMode(),
    },
  });

  return {
    expiry,
    waste,
    financial,
    productPerformance,
    margin: productPerformance,
    depletion,
    basket,
    customers: customerIntelligence,
    compliance,
    actions,
    dataState: {
      configured: true,
      status: dataErrorMessages.length > 0 ? ("error" as const) : ("ready" as const),
      message:
        dataErrorMessages.length > 0
          ? "Some of today's figures couldn't be loaded just now. Your orders and counter are unaffected — try refreshing in a few minutes, and let your support person know if it keeps happening."
          : null,
    },
    morning: {
      expiringBatches: expiry.expiresToday.length + expiry.expired.length,
      certificatesExpiring: compliance.rows.filter((row) => row.band !== "healthy").length,
      wasteYesterday: yesterdayWaste,
      revenueYesterday: yesterdayRevenue,
      topProduct: productPerformance.best[0]?.productName ?? "No margin data yet",
    },
  };
}

function buildFallbackIntelligence(
  branchId: string,
  now: Date,
  expiry: ReturnType<typeof buildExpiryCommandCentre>,
  compliance: ReturnType<typeof buildCertificateForecast>,
) {
  const orders = getDemoOrders(now).filter((order) => order.branchId === branchId && !order.isTest && order.status !== "cancelled");
  const items = orders.flatMap((order) =>
    order.items.map((item) => ({
      productId: null,
      productName: item.productNameSnapshot,
      unitsSold: item.quantity,
      unitsWasted: 0,
      revenue: item.lineTotal,
      wasteValue: 0,
      estimatedCost: null,
    })),
  );
  const byName = new Map<string, ProductPerformanceInput>();

  for (const item of items) {
    const existing = byName.get(item.productName) ?? {
      productId: null,
      productName: item.productName,
      unitsSold: 0,
      unitsWasted: 0,
      revenue: 0,
      wasteValue: 0,
      estimatedCost: null,
    };
    existing.unitsSold += item.unitsSold;
    existing.revenue += item.revenue;
    existing.estimatedCost =
      existing.estimatedCost === null || item.estimatedCost === null ? null : existing.estimatedCost + item.estimatedCost;
    byName.set(item.productName, existing);
  }

  const productPerformance = buildProductPerformance([...byName.values()]);

  return {
    expiry,
    waste: buildWasteAnalytics([], now),
    financial: buildDailyProfitEstimate({
      revenue: orders.reduce((total, order) => total + order.subtotal, 0),
      inventoryCost: null,
      wasteCost: 0,
    }),
    productPerformance,
    customers: buildCustomerIntelligence(
      orders.map((order) => ({
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        subtotal: order.subtotal,
        createdAt: order.createdAt,
      })),
    ),
    margin: productPerformance,
    depletion: buildInventoryDepletionForecast([], [], now),
    basket: buildBasketIntelligence([]),
    actions: buildOwnerActions({
      createdAt: now.toISOString(),
      expiringStock: expiry.expiresThisWeek.concat(expiry.expired),
      waste: { weekValue: 0, byProduct: [] },
      margin: { worst: productPerformance.worst, highestWasteDrag: productPerformance.highestWasteDrag },
      customers: buildCustomerIntelligence(
        orders.map((order) => ({
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          subtotal: order.subtotal,
          createdAt: order.createdAt,
        })),
      ),
      basket: buildBasketIntelligence([]),
      compliance,
      system: { failedSmsToday: 0, realtimeMode: "websocket" },
    }),
    dataState: {
      configured: false,
      status: "empty" as const,
      message: "Live intelligence unavailable because Supabase service credentials are not configured.",
    },
    compliance,
    morning: {
      expiringBatches: expiry.expiresToday.length + expiry.expired.length,
      certificatesExpiring: compliance.rows.filter((row) => row.band !== "healthy").length,
      wasteYesterday: 0,
      revenueYesterday: 0,
      topProduct: productPerformance.best[0]?.productName ?? "No margin data yet",
    },
  };
}

function estimatedLineCost(item: OrderItemHistoryRow, costByProduct: Map<string, number>) {
  const productCost = item.product_id ? costByProduct.get(item.product_id) : null;
  if (productCost) {
    return toNum(item.quantity) * productCost;
  }

  return null;
}

function buildPerformanceRows(
  orderItems: OrderItemHistoryRow[],
  wasteEvents: Array<{ productName: string; value: number }>,
  costByProduct: Map<string, number>,
) {
  const byProduct = new Map<string, ProductPerformanceInput>();

  for (const item of orderItems) {
    const key = item.product_id ?? item.product_name_snapshot;
    const existing = byProduct.get(key) ?? {
      productId: item.product_id,
      productName: item.product_name_snapshot,
      unitsSold: 0,
      unitsWasted: 0,
      revenue: 0,
      wasteValue: 0,
      estimatedCost: 0,
    };

    const lineCost = estimatedLineCost(item, costByProduct);
    existing.unitsSold += toNum(item.quantity);
    existing.revenue += toNum(item.line_total);
    existing.estimatedCost = existing.estimatedCost === null || lineCost === null ? null : existing.estimatedCost + lineCost;
    byProduct.set(key, existing);
  }

  for (const event of wasteEvents) {
    const existing = [...byProduct.values()].find((row) => row.productName === event.productName);
    if (existing) {
      existing.wasteValue += event.value;
      existing.unitsWasted += 0;
    } else {
      byProduct.set(`waste:${event.productName}`, {
        productId: null,
        productName: event.productName,
        unitsSold: 0,
        unitsWasted: 0,
        revenue: 0,
        wasteValue: event.value,
        estimatedCost: 0,
      });
    }
  }

  return [...byProduct.values()];
}

function buildBasketOrders(orders: OrderHistoryRow[], items: OrderItemHistoryRow[]) {
  const itemsByOrder = new Map<string, OrderItemHistoryRow[]>();
  for (const item of items) {
    itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
  }

  return orders.map((order) => ({
    orderId: order.id,
    subtotal: toNum(order.subtotal),
    createdAt: order.created_at,
    items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
      productId: item.product_id,
      productName: item.product_name_snapshot,
    })),
  }));
}
