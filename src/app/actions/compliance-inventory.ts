"use server";

import { revalidatePath } from "next/cache";

import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

const SAFE_PATTERNS = [
  "Not authorised",
  "Not authenticated",
  "Supplier name is required",
  "Certifying body is required",
  "Certificate expiry is required",
  "Supplier not found",
  "Product is required",
  "Supplier is required",
  "Received weight must be greater than zero",
  "Remaining weight cannot exceed received weight",
  "Expiry date cannot be before received date",
  "Invoice cost must be zero or greater",
  "Duplicate intake submission",
  "Intake idempotency key already used",
  "Batch not found",
  "Waste quantity must be greater than zero",
  "Waste quantity cannot exceed remaining weight",
  "Waste reason is required",
  "Invalid waste reason",
  "Adjustment reason is required",
];

function safeMessage(raw: string | undefined, fallback: string) {
  if (raw && SAFE_PATTERNS.some((pattern) => raw.includes(pattern))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

async function requireManager(): Promise<{ ok: true; branchId: string; profileId: string } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!MANAGER_ROLES.includes(profile.role)) return { ok: false, message: "Only managers and owners can do this." };
  if (!profile.branchId && profile.role !== "owner") return { ok: false, message: "No branch is assigned to this account." };
  return { ok: true, branchId: profile.branchId ?? "", profileId: profile.id };
}

function revalidateOps() {
  revalidatePath("/admin");
  revalidatePath("/admin/compliance");
  revalidatePath("/admin/inventory");
  revalidatePath("/our-halal-promise");
}

export async function saveSupplier(input: {
  supplierId?: string;
  branchId: string;
  name: string;
  certifyingBody?: string | null;
  certNumber?: string | null;
  certExpiry?: string | null;
  active: boolean;
  documentUrl?: string | null;
  verified: boolean;
  notes?: string | null;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (!input.name.trim()) return { ok: false, message: "Supplier name is required." };
  if (!input.certifyingBody?.trim()) return { ok: false, message: "Certifying body is required." };
  if (!input.certExpiry || Number.isNaN(new Date(`${input.certExpiry}T00:00:00.000Z`).getTime())) {
    return { ok: false, message: "Certificate expiry is required." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_upsert_supplier_cert", {
    p_supplier_id: input.supplierId ?? null,
    p_branch_id: input.branchId,
    p_name: input.name,
    p_certifying_body: input.certifyingBody ?? null,
    p_cert_number: input.certNumber ?? null,
    p_cert_expiry: input.certExpiry || null,
    p_active: input.active,
    p_document_url: input.documentUrl || null,
    p_verified: input.verified,
    p_notes: input.notes ?? null,
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not save this supplier.") };
  revalidateOps();
  return { ok: true, message: "Supplier saved.", id: String(data) };
}

export const createSupplierCertificate = saveSupplier;
export const updateSupplierCertificate = saveSupplier;

export async function createInventoryBatch(input: {
  branchId: string;
  productId: string;
  supplierId: string;
  receivedDate: string;
  expiryDate: string;
  receivedWeightKg: number;
  remainingWeightKg: number;
  invoiceCost: number;
  halalCertRef?: string | null;
  countryOfOrigin?: string | null;
  slaughterDate?: string | null;
  storageLocation?: string | null;
  batchNumber?: string | null;
  intakeIdempotencyKey?: string | null;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_create_inventory_batch", {
    p_branch_id: input.branchId,
    p_product_id: input.productId,
    p_supplier_id: input.supplierId,
    p_received_date: input.receivedDate,
    p_expiry_date: input.expiryDate,
    p_received_weight_kg: input.receivedWeightKg,
    p_remaining_weight_kg: input.remainingWeightKg,
    p_invoice_cost: input.invoiceCost,
    p_halal_cert_ref: input.halalCertRef ?? null,
    p_country_of_origin: input.countryOfOrigin ?? null,
    p_slaughter_date: input.slaughterDate || null,
    p_storage_location: input.storageLocation ?? null,
    p_batch_number: input.batchNumber ?? null,
    p_intake_idempotency_key: input.intakeIdempotencyKey ?? null,
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not create this batch.") };
  revalidateOps();
  return { ok: true, message: "Batch received.", id: String(data) };
}

export const receiveInventoryBatch = createInventoryBatch;

export async function recordWaste(input: {
  batchId: string;
  quantityKg: number;
  reason: string;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_record_inventory_waste", {
    p_batch_id: input.batchId,
    p_quantity_kg: input.quantityKg,
    p_reason: input.reason,
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not record waste.") };
  revalidateOps();
  return { ok: true, message: "Waste recorded.", id: String(data) };
}

export const recordWasteEvent = recordWaste;

export async function adjustInventoryRemainingWithReason(input: {
  batchId: string;
  newRemainingKg: number;
  reason: string;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_adjust_inventory_remaining", {
    p_batch_id: input.batchId,
    p_new_remaining_kg: input.newRemainingKg,
    p_reason: input.reason,
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not adjust this batch.") };
  revalidateOps();
  return { ok: true, message: "Tracked remaining kg adjusted.", id: String(data) };
}
