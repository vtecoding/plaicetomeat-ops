export type ExpiryCommandItem = {
  productName: string;
  remainingWeightKg: number;
  valueAtRisk: number;
  expiryDate: string;
  daysToExpiry: number;
};

export type WasteEventInput = {
  productName: string;
  wasteKg: number;
  reason: string;
  value: number;
  createdAt: string;
};

export type ProductPerformanceInput = {
  productId: string | null;
  productName: string;
  unitsSold: number;
  unitsWasted: number;
  revenue: number;
  wasteValue: number;
  estimatedCost: number | null;
};

export type CustomerOrderInput = {
  customerName: string;
  customerPhone: string;
  subtotal: number;
  createdAt: string;
};

export type CertificateForecastInput = {
  supplierName: string;
  certExpiry: string | null;
  active: boolean;
};

export type BasketOrderInput = {
  orderId: string;
  subtotal: number;
  createdAt: string;
  items: Array<{
    productId: string | null;
    productName: string;
  }>;
};

export type InventoryDepletionBatchInput = {
  batchId: string;
  productId: string;
  productName: string;
  remainingWeightKg: number;
  status: string;
  expiryDate: string;
  daysToExpiry: number;
};

export type SalesVelocityInput = {
  productId: string | null;
  quantity: number;
  createdAt: string;
};

export type MigrationHealthInput = {
  expected: string[];
  applied: string[];
};

export function buildExpiryCommandCentre(items: ExpiryCommandItem[]) {
  const active = items.filter((item) => item.remainingWeightKg > 0);
  const expiresToday = active.filter((item) => item.daysToExpiry === 0);
  const expiresThisWeek = active.filter((item) => item.daysToExpiry >= 0 && item.daysToExpiry <= 7);
  const expired = active.filter((item) => item.daysToExpiry < 0);

  return {
    expiresToday,
    expiresThisWeek,
    expired,
    valueAtRisk: sum(active.map((item) => item.valueAtRisk)),
  };
}

export function buildWasteAnalytics(events: WasteEventInput[], now = new Date()) {
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const byProduct = groupSum(events, (event) => event.productName, (event) => event.value);
  const byReason = groupSum(events, (event) => normalizeWasteReason(event.reason), (event) => event.value);
  const weekValue = sum(events.filter((event) => new Date(event.createdAt) >= weekStart).map((event) => event.value));
  const monthValue = sum(events.filter((event) => new Date(event.createdAt) >= monthStart).map((event) => event.value));
  const mostWastedProduct = byProduct[0]?.label ?? null;

  return {
    byProduct,
    byReason,
    weekValue,
    monthValue,
    mostWastedProduct,
  };
}

export function buildDailyProfitEstimate(input: {
  revenue: number;
  inventoryCost: number | null;
  wasteCost: number;
}) {
  return {
    revenue: roundMoney(input.revenue),
    inventoryCost: input.inventoryCost === null ? null : roundMoney(input.inventoryCost),
    wasteCost: roundMoney(input.wasteCost),
    estimatedGrossProfit: input.inventoryCost === null ? null : roundMoney(input.revenue - input.inventoryCost - input.wasteCost),
    unavailableReason: input.inventoryCost === null ? "Add a cost to see profit." : null,
  };
}

export function buildProductPerformance(rows: ProductPerformanceInput[]) {
  const products = rows.map((row) => ({
    productId: row.productId,
    productName: row.productName,
    unitsSold: roundWeight(row.unitsSold),
    unitsWasted: roundWeight(row.unitsWasted),
    revenue: roundMoney(row.revenue),
    estimatedProductCost: row.estimatedCost === null ? null : roundMoney(row.estimatedCost),
    wasteCost: roundMoney(row.wasteValue),
    grossProfit: row.estimatedCost === null ? null : roundMoney(row.revenue - row.estimatedCost - row.wasteValue),
    grossMarginPercentage:
      row.estimatedCost === null || row.revenue <= 0
        ? null
        : Math.round(((row.revenue - row.estimatedCost - row.wasteValue) / row.revenue) * 1000) / 10,
    marginUnavailableReason: row.estimatedCost === null ? "Add a cost to see profit." : null,
  }));
  const withMargin = products.filter((product) => product.grossProfit !== null);

  return {
    rows: products,
    best: [...withMargin].sort((a, b) => (b.grossProfit ?? 0) - (a.grossProfit ?? 0)),
    worst: [...withMargin].sort((a, b) => (a.grossProfit ?? 0) - (b.grossProfit ?? 0)),
    highestWasteDrag: [...products].sort((a, b) => b.wasteCost - a.wasteCost)[0] ?? null,
    unavailable: products.filter((product) => product.marginUnavailableReason),
  };
}

