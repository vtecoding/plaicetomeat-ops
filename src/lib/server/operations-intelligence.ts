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
import { buildWeightedBatchCostMap, resolveInventoryCost } from "@/lib/domain/cost-sources";
import { getDemoOrders } from "@/lib/data/demo";
import { getProductCostMap } from "@/lib/server/catalog";
import { buildProductMargins } from "@/lib/domain/margin-erosion";
import { getAllProducts } from "@/lib/server/catalog";
import { getInventoryBatches, getSuppliers } from "@/lib/server/compliance-inventory";
import { allowDemoFallback } from "@/lib/server/runtime-truth";
import { addBusinessCalendarDays, getBranchBusinessDate } from "@/lib/server/payment-truth";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type OpsIntelligence = Awaited<ReturnType<typeof getOperationsIntelligence>>;

type OrderHistoryRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: number;
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
  cost_quantity: string | number;
  depletion_quantity: string | number;
  order: { status: string; is_test: boolean | null; created_at: string } | { status: string; is_test: boolean | null; created_at: string }[] | null;
};

type EffectiveOrderLineHistoryRow = {
  order_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  order_status: string;
  is_test: boolean;
  order_created_at: string;
  source_order_item_id: string;
  product_id: string | null;
  product_name: string;
  unit_type: string;
  effective_quantity: string | number;
  effective_unit_price_pence: number;
  line_total_pence: number;
  order_subtotal_pence: number;
  refunded_quantity: string | number;
  refunded_amount_pence: number;
  returned_quantity: string | number;
  stock_returned_kg: string | number;
  is_removed: boolean;
};

type PaymentHistoryRow = {
  order_id: string;
  direction: "sale" | "refund";
  amount_pence: number;
  business_date: string;
  order: { is_test: boolean | null } | { is_test: boolean | null }[] | null;
};

