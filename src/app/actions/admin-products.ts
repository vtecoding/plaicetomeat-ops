"use server";

import { revalidatePath } from "next/cache";

import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminProductResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string };

// Curated, user-safe error fragments surfaced from the database RPCs.
const SAFE_MESSAGE_PATTERNS = [
  "Not authorised",
  "Not authenticated",
  "Product name is required",
  "Price must be",
  "Cost must be",
  "Unit type must be",
  "Stock status is invalid",
  "Category does not exist",
  "Product not found",
];

function safeMessage(raw: string | undefined, fallback: string): string {
  if (raw && SAFE_MESSAGE_PATTERNS.some((p) => raw.includes(p))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

async function requireManager(): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await resolveStaffContext("manager");
  return ctx.ok ? { ok: true } : { ok: false, message: ctx.message };
}

function revalidateCatalog() {
  revalidatePath("/admin/products");
  revalidatePath("/shop");
}

export async function createProduct(input: {
  branchId: string;
  name: string;
  description?: string | null;
  price: number;
  categoryId?: string | null;
  unitType: string;
  stockStatus?: string;
}): Promise<AdminProductResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (!Number.isFinite(input.price) || input.price <= 0) {
    return { ok: false, message: "Price must be greater than zero." };
  }
  if (!input.name?.trim()) {
    return { ok: false, message: "Product name is required." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_create_product", {
    p_branch_id: input.branchId,
    p_name: input.name,
    p_description: input.description ?? null,
    p_price: input.price,
    p_category_id: input.categoryId ?? null,
    p_unit_type: input.unitType,
    p_stock_status: input.stockStatus ?? "in_stock",
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not create this product. Please try again.") };
  }

  revalidateCatalog();
  return { ok: true, message: "Product created.", id: String(data) };
}

export async function updateProduct(input: {
  productId: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  unitType?: string | null;
}): Promise<AdminProductResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (!input.name?.trim()) {
    return { ok: false, message: "Product name is required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_product", {
    p_product_id: input.productId,
    p_name: input.name,
    p_description: input.description ?? null,
    p_category_id: input.categoryId ?? null,
    p_unit_type: input.unitType ?? null,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not save this product. Please try again.") };
  }

  revalidateCatalog();
  return { ok: true, message: "Product updated." };
}

export async function updateProductPrice(input: { productId: string; price: number }): Promise<AdminProductResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (!Number.isFinite(input.price) || input.price <= 0) {
    return { ok: false, message: "Price must be greater than zero." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_product_price", {
    p_product_id: input.productId,
    p_price: input.price,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not update the price. Please try again.") };
  }

  revalidateCatalog();
  return { ok: true, message: "Price updated." };
}

export async function updateProductAvailability(input: {
  productId: string;
  isAvailable: boolean;
  stockStatus?: string;
}): Promise<AdminProductResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_product_availability", {
    p_product_id: input.productId,
    p_is_available: input.isAvailable,
    p_stock_status: input.stockStatus ?? null,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not update availability. Please try again.") };
  }

  revalidateCatalog();
  return { ok: true, message: "Availability updated." };
}

/**
 * Commit a cut's worked-out price (and honest cost) from the cutting guide onto a
 * product. This uses one database RPC so price and cost update together.
 */
export async function commitCutToProduct(input: {
  productId: string;
  pricePerKg: number;
  costPerKg: number;
}): Promise<AdminProductResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (!Number.isFinite(input.pricePerKg) || input.pricePerKg <= 0) {
    return { ok: false, message: "Price must be greater than zero." };
  }
  if (!Number.isFinite(input.costPerKg) || input.costPerKg < 0) {
    return { ok: false, message: "Cost must be zero or more." };
  }

  const round2 = (value: number) => Math.round(value * 100) / 100;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("admin_commit_product_price_cost", {
    p_product_id: input.productId,
    p_price: round2(input.pricePerKg),
    p_cost: round2(input.costPerKg),
  });
  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not save the price and cost. Please try again.") };
  }

  revalidateCatalog();
  return { ok: true, message: "Saved price and cost to product." };
}
