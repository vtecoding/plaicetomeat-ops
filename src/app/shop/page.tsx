import { CountdownBanner } from "@/components/countdown-banner";
import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { ProductCard } from "@/components/product-card";
import { PageFrame } from "@/components/site-header";
import { getActiveCategories, getPublicBranch, getPublicProducts } from "@/lib/server/catalog";

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const branch = await getPublicBranch();
  const [categories, products] = await Promise.all([
    getActiveCategories(branch.id),
    getPublicProducts(branch.id),
  ]);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const uncategorised = products.filter((product) => !product.categoryId || !categoriesById.has(product.categoryId));

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Click-and-collect</p>
            <h1 className="mt-2 text-3xl font-black">Shop the counter</h1>
          </div>
          <PayOnCollectionNote compact />
        </div>

        <div className="mt-6">
          <CountdownBanner />
        </div>

        {products.length === 0 ? (
          <p className="mt-8 rounded-lg border border-[#ded6ca] bg-white p-6 text-sm text-[#6c5e52]">
            No products are available right now. Please check back soon.
          </p>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap gap-2">
              {categories.map((category) => (
                <a
                  key={category.id}
                  href={`#${category.slug}`}
                  className="rounded-full border border-[#d8d0c5] bg-white px-3 py-2 text-sm font-semibold hover:border-[#0f5132]"
                >
                  {category.name}
                </a>
              ))}
            </div>

            <div className="mt-8 space-y-10">
              {categories.map((category) => {
                const inCategory = products.filter((product) => product.categoryId === category.id);
                if (inCategory.length === 0) return null;

                return (
                  <section key={category.id} id={category.slug}>
                    <h2 className="text-xl font-black">{category.name}</h2>
                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {inCategory.map((product) => (
                        <ProductCard key={product.id} product={product} category={category} />
                      ))}
                    </div>
                  </section>
                );
              })}

              {uncategorised.length > 0 && (
                <section id="more">
                  <h2 className="text-xl font-black">More</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {uncategorised.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </main>
    </PageFrame>
  );
}
