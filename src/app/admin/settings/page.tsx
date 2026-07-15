import { AdminSettingsClient } from "@/components/admin-settings-client";
import Link from "next/link";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { getBranchById, getBranchSettings } from "@/lib/server/catalog";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const { branchId, profile } = await requireStaffContext("manager", { branchScoped: true });
  const [settings, currentBranch] = await Promise.all([
    getBranchSettings(branchId),
    getBranchById(branchId),
  ]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Masthead
          back={<BackLink href="/admin">Back to shop detail</BackLink>}
          eyebrow="Admin"
          title="Branch settings"
        />
        {profile.role === "owner" && <Surface className="mt-6 p-6">
          <AdminSettingsClient branch={currentBranch} settings={settings} />
        </Surface>}
        <Surface className="mt-6 p-6">
          <h2 className="text-lg font-semibold">Owner notifications</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Connect and verify the devices that receive urgent shop alerts.</p>
          <Link href="/admin/settings/notifications" className="mt-3 inline-flex rounded-full border px-4 py-2 text-sm font-bold">Manage notification devices</Link>
        </Surface>
      </main>
    </PageFrame>
  );
}
