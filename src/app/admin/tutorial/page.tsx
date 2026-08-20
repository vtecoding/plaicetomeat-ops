import { OwnerTutorial } from "@/app/admin/tutorial/owner-tutorial";
import { PageFrame } from "@/components/site-header";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OwnerTutorialPage() {
  await requireStaffContext("manager", { branchScoped: true });
  return <PageFrame><OwnerTutorial /></PageFrame>;
}
