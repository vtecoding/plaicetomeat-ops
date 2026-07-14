import { OperatorServeFlow } from "@/app/operator/serve/operator-serve-flow";
import { buildServeTiles } from "@/lib/operator/workflows/serve";
import { getAllProducts } from "@/lib/server/catalog";
import { getLatestOperatorDraft } from "@/lib/server/operator-drafts";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorServePage() {
  const { branchId, profile } = await requireStaffContext("manager", { branchScoped: true });
  const [products, initialDraft] = await Promise.all([
    getAllProducts(branchId),
    getLatestOperatorDraft({ branchId, operatorId: profile.id, workflow: "serve" }),
  ]);
  const tiles = buildServeTiles(
    products.filter((product) => product.isAvailable && product.stockStatus !== "out_of_stock"),
  );

  return (
    <div data-testid="operator-serve-page">
      <OperatorServeFlow tiles={tiles} initialDraft={initialDraft} />
    </div>
  );
}
