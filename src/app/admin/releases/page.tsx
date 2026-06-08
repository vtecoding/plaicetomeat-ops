import { AdminReleasesClient } from "@/components/admin-releases-client";
import { PageFrame } from "@/components/site-header";
import { getReleaseGovernance } from "@/lib/server/releases";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminReleasesPage() {
  // Owner-only: re-checked here in the data path, not merely in middleware.
  await requireStaffContext("owner");

  const governance = await getReleaseGovernance();

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Release governance</p>
        <h1 className="mt-2 text-3xl font-black">Deployment Ledger</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">
          Every release records gates, migration status, hosted smoke, and post-deploy verification before it is complete.
        </p>

        {!governance.configured && (
          <p className="mt-4 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-4 text-sm text-[#5a3900]">
            Live release tables are not configured yet. Showing the V3 reference release and expected migration list.
          </p>
        )}

        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-5" aria-label="Migration Health">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Migration Health</h2>
              <p className="mt-1 text-sm text-[#6c5e52]">
                Expected migrations: {governance.migrationHealth.expected.length}. Applied migrations:{" "}
                {governance.migrationHealth.applied.length}.
              </p>
            </div>
            <span
              className={
                "rounded-full px-3 py-1 text-xs font-black " +
                (governance.migrationHealth.healthy
                  ? "bg-[#e6efe9] text-[#0f5132]"
                  : "bg-[#fff6df] text-[#5a3900]")
              }
            >
              {governance.migrationHealth.healthy ? "Healthy" : "Drift Detected"}
            </span>
          </div>

          {governance.migrationHealth.missing.length > 0 && (
            <div className="mt-4 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-4 text-sm text-[#5a3900]">
              <p className="font-bold">Missing migrations</p>
              <ul className="mt-2 grid gap-1">
                {governance.migrationHealth.missing.map((version) => (
                  <li key={version} className="font-mono">
                    {version}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="mt-8" aria-label="Release ledger">
          <AdminReleasesClient releases={governance.releases} />
        </section>
      </main>
    </PageFrame>
  );
}
