import { AdminProductsClient } from "@/components/admin-products-client";
import { PageFrame } from "@/components/site-header";
import { getAllCategories, getAllProducts } from "@/lib/server/catalog";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  // Defence in depth: middleware already blocks staff, but never render admin
  // controls for a non-manager, and fail closed if no branch is assigned.
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [products, categories] = await Promise.all([getAllProducts(branchId), getAllCategories(branchId)]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminProductsClient branchId={branchId} initialProducts={products} categories={categories} />
      </main>
    </PageFrame>
  );
}
