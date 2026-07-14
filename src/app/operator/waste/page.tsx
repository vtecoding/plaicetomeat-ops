import { OperatorWasteFlow } from "@/app/operator/_components/operator-waste-flow";
import { getAllProducts } from "@/lib/server/catalog";
import { getLatestOperatorDraft } from "@/lib/server/operator-drafts";
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

export default async function OperatorWastePage() {
  const { branchId, profile } = await requireStaffContext("manager", { branchScoped: true });
  const [products, initialDraft] = await Promise.all([
    getAllProducts(branchId),
    getLatestOperatorDraft({ branchId, operatorId: profile.id, workflow: "waste" }),
  ]);
  const productOptions = products
    .filter((product) => product.inventoryPolicy === "kg_batch")
    .sort((a, b) => commonOrder(a.name) - commonOrder(b.name) || a.name.localeCompare(b.name));

  return (
    <div data-testid="operator-waste-page">
      <p className="eyebrow text-[var(--brand)]">Waste</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]">Waste</h1>
      <p className="mt-2 text-lg text-[var(--muted)]">Save what was thrown away.</p>

      <div className="mt-6">
        <OperatorWasteFlow
          products={productOptions.map((product) => ({
            id: product.id,
            name: product.name,
            unitType: product.unitType,
          }))}
          initialDraft={initialDraft}
        />
      </div>
    </div>
  );
}
