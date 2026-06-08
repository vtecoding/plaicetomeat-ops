import { ShieldCheck } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { certificateStateLabel } from "@/lib/domain/compliance-inventory";
import { getPublicBranchResult } from "@/lib/server/catalog";
import { getSuppliers } from "@/lib/server/compliance-inventory";

export const dynamic = "force-dynamic";

export default async function HalalPromisePage() {
  const branchResult = await getPublicBranchResult();
  if (!branchResult.data) return <PublicDataUnavailable message={branchResult.message} />;
  const branch = branchResult.data;
  const suppliers = await getSuppliers(branch.id, { publicOnly: true });
  const lastUpdated = suppliers
    .map((supplier) => new Date(supplier.updatedAt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Customer trust</p>
          <h1 className="mt-2 text-4xl font-black">Our halal promise</h1>
          <p className="mt-4 text-base leading-7 text-[#5c5148]">
            PlaiceToMeat is a halal-focused butcher. We track supplier certification records, expiry dates,
            and verification dates so staff can check supplier evidence before making customer claims.
          </p>
          <p className="mt-3 text-sm text-[#6c5e52]">
            We do not claim a specific certification body unless the supplier certificate data is recorded and verified.
          </p>
        </div>

        <section className="mt-8 rounded-lg border border-[#ded6ca] bg-white p-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-[#0f5132]" aria-hidden />
            <div>
              <h2 className="text-lg font-black">{branch.name}</h2>
              <p className="text-sm text-[#6c5e52]">
                Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString("en-GB") : "Supplier records pending"}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4">
          {suppliers.length === 0 ? (
            <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">
              Supplier certification records are being added. Ask in store for the current certificate.
            </p>
          ) : (
            suppliers.map((supplier) => (
              <article key={supplier.id} className="rounded-lg border border-[#ded6ca] bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black">{supplier.name}</h2>
                    <p className="mt-1 text-sm text-[#6c5e52]">{supplier.branchName ?? branch.name}</p>
                  </div>
                  <span className="rounded-full bg-[#f7f3ed] px-3 py-1 text-xs font-bold">
                    {certificateStateLabel(supplier.status)}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="font-bold">Certifying body</dt>
                    <dd>{supplier.certifyingBody ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">Certificate expiry</dt>
                    <dd>{supplier.certExpiry ?? "Missing"}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">Last verified</dt>
                    <dd>{supplier.verifiedAt ? new Date(supplier.verifiedAt).toLocaleDateString("en-GB") : "Missing verification"}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">Branch</dt>
                    <dd>{supplier.branchName ?? branch.name}</dd>
                  </div>
                </dl>
              </article>
            ))
          )}
        </section>
      </main>
    </PageFrame>
  );
}

function PublicDataUnavailable({ message }: { message: string }) {
  return (
    <PageFrame>
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-[#f0c66e] bg-[#fff8e6] p-6 text-[#5a3900]" data-testid="public-truth-state">
          <h1 className="text-2xl font-black">Supplier evidence is not ready</h1>
          <p className="mt-3 text-sm font-semibold">{message}</p>
        </section>
      </main>
    </PageFrame>
  );
}
