import { OperatorServeFlow } from "@/app/operator/serve/operator-serve-flow";
import { buildServeTiles } from "@/lib/operator/workflows/serve";
import { getAllProducts } from "@/lib/server/catalog";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorServePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const products = await getAllProducts(branchId);
  const tiles = buildServeTiles(products.filter((product) => product.isAvailable));

  return (
    <div data-testid="operator-serve-page">
      <OperatorServeFlow tiles={tiles} />
    </div>
  );
}
