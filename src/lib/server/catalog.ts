import "server-only";

import { demoBranch, demoBranchSettings, demoCategories, demoProducts } from "@/lib/data/demo";
import { configurationRequired, healthy, noData, unavailable, type DataResult } from "@/lib/domain/data-result";
import type { Branch, BranchSettings, Product, ProductCategory } from "@/lib/domain/types";
import { allowDemoFallback, configuredCanonicalBranchId, isProductionRuntime } from "@/lib/server/runtime-truth";
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

export async function getPublicBranchResult(): Promise<DataResult<Branch>> {
  if (!hasSupabaseServiceEnv()) {
    return allowDemoFallback()
      ? healthy(demoBranch, "Using explicit development demo branch.")
      : configurationRequired("Supabase service credentials are required before the storefront can choose a branch.");
  }

  const canonicalId = configuredCanonicalBranchId();
  if (isProductionRuntime() && !canonicalId) {
    return configurationRequired("A canonical storefront branch must be configured before production storefront reads are available.");
  }

  const supabase = createSupabaseServiceClient();
  let query = supabase.from("branches").select("id, name, slug, address, phone, timezone").eq("is_active", true);
  query = canonicalId ? query.eq("id", canonicalId) : query.order("created_at", { ascending: true }).limit(1);
  const { data, error } = await query.maybeSingle<BranchRow>();

  if (error) {
    return unavailable("Storefront branch data is temporarily unavailable.", [error.message]);
  }
  if (!data) {
    return canonicalId
      ? configurationRequired("The configured canonical storefront branch was not found or is inactive.")
      : noData<Branch>(null, "No active storefront branch is configured.");
  }

  return healthy({
    id: data.id,
    name: data.name,
    slug: data.slug,
    address: data.address,
    phone: data.phone,
    timezone: data.timezone ?? "Europe/London",
  });
}

/**
 * Compatibility wrapper. Production callers should prefer getPublicBranchResult
 * so configuration/unavailable states can be shown honestly.
 */
export async function getPublicBranch(): Promise<Branch> {
  const result = await getPublicBranchResult();
  if (result.data) return result.data;
  if (allowDemoFallback()) return demoBranch;
  throw new Error(result.message);
}

