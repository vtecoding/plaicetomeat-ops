import "server-only";

import type { CertificateState } from "@/lib/domain/compliance-inventory";
import { getCertificateState } from "@/lib/domain/compliance-inventory";
import type { Product } from "@/lib/domain/types";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type Supplier = {
  id: string;
  branchId: string | null;
  branchName: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  certifyingBody: string | null;
  certNumber: string | null;
  certExpiry: string | null;
  active: boolean;
  notes: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  documentUrl: string | null;
  status: CertificateState;
  updatedAt: string;
};

export type InventoryBatch = {
  id: string;
  branchId: string;
  productId: string;
  productName: string;
  supplierId: string | null;
  supplierName: string | null;
  receivedDate: string;
  expiryDate: string;
  receivedWeightKg: number;
  remainingWeightKg: number;
  invoiceCost: number;
  costPerKg: number;
  halalCertRef: string | null;
  countryOfOrigin: string | null;
  slaughterDate: string | null;
  storageLocation: string | null;
  batchNumber: string | null;
  status: "active" | "depleted" | "disposed" | "recalled";
  daysToExpiry: number;
  estimatedValueAtRisk: number;
};

type SupplierRow = {
  id: string;
  branch_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  halal_certifying_body: string | null;
  cert_number: string | null;
  cert_expiry: string | null;
  active: boolean | null;
  notes: string | null;
  updated_at: string | null;
  branch: { name: string | null } | { name: string | null }[] | null;
  supplier_documents?: SupplierDocumentRow[];
};

type SupplierDocumentRow = {
  expiry_date: string | null;
  document_url: string | null;
  verified_at: string | null;
  verifier: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
};

type InventoryBatchRow = {
  id: string;
  branch_id: string;
  product_id: string;
  supplier_id: string | null;
  received_date: string;
  expiry_date: string;
  received_weight_kg: string | number;
  remaining_weight_kg: string | number;
  invoice_cost: string | number | null;
  cost_per_kg: string | number | null;
  halal_cert_ref: string | null;
  country_of_origin: string | null;
  slaughter_date: string | null;
  storage_location: string | null;
  batch_number: string | null;
  status: InventoryBatch["status"];
  product: { name: string | null } | { name: string | null }[] | null;
  supplier: { name: string | null } | { name: string | null }[] | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toNum(value: string | number | null, fallback = 0) {
  if (value === null) return fallback;
  return typeof value === "number" ? value : Number(value);
}

function mapSupplier(row: SupplierRow): Supplier {
  const document = (row.supplier_documents ?? [])[0] ?? null;
  const verifier = first(document?.verifier);
  const certExpiry = document?.expiry_date ?? row.cert_expiry;
  const verifiedAt = document?.verified_at ?? null;

  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: first(row.branch)?.name ?? null,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    certifyingBody: row.halal_certifying_body,
    certNumber: row.cert_number,
    certExpiry,
    active: row.active ?? false,
    notes: row.notes,
    verifiedAt,
    verifiedByName: verifier?.full_name ?? verifier?.email ?? null,
    documentUrl: document?.document_url ?? null,
    status: getCertificateState({ certExpiry, active: row.active, verifiedAt, documentUrl: document?.document_url ?? null }),
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
  };
}

function mapBatch(row: InventoryBatchRow, now = new Date()): InventoryBatch {
  const costPerKg = toNum(row.cost_per_kg, toNum(row.invoice_cost) / Math.max(toNum(row.received_weight_kg), 1));
  const remaining = toNum(row.remaining_weight_kg);
  return {
    id: row.id,
    branchId: row.branch_id,
    productId: row.product_id,
    productName: first(row.product)?.name ?? "Unknown product",
    supplierId: row.supplier_id,
    supplierName: first(row.supplier)?.name ?? null,
    receivedDate: row.received_date,
    expiryDate: row.expiry_date,
    receivedWeightKg: toNum(row.received_weight_kg),
    remainingWeightKg: remaining,
    invoiceCost: toNum(row.invoice_cost),
    costPerKg,
    halalCertRef: row.halal_cert_ref,
    countryOfOrigin: row.country_of_origin,
    slaughterDate: row.slaughter_date,
    storageLocation: row.storage_location,
    batchNumber: row.batch_number,
    status: row.status,
    daysToExpiry: Math.ceil((new Date(`${row.expiry_date}T00:00:00.000Z`).getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000),
    estimatedValueAtRisk: remaining * costPerKg,
  };
}

const SUPPLIER_SELECT = `
  id, branch_id, name, phone, email, address, halal_certifying_body, cert_number,
  cert_expiry, active, notes, updated_at,
  branch:branches(name),
  supplier_documents!supplier_documents_supplier_id_fkey(
    expiry_date, document_url, verified_at,
    verifier:profiles!supplier_documents_verified_by_fkey(full_name, email)
  )
`;

export async function getSuppliers(branchId: string, options: { publicOnly?: boolean } = {}): Promise<Supplier[]> {
  if (!hasSupabaseServiceEnv()) return [];

  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .or(`branch_id.eq.${branchId},branch_id.is.null`)
    .order("name", { ascending: true });

  if (options.publicOnly) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as SupplierRow[]).map(mapSupplier);
}

export async function getInventoryBatches(branchId: string): Promise<InventoryBatch[]> {
  if (!hasSupabaseServiceEnv()) return [];

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inventory_batches")
    .select(`
      id, branch_id, product_id, supplier_id, received_date, expiry_date,
      received_weight_kg, remaining_weight_kg, invoice_cost, cost_per_kg,
      halal_cert_ref, country_of_origin, slaughter_date, storage_location,
      batch_number, status,
      product:products(name),
      supplier:suppliers(name)
    `)
    .eq("branch_id", branchId)
    .order("expiry_date", { ascending: true });

  if (error || !data) return [];

  return (data as InventoryBatchRow[]).map((row) => mapBatch(row));
}

export function getBatchesAtRisk(batches: InventoryBatch[]) {
  return batches.filter((batch) => batch.status === "active" && batch.remainingWeightKg > 0 && batch.daysToExpiry <= 3);
}

export function summariseCompliance(suppliers: Supplier[]) {
  return {
    configured: suppliers.length > 0,
    expired: suppliers.filter((supplier) => supplier.status === "expired").length,
    expiringSoon: suppliers.filter((supplier) => supplier.status === "expiring_soon").length,
    missing: suppliers.filter((supplier) => supplier.status === "missing_expiry").length,
  };
}

export function getProductOptions(products: Product[]) {
  return products.map((product) => ({ id: product.id, name: product.name }));
}
