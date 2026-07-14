import type { OrderItem, Product } from "@/lib/domain/types";

export type RefundDisposition = "customer_kept" | "returned_restockable" | "returned_discarded";
export type AmendmentKind = "weight_adjust" | "substitute" | "remove";

export type RefundLineInput = {
  orderItemId: string;
  quantity: number;
  disposition: RefundDisposition;
};

export type RefundMoneyLine = {
  method: "cash" | "card";
  amountPence: number;
  remainingRefundablePence: number;
};

export type RefundPreview = {
  totalAmountPence: number;
  lines: Array<{
    orderItemId: string;
    productName: string;
    unitType: string;
    quantity: number;
    amountPence: number;
    remainingRefundableQuantity: number;
  }>;
  money: RefundMoneyLine[];
};

export type RefundReceipt = RefundPreview & {
  refundOperationId: string;
  orderId: string;
  orderRef: string;
  businessDate: string;
  ownerAlertId: string | null;
  reason: string;
  replayed: boolean;
  lines: Array<RefundPreview["lines"][number] & {
    disposition: RefundDisposition;
    restockedKg: number;
    discardedKg: number;
    netStockEffectKg: number;
  }>;
};

export type AmendmentInput = {
  kind: AmendmentKind;
  newQuantity?: number | null;
  substituteProductId?: string | null;
};

export type AmendmentPreview = {
  productId: string | null;
  productName: string;
  unitType: OrderItem["unitType"];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  priceIncrease: boolean;
  removed: boolean;
};

export function isSubstituteSellable(product: Pick<Product, "isAvailable" | "stockStatus">) {
  return product.isAvailable && product.stockStatus !== "out_of_stock";
}

export function isValidCorrectionQuantity(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  const scaled = value * 1000;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-7;
}

/**
 * Non-authoritative, display-only amendment preview. PostgreSQL's
 * get_effective_order_lines_v18 remains the sole business-state fold; the DB
 * parity gate feeds the same sequences through both implementations.
 */
export function previewOrderAmendment(
  line: OrderItem,
  input: AmendmentInput,
  substitute?: Pick<Product, "id" | "name" | "unitType" | "pricePerUnit">,
): AmendmentPreview {
  let productId = line.productId ?? null;
  let productName = line.productNameSnapshot;
  let unitType = line.unitType;
  let quantity = line.quantity;
  let unitPrice = line.unitPriceSnapshot;

  if (input.kind === "weight_adjust") {
    quantity = input.newQuantity ?? quantity;
  } else if (input.kind === "substitute" && substitute) {
    productId = substitute.id;
    productName = substitute.name;
    unitType = substitute.unitType;
    unitPrice = substitute.pricePerUnit;
  } else if (input.kind === "remove") {
    quantity = input.newQuantity ?? 0;
  }

  const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
  return {
    productId,
    productName,
    unitType,
    quantity,
    unitPrice,
    lineTotal,
    priceIncrease: Math.round(lineTotal * 100) > Math.round(line.lineTotal * 100),
    removed: quantity <= 0,
  };
}

export function refundDispositionLabel(disposition: RefundDisposition) {
  switch (disposition) {
    case "customer_kept":
      return "Customer kept it — no stock movement";
    case "returned_restockable":
      return "Returned and sellable — put back into its original stock";
    case "returned_discarded":
      return "Returned and discarded — record returned waste";
  }
}
