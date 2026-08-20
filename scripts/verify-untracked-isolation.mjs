import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const failures = [];

function requireText(file, pattern, label) {
  const source = read(file);
  if (!pattern.test(source)) failures.push(`${label} (${file})`);
}

requireText(
  "supabase/migrations/202607141300_v18_inventory_policy.sql",
  /ADD COLUMN inventory_policy text[\s\S]*SET DEFAULT 'kg_batch'[\s\S]*products_inventory_policy_unit_check/,
  "inventory policy must be durable and unit-compatible",
);
requireText(
  "supabase/migrations/202607141300_v18_inventory_policy.sql",
  /CREATE TRIGGER inventory_batches_product_policy[\s\S]*enforce_inventory_batch_product_policy/,
  "untracked products must be blocked from batch writes",
);
requireText(
  "supabase/migrations/202607141300_v18_inventory_policy.sql",
  /CREATE OR REPLACE VIEW public\.stock_levels[\s\S]*p\.inventory_policy = 'kg_batch'/,
  "the database stock aggregate must exclude legacy untracked batches",
);
requireText(
  "supabase/migrations/202607141300_v18_inventory_policy.sql",
  /coalesce\(v_item\.inventory_policy, ''\) <> 'kg_batch'/,
  "collection depletion must skip untracked lines",
);
requireText(
  "src/lib/server/compliance-inventory.ts",
  /products!inner\(name, inventory_policy\)[\s\S]*product\.inventory_policy", "kg_batch"/,
  "the canonical batch reader must select counted products only",
);
requireText(
  "src/lib/domain/operations-intelligence.ts",
  /inventoryPolicy !== "untracked_manual"/,
  "expiry and depletion builders must exclude untracked products",
);
requireText(
  "src/lib/domain/purchasing-intelligence.ts",
  /inventoryPolicy === "untracked_manual"\) continue/,
  "buying recommendations must skip untracked products",
);
requireText(
  "src/lib/domain/inventory-policy.ts",
  /STOCK_NOT_COUNTED_LABEL = "Stock not counted"/,
  "the shared badge must use the exact wording",
);
requireText(
  "src/components/admin-inventory-client.tsx",
  /STOCK_NOT_COUNTED_LABEL/,
  "inventory must use the exact untracked badge",
);
requireText(
  "src/components/admin-products-client.tsx",
  /STOCK_NOT_COUNTED_LABEL/,
  "products must use the exact untracked badge",
);
requireText(
  "src/app/admin/purchasing/page.tsx",
  /STOCK_NOT_COUNTED_LABEL/,
  "purchasing must use the exact untracked badge",
);
requireText(
  "src/lib/operator/workflows/serve-lines.ts",
  /Number\.isInteger\(quantity\)[\s\S]*MAX_COUNT_QUANTITY/,
  "serve must validate whole each/box counts",
);
requireText(
  "src/app/operator/serve/operator-serve-flow.tsx",
  /"serve\.howManyBoxes"[\s\S]*"serve\.howMany"/,
  "serve must use count-specific prompts",
);
requireText(
  "src/app/operator/serve/page.tsx",
  /product\.isAvailable && product\.stockStatus !== "out_of_stock"/,
  "operator serve tiles must honour manual catalogue availability",
);
requireText(
  "src/app/actions/operator/serve.ts",
  /rpc\("create_operator_serve_order_v18"/,
  "operator serve must use the atomic database authority",
);
requireText(
  "supabase/migrations/202607142200_v18_atomic_operator_serve.sql",
  /NOT coalesce\(v_product\.is_available, false\)[\s\S]*stock_status[\s\S]*out_of_stock/,
  "atomic operator serve authority must reject unavailable catalogue products",
);
requireText(
  "supabase/migrations/202607142200_v18_atomic_operator_serve.sql",
  /v_business_date := public\.branch_business_date\(v_branch_id, now\(\)\)/,
  "operator serve must use the branch-local trading date",
);
for (const file of ["src/app/operator/stock/page.tsx", "src/app/operator/waste/page.tsx"]) {
  requireText(
    file,
    /filter\(\(product\) => product\.inventoryPolicy === "kg_batch"\)/,
    "operator stock-writing choices must contain counted products only",
  );
}
requireText(
  "src/components/product-card.tsx",
  /product\.stockStatus === "out_of_stock"/,
  "public catalogue availability must still use the manual stock status",
);

if (failures.length > 0) {
  console.error("Untracked inventory isolation guard FAILED:");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log("Untracked inventory isolation guard PASSED.");
