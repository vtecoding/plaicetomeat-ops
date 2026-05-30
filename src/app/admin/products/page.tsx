import { ProductCard } from "@/components/product-card";
import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { demoCategories, demoProducts } from "@/lib/data/demo";

export default function AdminProductsPage() {
  const categoriesById = new Map(demoCategories.map((category) => [category.id, category]));

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
            <h1 className="mt-2 text-3xl font-black">Products</h1>
          </div>
          <Button type="button">Add product</Button>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {demoProducts.map((product) => (
            <ProductCard key={product.id} product={product} category={categoriesById.get(product.categoryId ?? "")} />
          ))}
        </div>
      </main>
    </PageFrame>
  );
}
