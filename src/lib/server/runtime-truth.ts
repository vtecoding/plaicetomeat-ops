import "server-only";

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export function allowDemoFallback() {
  return !isProductionRuntime() || process.env.ALLOW_DEMO_DATA === "true";
}

export function configuredCanonicalBranchId() {
  return process.env.CANONICAL_BRANCH_ID ?? process.env.NEXT_PUBLIC_CANONICAL_BRANCH_ID ?? null;
}
