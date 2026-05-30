import { CountdownBanner } from "@/components/countdown-banner";
import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { ProductCard } from "@/components/product-card";
import { PageFrame } from "@/components/site-header";
import { demoCategories, demoProducts } from "@/lib/data/demo";

export default function ShopPage() {
  const categoriesById = new Map(demoCategories.map((category) => [category.id, category]));

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

        <div className="mt-8 flex flex-wrap gap-2">
          {demoCategories.map((category) => (
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
          {demoCategories.map((category) => {
            const products = demoProducts.filter((product) => product.categoryId === category.id);

            return (
              <section key={category.id} id={category.slug}>
                <h2 className="text-xl font-black">{category.name}</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} category={categoriesById.get(product.categoryId ?? "")} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </PageFrame>
  );
}
