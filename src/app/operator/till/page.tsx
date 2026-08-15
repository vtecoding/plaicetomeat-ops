import { OperatorTillFlow } from "@/app/operator/_components/operator-till-flow";
import { OperatorText } from "@/app/operator/_components/operator-language";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorTillPage() {
  await requireStaffContext("manager", { branchScoped: true });

  return (
    <div data-testid="operator-till-page">
      <OperatorText as="p" className="eyebrow text-[var(--brand)]" k="page.till.eyebrow" />
      <OperatorText as="h1" className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]" k="page.till.title" />
      <OperatorText as="p" className="mt-2 text-lg text-[var(--muted)]" k="page.till.helper" />

      <div className="mt-6">
        <OperatorTillFlow />
      </div>
    </div>
  );
}