export async function getBranchSettingsResult(branchId: string): Promise<DataResult<BranchSettings>> {
  if (!hasSupabaseServiceEnv()) {
    return allowDemoFallback()
      ? healthy(demoBranchSettings, "Using explicit development demo branch settings.")
      : configurationRequired("Supabase service credentials are required before branch settings are available.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_settings")
    .select("branch_id, sms_ready_template, cancellation_window_minutes, max_orders_per_day, min_order_value, same_day_cutoff_time")
    .eq("branch_id", branchId)
    .maybeSingle<SettingsRow>();

  if (error) {
    return unavailable("Branch settings are temporarily unavailable.", [error.message]);
  }
  if (!data) {
    return noData<BranchSettings>(null, "No branch settings have been configured yet.");
  }

  return healthy({
    branchId: data.branch_id,
    smsReadyTemplate: data.sms_ready_template ?? demoBranchSettings.smsReadyTemplate,
    cancellationWindowMinutes: data.cancellation_window_minutes ?? 60,
    maxOrdersPerDay: data.max_orders_per_day,
    minOrderValue: toNum(data.min_order_value, 0),
    sameDayCutoffTime: (data.same_day_cutoff_time ?? "16:00").slice(0, 5),
  });
}

export async function getBranchSettings(branchId: string): Promise<BranchSettings> {
  const result = await getBranchSettingsResult(branchId);
  if (result.data) return result.data;
  if (allowDemoFallback()) return { ...demoBranchSettings, branchId };
  throw new Error(result.message);
}

export async function getBranchByIdResult(branchId: string): Promise<DataResult<Branch>> {
  if (!hasSupabaseServiceEnv()) {
    return allowDemoFallback()
      ? healthy({ ...demoBranch, id: branchId })
      : configurationRequired("Supabase service credentials are required before branch details are available.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, slug, address, phone, timezone")
    .eq("id", branchId)
    .maybeSingle<BranchRow>();

  if (error) {
    return unavailable("Branch details are temporarily unavailable.", [error.message]);
  }
  if (!data) {
    return noData<Branch>(null, "Branch not found.");
  }

  return healthy({
    id: data.id,
    name: data.name,
    slug: data.slug,
    address: data.address,
    phone: data.phone,
    timezone: data.timezone ?? "Europe/London",
  });
}

export async function getBranchById(branchId: string): Promise<Branch> {
  const result = await getBranchByIdResult(branchId);
  if (result.data) return result.data;
  if (allowDemoFallback()) return { ...demoBranch, id: branchId };
  throw new Error(result.message);
}

export async function getActiveCategoriesResult(branchId: string): Promise<DataResult<ProductCategory[]>> {
  if (!hasSupabaseServiceEnv()) {
    return allowDemoFallback()
      ? healthy(demoCategories, "Using explicit development demo categories.")
      : configurationRequired("Supabase service credentials are required before categories are available.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, branch_id, name, slug, sort_order, is_active")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return unavailable("Categories are temporarily unavailable.", [error.message]);
  }
  const categories = (data as CategoryRow[]).map(mapCategory);
  return categories.length === 0 ? noData(categories, "No active categories have been added yet.") : healthy(categories);
}

export async function getActiveCategories(branchId: string): Promise<ProductCategory[]> {
  const result = await getActiveCategoriesResult(branchId);
  if (result.data) return result.data;
  return allowDemoFallback() ? demoCategories : [];
}

/** All categories (active + inactive) for admin use. */
export async function getAllCategoriesResult(branchId: string): Promise<DataResult<ProductCategory[]>> {
  if (!hasSupabaseServiceEnv()) {
    return allowDemoFallback()
      ? healthy(demoCategories, "Using explicit development demo categories.")
      : configurationRequired("Supabase service credentials are required before categories are available.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, branch_id, name, slug, sort_order, is_active")
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: true });

  if (error) {
    return unavailable("Categories are temporarily unavailable.", [error.message]);
  }
  const categories = (data as CategoryRow[]).map(mapCategory);
  return categories.length === 0 ? noData(categories, "No categories have been added yet.") : healthy(categories);
}

export async function getAllCategories(branchId: string): Promise<ProductCategory[]> {
  const result = await getAllCategoriesResult(branchId);
  if (result.data) return result.data;
  return allowDemoFallback() ? demoCategories : [];
}

/** Publicly visible products (available only). */
export async function getPublicProductsResult(branchId: string): Promise<DataResult<Product[]>> {
  if (!hasSupabaseServiceEnv()) {
    return allowDemoFallback()
      ? healthy(demoProducts.filter((p) => p.isAvailable), "Using explicit development demo products.")
      : configurationRequired("Supabase service credentials are required before products are available.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("branch_id", branchId)
    .eq("is_available", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return unavailable("Products are temporarily unavailable.", [error.message]);
  }
  const products = (data as ProductRow[]).map(mapProduct);
  return products.length === 0 ? noData(products, "No products are available yet.") : healthy(products);
}

export async function getPublicProducts(branchId: string): Promise<Product[]> {
  const result = await getPublicProductsResult(branchId);
  if (result.data) return result.data;
  return allowDemoFallback() ? demoProducts.filter((p) => p.isAvailable) : [];
}

export async function getPublicProductBySlugResult(branchId: string, slug: string): Promise<DataResult<Product>> {
  if (!hasSupabaseServiceEnv()) {
    const product = demoProducts.find((p) => p.slug === slug && p.isAvailable) ?? null;
    return allowDemoFallback()
      ? product
        ? healthy(product, "Using explicit development demo product.")
        : noData<Product>(null, "Product not found.")
      : configurationRequired("Supabase service credentials are required before products are available.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("branch_id", branchId)
    .eq("slug", slug)
    .eq("is_available", true)
    .maybeSingle<ProductRow>();

  if (error) {
    return unavailable("Product data is temporarily unavailable.", [error.message]);
  }
  if (!data) {
    return noData<Product>(null, "Product not found.");
  }

  return healthy(mapProduct(data));
}

export async function getPublicProductBySlug(branchId: string, slug: string): Promise<Product | null> {
  const result = await getPublicProductBySlugResult(branchId, slug);
  if (result.data) return result.data;
  return allowDemoFallback() ? demoProducts.find((p) => p.slug === slug && p.isAvailable) ?? null : null;
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
export async function getAllProductsResult(branchId: string): Promise<DataResult<Product[]>> {
  if (!hasSupabaseServiceEnv()) {
    return allowDemoFallback()
      ? healthy(demoProducts, "Using explicit development demo products.")
      : configurationRequired("Supabase service credentials are required before products are available.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return unavailable("Products are temporarily unavailable.", [error.message]);
  }
  const products = (data as ProductRow[]).map(mapProduct);
  return products.length === 0 ? noData(products, "No products have been added yet.") : healthy(products);
}

export async function getAllProducts(branchId: string): Promise<Product[]> {
  const result = await getAllProductsResult(branchId);
  if (result.data) return result.data;
  return allowDemoFallback() ? demoProducts : [];
}