export function buildCustomerIntelligence(orders: CustomerOrderInput[]) {
  const grouped = new Map<string, CustomerOrderInput[]>();

  for (const order of orders) {
    const key = order.customerPhone.trim() || order.customerName.trim().toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), order]);
  }

  const customers = [...grouped.values()].map((customerOrders) => {
    const sorted = [...customerOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = sorted[0];

    return {
      customerName: latest.customerName,
      customerPhone: latest.customerPhone,
      orders: customerOrders.length,
      spend: roundMoney(sum(customerOrders.map((order) => order.subtotal))),
      lastOrder: latest.createdAt,
      averageOrderValue: roundMoney(sum(customerOrders.map((order) => order.subtotal)) / customerOrders.length),
    };
  });

  const repeatCustomers = customers.filter((customer) => customer.orders > 1);

  return {
    firstTimeCustomers: customers.length - repeatCustomers.length,
    repeatCustomers: repeatCustomers.length,
    repeatRate: customers.length === 0 ? 0 : Math.round((repeatCustomers.length / customers.length) * 100),
    averageOrderValue: orders.length === 0 ? 0 : roundMoney(sum(orders.map((order) => order.subtotal)) / orders.length),
    topCustomers: [...customers].sort((a, b) => b.spend - a.spend).slice(0, 5),
  };
}

export function buildBasketIntelligence(orders: BasketOrderInput[]) {
  if (orders.length < 5) {
    return {
      status: "insufficient_history" as const,
      realOrderCount: orders.length,
      averageBasketValue: orders.length === 0 ? 0 : roundMoney(sum(orders.map((order) => order.subtotal)) / orders.length),
      topPairings: [],
      bundleSuggestion: null,
      message: "More customer orders are needed before recommendations can be shown.",
    };
  }

  const pairCounts = new Map<string, { productA: string; productB: string; count: number }>();

  for (const order of orders) {
    const uniqueItems = [...new Map(order.items.map((item) => [item.productId ?? item.productName, item])).values()].sort((a, b) =>
      a.productName.localeCompare(b.productName),
    );

    for (let firstIndex = 0; firstIndex < uniqueItems.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < uniqueItems.length; secondIndex += 1) {
        const productA = uniqueItems[firstIndex]?.productName;
        const productB = uniqueItems[secondIndex]?.productName;
        if (!productA || !productB) continue;
        const key = `${productA}::${productB}`;
        const existing = pairCounts.get(key) ?? { productA, productB, count: 0 };
        existing.count += 1;
        pairCounts.set(key, existing);
      }
    }
  }

  const topPairings = [...pairCounts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const top = topPairings[0] ?? null;

  return {
    status: top ? ("ready" as const) : ("no_pairings" as const),
    realOrderCount: orders.length,
    averageBasketValue: roundMoney(sum(orders.map((order) => order.subtotal)) / orders.length),
    topPairings,
    bundleSuggestion: top
      ? `Customers buying ${top.productA} often also buy ${top.productB}. Suggested bundle: Family Protein Pack.`
      : null,
      message: top ? null : "More orders with more than one product are needed before recommendations can be shown.",
  };
}

