export const ORDER_STATUSES = [
  "incoming",
  "prepping",
  "ready",
  "collected",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

import type { SmsStatus } from "@/lib/domain/sms";

export type UnitType = "kg" | "each" | "box";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type PickupWindowType = "standard" | "commuter" | "weekend";
export type ComplianceReadingType = "opening" | "midday" | "closing" | "ad_hoc";

export type Branch = {
  id: string;
  name: string;
  slug: string;
  address: string;
  phone: string | null;
  timezone: string;
};

export type BranchSettings = {
  branchId: string;
  smsReadyTemplate: string;
  cancellationWindowMinutes: number;
  maxOrdersPerDay: number | null;
  minOrderValue: number;
  sameDayCutoffTime: string;
};

export type ProductCategory = {
  id: string;
  branchId: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};

export type Product = {
  id: string;
  branchId: string;
  categoryId: string | null;
  name: string;
  slug: string;
  description: string | null;
  unitType: UnitType;
  pricePerUnit: number;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  imageUrl: string | null;
  isAvailable: boolean;
  stockStatus: StockStatus;
  requiresWeightConfirmation: boolean;
  sortOrder: number;
};

export type PickupWindow = {
  id: string;
  branchId: string;
  label: string;
  startTime: string;
  endTime: string;
  cutoffTime: string | null;
  maxOrders: number | null;
  daysOfWeek: number[];
  windowType: PickupWindowType;
  isActive: boolean;
};

export type BasketItem = {
  productId: string;
  productSlug: string;
  name: string;
  quantity: number;
  unitType: UnitType;
  unitPriceSnapshot: number;
};

export type Basket = {
  branchId: string;
  items: BasketItem[];
  updatedAt: string;
};

export type OrderItem = {
  id: string;
  productNameSnapshot: string;
  quantity: number;
  unitType: UnitType;
  unitPriceSnapshot: number;
  lineTotal: number;
};

export type Order = {
  id: string;
  branchId: string;
  orderRef: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  status: OrderStatus;
  pickupWindowId: string | null;
  pickupDate: string;
  subtotal: number;
  notes: string | null;
  readySmsSentAt: string | null;
  smsStatus?: SmsStatus | null;
  smsFailureReason?: string | null;
  isTest?: boolean;
  createdAt: string;
  items: OrderItem[];
};

export type OrderNote = {
  id: string;
  orderId: string;
  note: string;
  authorName: string | null;
  createdAt: string;
};

export type ComplianceLog = {
  id: string;
  branchId: string;
  logDate: string;
  cleaningCompleted: boolean;
  sanitisationCompleted: boolean;
  wasteChecked: boolean;
  status: "open" | "completed";
};

export type ComplianceReading = {
  id: string;
  complianceLogId: string;
  readingType: ComplianceReadingType;
  chillerTempC: number;
  freezerTempC: number;
  displayTempC: number | null;
  recordedAt: string;
};
