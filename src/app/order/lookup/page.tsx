import { PageFrame } from "@/components/site-header";
import { OrderLookupForm } from "@/components/order-lookup-form";

export const dynamic = "force-dynamic";

export default async function OrderLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <PageFrame>
      <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-black">Check your order</h1>
        <p className="mt-2 text-[#6c5e52]">
          Enter your order number and the phone number you used at checkout to see your live order status.
        </p>
        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-6">
          <OrderLookupForm defaultRef={ref ?? ""} />
        </section>
      </main>
    </PageFrame>
  );
}
