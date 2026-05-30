import { BasketClient } from "@/components/basket-client";
import { PageFrame } from "@/components/site-header";

export default function BasketPage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <BasketClient />
      </main>
    </PageFrame>
  );
}
