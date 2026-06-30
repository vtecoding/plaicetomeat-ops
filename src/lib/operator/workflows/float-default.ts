/**
 * Confirm-don't-ask opening float default (pure).
 *
 * The opening float is stable day to day, yet the operator re-types it every morning.
 * This resolves a suggested value from prior sessions for the operator to confirm or
 * correct — never silently saved.
 *
 * NOTE on sources: the spec ranks a "last closing float/cash base" first. PTM's closing
 * step captures the counted TOTAL (float + day's takings), which is not a float base, so
 * the live wiring passes null for lastCloseFloatGbp and the truthful predictor becomes
 * yesterday's opening float. The helper still honours a real close-float if one is ever
 * supplied, so the contract stays complete and unit-tested.
 */
export type FloatDefaultSource = "last_close" | "last_open" | "branch_default";

// A default is present or absent (`source` records its provenance). No certainty level —
// operator surfaces carry no scoring vocabulary (verify-operator-firewall).
export type FloatDefault = {
  valueGbp: number | null;
  source: FloatDefaultSource | null;
};

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function resolveOpeningFloatDefault(input: {
  lastCloseFloatGbp: number | null;
  lastOpenFloatGbp: number | null;
  branchDefaultFloatGbp: number | null;
}): FloatDefault {
  if (usable(input.lastCloseFloatGbp)) return { valueGbp: input.lastCloseFloatGbp, source: "last_close" };
  if (usable(input.lastOpenFloatGbp)) return { valueGbp: input.lastOpenFloatGbp, source: "last_open" };
  if (usable(input.branchDefaultFloatGbp)) return { valueGbp: input.branchDefaultFloatGbp, source: "branch_default" };
  return { valueGbp: null, source: null };
}
