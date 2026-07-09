import { OperatorStockFlow } from "@/app/operator/_components/operator-stock-flow";
import {
  resolveDeliveryDefaults,
  type ActiveSupplier,
  type DeliveryDefaults,
} from "@/lib/operator/workflows/delivery-defaults";
import { getSuppliers } from "@/lib/server/compliance-inventory";
import { getAllProducts } from "@/lib/server/catalog";
import { getDeliveryHistory } from "@/lib/server/operator-defaults";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

const COMMON_PRODUCT_ORDER = [
  "Chicken Breast Fillets",
  "Whole Chicken",
  "Lamb Leg Steaks",
  "Beef Diced",
  "Lean Lamb Mince",
  "Ribeye Steak",
  "Family Curry Pack",
];

function commonOrder(name: string) {
  const index = COMMON_PRODUCT_ORDER.indexOf(name);
  return index === -1 ? 999 : index;
}

export default async function OperatorStockPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [products, suppliers, history] = await Promise.all([
    getAllProducts(branchId),
    getSuppliers(branchId, { publicOnly: true }),
    getDeliveryHistory(branchId),
  ]);
  const productOptions = [...products].sort((a, b) => commonOrder(a.name) - commonOrder(b.name) || a.name.localeCompare(b.name));

  const activeSuppliers: ActiveSupplier[] = suppliers
    .filter((supplier) => supplier.active)
    .map((supplier) => ({ id: supplier.id, name: supplier.name }));

  // Confirm-don't-ask: precompute the suggested supplier/storage/expiry for every product
  // from real delivery history. Pure + cheap, so it lives here per product; the operator
  // confirms or corrects on a single review screen instead of re-entering each time.
  const deliveryDefaults: Record<string, DeliveryDefaults> = {};
  for (const product of productOptions) {
    deliveryDefaults[product.id] = resolveDeliveryDefaults({ productId: product.id, suppliers: activeSuppliers, history });
  }

  return (
    <div data-testid="operator-stock-page">
      <p className="eyebrow text-[var(--brand)]">Stock</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]">Stock and delivery</h1>
      <p className="mt-2 text-lg text-[var(--muted)]">One thing at a time.</p>

      <div className="mt-6">
        <OperatorStockFlow
          products={productOptions.map((product) => ({
            id: product.id,
            name: product.name,
            unitType: product.unitType,
          }))}
          suppliers={activeSuppliers}
          deliveryDefaults={deliveryDefaults}
        />
      </div>
    </div>
  );
}
