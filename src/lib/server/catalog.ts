import "server-only";

import { demoBranch, demoBranchSettings, demoCategories, demoProducts } from "@/lib/data/demo";
import type { Branch, BranchSettings, Product, ProductCategory } from "@/lib/domain/types";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type BranchRow = {
  id: string;
  name: string;
  slug: string;
  address: string;
  phone: string | null;
  timezone: string | null;
};

type CategoryRow = {
  id: string;
  branch_id: string;
  name: string;
  slug: string;
  sort_order: number | null;
  is_active: boolean | null;
};

type ProductRow = {
  id: string;
  branch_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  unit_type: Product["unitType"];
  price_per_unit: string | number;
  min_order_quantity: string | number | null;
  max_order_quantity: string | number | null;
  image_url: string | null;
  is_available: boolean | null;
  stock_status: Product["stockStatus"];
  requires_weight_confirmation: boolean | null;
  sort_order: number | null;
};

type SettingsRow = {
  branch_id: string;
  sms_ready_template: string | null;
  cancellation_window_minutes: number | null;
  max_orders_per_day: number | null;
  min_order_value: string | number | null;
  same_day_cutoff_time: string | null;
};

const PRODUCT_SELECT =
  "id, branch_id, category_id, name, slug, description, unit_type, price_per_unit, min_order_quantity, max_order_quantity, image_url, is_available, stock_status, requires_weight_confirmation, sort_order";

function toNum(value: string | number | null, fallback = 0) {
  if (value === null) return fallback;
  return typeof value === "number" ? value : Number(value);
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    branchId: row.branch_id,
    categoryId: row.category_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    unitType: row.unit_type,
    pricePerUnit: toNum(row.price_per_unit),
    minOrderQuantity: toNum(row.min_order_quantity, 0.5),
    maxOrderQuantity: row.max_order_quantity === null ? null : toNum(row.max_order_quantity),
    imageUrl: row.image_url,
    isAvailable: row.is_available ?? false,
    stockStatus: row.stock_status,
    requiresWeightConfirmation: row.requires_weight_confirmation ?? false,
    sortOrder: row.sort_order ?? 0,
  };
}

function mapCategory(row: CategoryRow): ProductCategory {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order ?? 0,
    isActive: row.is_active ?? false,
  };
}

/**
 * The primary public branch. Single-branch storefront: we use the demo branch id
 * (which matches the seeded branch A) as the canonical public branch, falling back
 * to demo data when Supabase is not configured.
 */
export async function getPublicBranch(): Promise<Branch> {
  if (!hasSupabaseServiceEnv()) {
    return demoBranch;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, slug, address, phone, timezone")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<BranchRow>();

  if (error || !data) {
    return demoBranch;
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    address: data.address,
    phone: data.phone,
    timezone: data.timezone ?? "Europe/London",
  };
}

export async function getBranchSettings(branchId: string): Promise<BranchSettings> {
  if (!hasSupabaseServiceEnv()) {
    return demoBranchSettings;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_settings")
    .select("branch_id, sms_ready_template, cancellation_window_minutes, max_orders_per_day, min_order_value, same_day_cutoff_time")
    .eq("branch_id", branchId)
    .maybeSingle<SettingsRow>();

  if (error || !data) {
    return { ...demoBranchSettings, branchId };
  }

  return {
    branchId: data.branch_id,
    smsReadyTemplate: data.sms_ready_template ?? demoBranchSettings.smsReadyTemplate,
    cancellationWindowMinutes: data.cancellation_window_minutes ?? 60,
    maxOrdersPerDay: data.max_orders_per_day,
    minOrderValue: toNum(data.min_order_value, 0),
    sameDayCutoffTime: (data.same_day_cutoff_time ?? "16:00").slice(0, 5),
  };
}

export async function getActiveCategories(branchId: string): Promise<ProductCategory[]> {
  if (!hasSupabaseServiceEnv()) {
    return demoCategories;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, branch_id, name, slug, sort_order, is_active")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error || !data) {
    return demoCategories;
  }

  return (data as CategoryRow[]).map(mapCategory);
}

/** All categories (active + inactive) for admin use. */
export async function getAllCategories(branchId: string): Promise<ProductCategory[]> {
  if (!hasSupabaseServiceEnv()) {
    return demoCategories;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, branch_id, name, slug, sort_order, is_active")
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: true });

  if (error || !data) {
    return demoCategories;
  }

  return (data as CategoryRow[]).map(mapCategory);
}

/** Publicly visible products (available only). */
export async function getPublicProducts(branchId: string): Promise<Product[]> {
  if (!hasSupabaseServiceEnv()) {
    return demoProducts.filter((p) => p.isAvailable);
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("branch_id", branchId)
    .eq("is_available", true)
    .order("sort_order", { ascending: true });

  if (error || !data) {
    return demoProducts.filter((p) => p.isAvailable);
  }

  return (data as ProductRow[]).map(mapProduct);
}

export async function getPublicProductBySlug(branchId: string, slug: string): Promise<Product | null> {
  if (!hasSupabaseServiceEnv()) {
    return demoProducts.find((p) => p.slug === slug && p.isAvailable) ?? null;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("branch_id", branchId)
    .eq("slug", slug)
    .eq("is_available", true)
    .maybeSingle<ProductRow>();

  if (error || !data) {
    return null;
  }

  return mapProduct(data);
}

/**
 * Honest cost-per-kg per product, set via the cutting guide. Best-effort: if the
 * `cost_per_kg` column doesn't exist yet (migration not applied), returns an empty
 * map rather than throwing, so analytics degrade gracefully.
 */
export async function getProductCostMap(branchId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!hasSupabaseServiceEnv()) return map;

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.from("products").select("id, cost_per_kg").eq("branch_id", branchId);
    if (error || !data) return map;
    for (const row of data as Array<{ id: string; cost_per_kg: number | string | null }>) {
      const cost = row.cost_per_kg === null ? 0 : Number(row.cost_per_kg);
      if (cost > 0) map.set(row.id, cost);
    }
  } catch {
    // Column not present yet — no product costs available.
  }
  return map;
}

/** All products (available + unavailable) for admin use. */
export async function getAllProducts(branchId: string): Promise<Product[]> {
  if (!hasSupabaseServiceEnv()) {
    return demoProducts;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) {
    return demoProducts;
  }

  return (data as ProductRow[]).map(mapProduct);
}
