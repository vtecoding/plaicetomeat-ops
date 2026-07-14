import { OperatorTillFlow } from "@/app/operator/_components/operator-till-flow";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorTillPage() {
  await requireStaffContext("manager", { branchScoped: true });

  return (
    <div data-testid="operator-till-page">
      <p className="eyebrow text-[var(--brand)]">Till money</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]">Till money in / out</h1>
      <p className="mt-2 text-lg text-[var(--muted)]">For money that is not a sale — change, a supplier, the owner.</p>

      <div className="mt-6">
        <OperatorTillFlow />
      </div>
    </div>
  );
}
