// V12.7 verification - Operational Truth Layer.
//
// This is a structural guard for the production-truth invariants: key production
// loaders must not silently return demo data, admin/today must share the same
// operational snapshot, and the required typed states must exist.

import { readFileSync } from "node:fs";

const files = {
  dataResult: "src/lib/domain/data-result.ts",
  runtimeTruth: "src/lib/server/runtime-truth.ts",
  catalog: "src/lib/server/catalog.ts",
  pickup: "src/lib/server/pickup-windows.ts",
  orders: "src/lib/server/orders.ts",
  operations: "src/lib/server/operations-intelligence.ts",
  releases: "src/lib/server/releases.ts",
  snapshot: "src/lib/server/operational-snapshot.ts",
  admin: "src/app/admin/page.tsx",
  today: "src/app/admin/today/page.tsx",
  home: "src/app/page.tsx",
  shop: "src/app/shop/page.tsx",
  checkout: "src/app/checkout/page.tsx",
  countdown: "src/components/countdown-banner.tsx",
};

const src = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]));

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
}

for (const state of ["HEALTHY", "NO_DATA", "DEGRADED", "UNAVAILABLE", "UNAUTHORISED", "CONFIGURATION_REQUIRED"]) {
  check(`DataResult includes ${state}`, src.dataResult.includes(`"${state}"`));
}

check("runtime truth detects production", src.runtimeTruth.includes("isProductionRuntime"));
check("demo fallback is explicit only", src.runtimeTruth.includes("ALLOW_DEMO_DATA") && src.runtimeTruth.includes("!isProductionRuntime()"));
check(
  "canonical storefront branch is explicit in production",
  src.catalog.includes("isProductionRuntime() && !canonicalId") && src.catalog.includes("configurationRequired("),
);

for (const [name, text] of [
  ["catalog", src.catalog],
  ["pickup windows", src.pickup],
  ["counter orders", src.orders],
  ["releases", src.releases],
]) {
  check(`${name} demo fallback is allowDemoFallback-gated`, !/return\s+(demo|getDemoOrders|fallbackV3Release)/.test(text) || text.includes("allowDemoFallback()"));
}

check("operations intelligence does not use demo orders when fallback is disallowed", src.operations.includes("useDemoOrders: allowDemoFallback()"));
check("OperationalSnapshotV1 exists", src.snapshot.includes("OperationalSnapshotV1") && src.snapshot.includes("asOf"));
check("missing configuration returns CONFIGURATION_REQUIRED", src.snapshot.includes("configurationRequired("));
check("no orders maps to NO_DATA", src.snapshot.includes("metrics.orderCount === 0") && src.snapshot.includes("noData("));
check("partial loader failure maps to DEGRADED", src.snapshot.includes("dataState.status === \"error\"") && src.snapshot.includes("degraded("));

check("/admin uses OperationalSnapshotV1", src.admin.includes("getOperationalSnapshotV1") && !src.admin.includes("getDashboardMetrics"));
check("/admin/today uses OperationalSnapshotV1", src.today.includes("getOperationalSnapshotV1") && !src.today.includes("getOwnerBrain"));
check("/admin renders honest truth banner", src.admin.includes("truth-state-banner"));
check("/admin/today renders honest truth banner", src.today.includes("truth-state-banner"));

for (const [name, text] of [
  ["home", src.home],
  ["shop", src.shop],
  ["checkout", src.checkout],
]) {
  check(`${name} public page uses result-returning branch loader`, text.includes("getPublicBranchResult"));
  check(`${name} public page renders honest unavailable state`, text.includes("public-truth-state"));
}

check("countdown banner no longer imports demo pickup windows", !src.countdown.includes("demoPickupWindows"));

console.log(failures === 0 ? "\nALL OPERATIONAL TRUTH CHECKS PASSED" : `\n${failures} OPERATIONAL TRUTH CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