type WasteHistoryRow = {
  reason: string;
  waste_kg: string | number;
  created_at: string;
  product:
    | { id: string; name: string | null; inventory_policy: "kg_batch" | "untracked_manual" }
    | { id: string; name: string | null; inventory_policy: "kg_batch" | "untracked_manual" }[]
    | null;
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
  const [suppliers, batches, productCostMap, products] = await Promise.all([
    getSuppliers(branchId),
    getInventoryBatches(branchId),
    getProductCostMap(branchId),
    getAllProducts(branchId),
  ]);

  // Margin erosion (the silent leak): each kg product's price vs its current/prior batch
  // cost. Pure detection happens in the action engine; here we just shape the inputs.
  const marginErosion = buildProductMargins(
    products.filter((product) => product.inventoryPolicy === "kg_batch").map((product) => ({ id: product.id, name: product.name, pricePerKg: product.pricePerUnit })),
    batches.map((batch) => ({ productId: batch.productId, costPerKg: batch.costPerKg, receivedDate: batch.receivedDate })),
  );
  const expiry = buildExpiryCommandCentre(
    batches
      .filter((batch) => batch.status === "active")
      .map((batch) => ({
        productName: batch.productName,
        inventoryPolicy: batch.inventoryPolicy,
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
    return buildFallbackIntelligence(branchId, now, expiry, compliance, { useDemoOrders: allowDemoFallback() });
  }

  const supabase = createSupabaseServiceClient();
  const today = await getBranchBusinessDate(branchId, now);
  const yesterday = addBusinessCalendarDays(today, -1);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - 120);
  const sinceBusinessDate = addBusinessCalendarDays(today, -120);

  const startOfDay = `${today}T00:00:00.000Z`;
  const [
    { data: effectiveRows, error: effectiveError },
    { data: paymentRows, error: paymentError },
    { data: wasteRows, error: wasteError },
    { count: failedSmsToday },
  ] = await Promise.all([
    supabase.rpc("get_branch_effective_order_lines_v18", {
      p_branch_id: branchId,
      p_since: since.toISOString(),
    }),
    supabase
      .from("payment_events")
      .select("order_id, direction, amount_pence, business_date, order:orders!inner(is_test)")
      .eq("branch_id", branchId)
      .gte("business_date", sinceBusinessDate),
    supabase
      .from("inventory_waste_events")
      .select("reason, waste_kg, created_at, product:products!inner(id, name, branch_id, inventory_policy), batch:inventory_batches(cost_per_kg)")
      .eq("product.branch_id", branchId)
      .eq("product.inventory_policy", "kg_batch")
      .gte("created_at", monthStart),
    supabase
      .from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .eq("status", "failed")
      .gte("created_at", startOfDay),
  ]);

  const canonicalRows = (effectiveRows ?? []) as EffectiveOrderLineHistoryRow[];
  const ordersById = new Map<string, OrderHistoryRow>();
  for (const row of canonicalRows) {
    ordersById.set(row.order_id, {
      id: row.order_id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      subtotal: row.order_subtotal_pence / 100,
      status: row.order_status,
      is_test: row.is_test,
      created_at: row.order_created_at,
    });
  }
  const orders = [...ordersById.values()].filter((order) => !order.is_test && order.status !== "cancelled");
  const realOrderIds = new Set(orders.map((order) => order.id));
  const orderItems = canonicalRows
    .filter((row) => realOrderIds.has(row.order_id) && !row.is_removed)
    .map<OrderItemHistoryRow>((row) => {
      const effectiveQuantity = toNum(row.effective_quantity);
      return {
        order_id: row.order_id,
        product_id: row.product_id,
        product_name_snapshot: row.product_name,
        quantity: Math.max(0, effectiveQuantity - toNum(row.refunded_quantity)),
        cost_quantity: Math.max(0, effectiveQuantity - toNum(row.returned_quantity)),
        depletion_quantity: Math.max(0, effectiveQuantity - toNum(row.stock_returned_kg)),
        unit_type: row.unit_type,
        unit_price_snapshot: row.effective_unit_price_pence / 100,
        line_total: Math.max(0, row.line_total_pence - row.refunded_amount_pence) / 100,
        order: {
          status: row.order_status,
          is_test: row.is_test,
          created_at: row.order_created_at,
        },
      };
    });
  const payments = ((paymentRows ?? []) as PaymentHistoryRow[]).filter((row) => !first(row.order)?.is_test);
  const grossSalePenceByOrder = new Map<string, number>();
  const netPenceByOrder = new Map<string, number>();
  const saleBusinessDateByOrder = new Map<string, string>();
  for (const payment of payments) {
    const sign = payment.direction === "sale" ? 1 : -1;
    netPenceByOrder.set(payment.order_id, (netPenceByOrder.get(payment.order_id) ?? 0) + sign * payment.amount_pence);
    if (payment.direction === "sale") {
      grossSalePenceByOrder.set(
        payment.order_id,
        (grossSalePenceByOrder.get(payment.order_id) ?? 0) + payment.amount_pence,
      );
      saleBusinessDateByOrder.set(payment.order_id, payment.business_date);
    }
  }
  const realisedOrders = orders
    .filter((order) => grossSalePenceByOrder.has(order.id))
    .map((order) => ({
      ...order,
      subtotal: (netPenceByOrder.get(order.id) ?? 0) / 100,
      created_at: `${saleBusinessDateByOrder.get(order.id) ?? today}T12:00:00.000Z`,
    }));
  const realisedOrderIds = new Set(realisedOrders.map((order) => order.id));
  const realisedOrderItems = orderItems
    .filter((item) => realisedOrderIds.has(item.order_id))
    .map((item) => ({
      ...item,
      order: {
        ...(first(item.order) ?? { status: "collected", is_test: false, created_at: now.toISOString() }),
        created_at: `${saleBusinessDateByOrder.get(item.order_id) ?? today}T12:00:00.000Z`,
      },
    }));
  const wasteEvents = ((wasteRows ?? []) as WasteHistoryRow[]).map((row) => {
    const batch = first(row.batch);
    const product = first(row.product);
    const wasteKg = toNum(row.waste_kg);
    const batchCost = resolveInventoryCost(toNum(batch?.cost_per_kg ?? null));
    const costPerKg = batchCost.value ?? (product?.id ? productCostMap.get(product.id) ?? null : null) ?? 0;

    return {
      productName: product?.name ?? "Unknown product",
      wasteKg,
      reason: row.reason,
      value: wasteKg * costPerKg,
      createdAt: row.created_at,
    };
  });

  const weightedBatchCostMap = buildWeightedBatchCostMap(batches);
  const costByProduct = new Map<string, number>();
  for (const [productId, cost] of productCostMap) {
    costByProduct.set(productId, cost);
  }
  for (const [productId, cost] of weightedBatchCostMap) {
    if (!costByProduct.has(productId)) costByProduct.set(productId, cost);
  }

  const todayRevenue =
    payments
      .filter((payment) => payment.business_date === today)
      .reduce(
        (total, payment) => total + (payment.direction === "sale" ? payment.amount_pence : -payment.amount_pence),
        0,
      ) / 100;
  const yesterdayRevenue =
    payments
      .filter((payment) => payment.business_date === yesterday)
      .reduce(
        (total, payment) => total + (payment.direction === "sale" ? payment.amount_pence : -payment.amount_pence),
        0,
      ) / 100;
  const todayInventoryCosts = realisedOrderItems
    .filter((item) => saleBusinessDateByOrder.get(item.order_id) === today)
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

  const performanceRows = buildPerformanceRows(realisedOrderItems, wasteEvents, costByProduct);
  const productPerformance = buildProductPerformance(performanceRows);
  const itemNamesByOrder = new Map<string, string[]>();
  for (const item of realisedOrderItems) {
    if (toNum(item.quantity) <= 0) continue;
    itemNamesByOrder.set(item.order_id, [...(itemNamesByOrder.get(item.order_id) ?? []), item.product_name_snapshot]);
  }
  const customerIntelligence = buildCustomerIntelligence(
    realisedOrders.map((order) => ({
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      subtotal: order.subtotal,
      createdAt: order.created_at,
      items: itemNamesByOrder.get(order.id) ?? [],
    })),
    now,
  );
  const basketOrders = realisedOrders.map((order) => ({
    ...order,
    subtotal: (grossSalePenceByOrder.get(order.id) ?? 0) / 100,
  }));
  const basket = buildBasketIntelligence(buildBasketOrders(basketOrders, realisedOrderItems));
  const depletion = buildInventoryDepletionForecast(
    batches.map((batch) => ({
      batchId: batch.id,
      productId: batch.productId,
      productName: batch.productName,
      inventoryPolicy: batch.inventoryPolicy,
      remainingWeightKg: batch.remainingWeightKg,
      status: batch.status,
      expiryDate: batch.expiryDate,
      daysToExpiry: batch.daysToExpiry,
    })),
    realisedOrderItems
      .filter((item) => item.unit_type === "kg" && toNum(item.depletion_quantity) > 0)
      .map((item) => ({
        productId: item.product_id,
        quantity: toNum(item.depletion_quantity),
        createdAt: `${saleBusinessDateByOrder.get(item.order_id) ?? today}T12:00:00.000Z`,
      })),
    now,
  );
  const financial = buildDailyProfitEstimate({
    revenue: todayRevenue,
    inventoryCost: todayInventoryCost,
    wasteCost: todayWasteCost,
  });
  const waste = buildWasteAnalytics(wasteEvents, now);
  const dataErrorMessages = [effectiveError?.message, paymentError?.message, wasteError?.message].filter(
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
    marginErosion,
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
  options: { useDemoOrders: boolean },
) {
  const orders = options.useDemoOrders
    ? getDemoOrders(now).filter((order) => order.branchId === branchId && !order.isTest && order.status !== "cancelled")
    : [];
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
      status: options.useDemoOrders ? ("empty" as const) : ("error" as const),
      message: options.useDemoOrders
        ? "Live intelligence unavailable because Supabase service credentials are not configured."
        : "Live intelligence is unavailable because Supabase service credentials are not configured. No demo orders were used.",
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
  if (productCost !== null && productCost !== undefined) {
    return toNum(item.cost_quantity) * productCost;
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
    items: (itemsByOrder.get(order.id) ?? [])
      .filter((item) => toNum(item.quantity) > 0)
      .map((item) => ({
        productId: item.product_id,
        productName: item.product_name_snapshot,
      })),
  }));
}
