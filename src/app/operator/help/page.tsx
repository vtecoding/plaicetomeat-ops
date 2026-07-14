import { OperatorHelpFlow } from "@/app/operator/help/operator-help-flow";
import { getOwnerContact } from "@/lib/server/alert-dispatch";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorHelpPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const ownerContact = await getOwnerContact(branchId);
  return <OperatorHelpFlow ownerContact={ownerContact} />;
}
