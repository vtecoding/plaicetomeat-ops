import { AdminSettingsClient } from "@/components/admin-settings-client";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { getBranchById, getBranchSettings } from "@/lib/server/catalog";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [settings, currentBranch] = await Promise.all([
    getBranchSettings(branchId),
    getBranchById(branchId),
  ]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Masthead
          back={<BackLink href="/admin">Back to dashboard</BackLink>}
          eyebrow="Admin"
          title="Branch settings"
        />
        <Surface className="mt-6 p-6">
          <AdminSettingsClient branch={currentBranch} settings={settings} />
        </Surface>
      </main>
    </PageFrame>
  );
}
