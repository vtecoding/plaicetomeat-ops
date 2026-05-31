import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Clock3, MapPin, ShieldCheck, ShoppingBasket } from "lucide-react";

import { CountdownBanner } from "@/components/countdown-banner";
import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { demoBranch, demoProducts } from "@/lib/data/demo";

export default function Home() {
  const featuredProducts = demoProducts.slice(0, 3);

  return (
    <PageFrame>
      <main>
        <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
          <Image
            src="/butcher-counter-hero.png"
            alt="Fresh butcher counter"
            fill
            sizes="100vw"
            priority
            className="object-cover"
          />
          <div className="absolute inset-0 bg-[#1b140f]/55" />
          <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center px-4 py-12 sm:px-6 lg:px-8">
            <div className="max-w-2xl text-white">
              <div className="mb-5 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-bold backdrop-blur">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Halal-focused butcher
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-bold backdrop-blur">
                  <MapPin className="h-4 w-4" aria-hidden />
                  {demoBranch.address}
                </span>
              </div>
              <h1 className="text-4xl font-black leading-tight sm:text-6xl">PlaiceToMeat Wylde Green</h1>
              <p className="mt-5 max-w-xl text-lg leading-8 text-white/90">
                Order fresh halal-focused meat ahead, collect from the counter, and pay on collection.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/shop">
                    <ShoppingBasket className="h-5 w-5" aria-hidden />
                    Shop click-and-collect
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href="/counter">Open counter dashboard</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[#e2d9cc] bg-[#fbfaf7]">
          <div className="mx-auto grid max-w-7xl gap-5 px-4 py-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
            <CountdownBanner />
            <PayOnCollectionNote compact />
          </div>
        </section>

        <section className="border-b border-[#e2d9cc] bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-5 text-sm font-bold sm:px-6 lg:px-8">
            {["Halal-focused", "Fresh collection", "Pay on collection", "Custom cuts available", "Supplier certs tracked"].map((item) => (
              <span key={item} className="rounded-full bg-[#f7f3ed] px-3 py-2">{item}</span>
            ))}
            <Link href="/our-halal-promise" className="font-black text-[#0f5132] underline underline-offset-4">
              Our halal promise
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Dinner-ready counter prep</p>
              <h2 className="mt-3 text-3xl font-black">Freshness, clarity, and no lost orders.</h2>
              <div className="mt-6 grid gap-4">
                {[
                  "Click-and-collect ordering with clear pickup windows.",
                  "Counter dashboard for incoming, prepping, ready, and collected orders.",
                  "Digital compliance readings and checklist records.",
                ].map((item) => (
                  <div key={item} className="flex gap-3 text-sm leading-6">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5132]" aria-hidden />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {featuredProducts.map((product) => (
                <Link
                  key={product.id}
                  href={`/product/${product.slug}`}
                  className="rounded-lg border border-[#ded6ca] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <Clock3 className="h-5 w-5 text-[#0f5132]" aria-hidden />
                  <p className="mt-4 font-black">{product.name}</p>
                  <p className="mt-2 text-sm text-[#6c5e52]">Ready for pickup windows today.</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </PageFrame>
  );
}