export function buildInventoryDepletionForecast(
  batches: InventoryDepletionBatchInput[],
  sales: SalesVelocityInput[],
  now = new Date(),
) {
  const salesByProduct = new Map<string, SalesVelocityInput[]>();
  for (const sale of sales) {
    if (!sale.productId) continue;
    salesByProduct.set(sale.productId, [...(salesByProduct.get(sale.productId) ?? []), sale]);
  }

  return batches.map((batch) => {
    if (batch.status !== "active" || batch.remainingWeightKg <= 0) {
      return depletionRow(batch, "no_active_stock", "No active stock.", null);
    }

    if (batch.daysToExpiry < 0) {
      return depletionRow(batch, "expired_stock", "Expired stock should be treated as waste/risk.", null);
    }

    const productSales = salesByProduct.get(batch.productId) ?? [];
    if (productSales.length < 3) {
      return depletionRow(batch, "insufficient_sales_history", "Need more sales history before stock predictions can be shown.", null);
    }

    const earliest = Math.min(...productSales.map((sale) => new Date(sale.createdAt).getTime()));
    const historyDays = Math.max(1, Math.ceil((now.getTime() - earliest) / 86_400_000));
    const dailyVelocity = sum(productSales.map((sale) => sale.quantity)) / historyDays;

    if (dailyVelocity <= 0) {
      return depletionRow(batch, "insufficient_sales_history", "Need more sales history before stock predictions can be shown.", null);
    }

    const daysUntilRunout = Math.round((batch.remainingWeightKg / dailyVelocity) * 10) / 10;

    return depletionRow(
      batch,
      "enough_data",
      `${batch.productName} likely to run out in ${daysUntilRunout.toFixed(1)} days.`,
      daysUntilRunout,
      roundWeight(dailyVelocity),
    );
  });
}

export function buildCertificateForecast(suppliers: CertificateForecastInput[], now = new Date()) {
  const rows = suppliers
    .filter((supplier) => supplier.active)
    .map((supplier) => {
      const daysToExpiry = supplier.certExpiry ? daysUntil(supplier.certExpiry, now) : null;
      return {
        supplierName: supplier.supplierName,
        certExpiry: supplier.certExpiry,
        daysToExpiry,
        band: certificateBand(daysToExpiry),
      };
    });

  const critical = rows.filter((row) => row.band === "expired" || row.band === "expires_7_days").length;
  const attention = rows.filter((row) => row.band === "expires_30_days" || row.band === "missing").length;

  return {
    rows,
    status: critical > 0 ? "Critical" : attention > 0 ? "Attention Required" : "Healthy",
  };
}

export function buildMigrationHealth(input: MigrationHealthInput) {
  const appliedSet = new Set(input.applied);
  const missing = input.expected.filter((version) => !appliedSet.has(version));

  return {
    expected: input.expected,
    applied: input.applied,
    missing,
    healthy: missing.length === 0,
  };
}

export function normalizeWasteReason(reason: string) {
  switch (reason) {
    case "expired":
      return "Expired";
    case "damaged":
      return "Damaged";
    case "trim_loss":
    case "contaminated":
      return "Trim loss";
    case "customer_issue":
    case "customer_return":
      return "Customer issue";
    default:
      return "Other";
  }
}

function certificateBand(daysToExpiry: number | null) {
  if (daysToExpiry === null) return "missing";
  if (daysToExpiry < 0) return "expired";
  if (daysToExpiry <= 7) return "expires_7_days";
  if (daysToExpiry <= 30) return "expires_30_days";
  if (daysToExpiry <= 90) return "expires_90_days";
  return "healthy";
}

function daysUntil(date: string, now = new Date()) {
  const target = new Date(`${date}T00:00:00.000Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function groupSum<T>(items: T[], label: (item: T) => string, value: (item: T) => number) {
  const grouped = new Map<string, number>();
  for (const item of items) {
    const key = label(item);
    grouped.set(key, (grouped.get(key) ?? 0) + value(item));
  }

  return [...grouped.entries()]
    .map(([itemLabel, itemValue]) => ({ label: itemLabel, value: roundMoney(itemValue) }))
    .sort((a, b) => b.value - a.value);
}

function sum(values: number[]) {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundWeight(value: number) {
  return Math.round(value * 1000) / 1000;
}

function depletionRow(
  batch: InventoryDepletionBatchInput,
  state: "enough_data" | "insufficient_sales_history" | "no_active_stock" | "expired_stock" | "data_error",
  message: string,
  daysUntilRunout: number | null,
  dailyVelocityKg: number | null = null,
) {
  return {
    batchId: batch.batchId,
    productId: batch.productId,
    productName: batch.productName,
    remainingWeightKg: roundWeight(batch.remainingWeightKg),
    expiryDate: batch.expiryDate,
    daysToExpiry: batch.daysToExpiry,
    state,
    message,
    daysUntilRunout,
    dailyVelocityKg,
  };
}
