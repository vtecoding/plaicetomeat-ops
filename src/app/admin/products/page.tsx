import { redirect } from "next/navigation";

import { AdminProductsClient } from "@/components/admin-products-client";
import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getAllCategories, getAllProducts, getPublicBranch } from "@/lib/server/catalog";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const profile = await getCurrentProfile();

  // Defence in depth: middleware already blocks staff, but never render admin
  // controls for a non-manager.
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const [products, categories] = await Promise.all([getAllProducts(branchId), getAllCategories(branchId)]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminProductsClient branchId={branchId} initialProducts={products} categories={categories} />
      </main>
    </PageFrame>
  );
}
