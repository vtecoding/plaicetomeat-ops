import { AdminSettingsClient } from "@/components/admin-settings-client";
import { PageFrame } from "@/components/site-header";
import { getBranchSettings, getPublicBranch } from "@/lib/server/catalog";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  // Authoritative branch id comes from the signed-in profile; the public branch
  // record is used only for its display fields (name/address) on this single-
  // branch storefront.
  const [branch, settings] = await Promise.all([getPublicBranch(), getBranchSettings(branchId)]);
  const currentBranch = { ...branch, id: branchId };

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Branch settings</h1>
        <section className="mt-8 rounded-lg border border-[#ded6ca] bg-white p-6">
          <AdminSettingsClient branch={currentBranch} settings={settings} />
        </section>
      </main>
    </PageFrame>
  );
}
