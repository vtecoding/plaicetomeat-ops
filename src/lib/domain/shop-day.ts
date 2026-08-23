export const SHOP_DAY_PHASES = ["not_open", "opening", "trading", "closing", "closed"] as const;

export type ShopDayPhase = (typeof SHOP_DAY_PHASES)[number];
export type ShopDayRitualStatus = "in_progress" | "completed" | "abandoned" | null;

export type ShopDaySnapshot = {
  openingStatus: ShopDayRitualStatus;
  closingStatus: ShopDayRitualStatus;
};

export type ShopDayObligationGate = "opening" | "closing";
export type ShopDayObligationStatus = "pending" | "in_progress" | "blocked" | "deferred" | "completed";

export type ShopDayObligation = {
  id: string;
  status: ShopDayObligationStatus;
  gate: ShopDayObligationGate | null;
};

export type ShopDayCommand = "start_opening" | "complete_opening" | "start_closing" | "complete_closing";
export type ShopDayAction = "serve_customer" | "receive_delivery" | "record_waste" | "count_till";

export type ShopDayTransition =
  | { ok: true; phase: ShopDayPhase; changed: boolean }
  | { ok: false; phase: ShopDayPhase; reason: string; instruction: string; blockerIds: string[] };

export type ShopDayDerivation =
  | { ok: true; phase: ShopDayPhase }
  | { ok: false; reason: "closing_without_opening" };

/**
 * Derive the one operational phase from persisted opening/closing ritual truth.
 * An abandoned ritual has no completion authority and is treated as not started.
 */
export function deriveShopDayPhase(snapshot: ShopDaySnapshot): ShopDayDerivation {
  const opening = snapshot.openingStatus;
  const closing = snapshot.closingStatus;

  if ((closing === "in_progress" || closing === "completed") && opening !== "completed") {
    return { ok: false, reason: "closing_without_opening" };
  }

  if (closing === "completed") return { ok: true, phase: "closed" };
  if (closing === "in_progress") return { ok: true, phase: "closing" };
  if (opening === "completed") return { ok: true, phase: "trading" };
  if (opening === "in_progress") return { ok: true, phase: "opening" };
  return { ok: true, phase: "not_open" };
}

/** Required obligations remain blocking even when somebody chose “Later”. */
export function unresolvedGateObligations(
  obligations: ShopDayObligation[],
  gate: ShopDayObligationGate,
): ShopDayObligation[] {
  return obligations.filter((obligation) => obligation.gate === gate && obligation.status !== "completed");
}

/**
 * Pure transition policy. Duplicate completion/start commands are idempotent;
 * invalid ordering and unresolved gate obligations return a human instruction.
 */
export function transitionShopDay(
  phase: ShopDayPhase,
  command: ShopDayCommand,
  obligations: ShopDayObligation[] = [],
): ShopDayTransition {
  if (command === "start_opening") {
    if (phase === "not_open") return { ok: true, phase: "opening", changed: true };
    if (phase === "opening") return { ok: true, phase, changed: false };
    return refuse(phase, "shop_already_open", "The shop has already been opened for this trading day.");
  }

  if (command === "complete_opening") {
    if (phase === "trading" || phase === "closing" || phase === "closed") {
      return { ok: true, phase, changed: false };
    }
    if (phase === "not_open") {
      return refuse(phase, "opening_not_started", "Start the opening checks first.");
    }
    const blockers = unresolvedGateObligations(obligations, "opening");
    if (blockers.length > 0) {
      return refuse(
        phase,
        "opening_checks_incomplete",
        "Finish the required opening checks before opening the shop.",
        blockers,
      );
    }
    return { ok: true, phase: "trading", changed: true };
  }

  if (command === "start_closing") {
    if (phase === "closing" || phase === "closed") return { ok: true, phase, changed: false };
    if (phase === "not_open" || phase === "opening") {
      return refuse(phase, "shop_not_open", "Finish opening the shop before starting the close.");
    }
    return { ok: true, phase: "closing", changed: true };
  }

  if (phase === "closed") return { ok: true, phase, changed: false };
  if (phase !== "closing") {
    return refuse(phase, "closing_not_started", "Start the closing checks first.");
  }
  const blockers = unresolvedGateObligations(obligations, "closing");
  if (blockers.length > 0) {
    return refuse(
      phase,
      "closing_checks_incomplete",
      "The shop is not closed yet. Finish the required closing checks.",
      blockers,
    );
  }
  return { ok: true, phase: "closed", changed: true };
}

/** Trading actions are valid only after opening completed and before closing began. */
export function canPerformShopDayAction(phase: ShopDayPhase, action: ShopDayAction): boolean {
  switch (action) {
    case "serve_customer":
    case "receive_delivery":
    case "record_waste":
    case "count_till":
      return phase === "trading";
  }
}

function refuse(
  phase: ShopDayPhase,
  reason: string,
  instruction: string,
  blockers: ShopDayObligation[] = [],
): ShopDayTransition {
  return { ok: false, phase, reason, instruction, blockerIds: blockers.map((blocker) => blocker.id) };
}
