import { describe, expect, it } from "vitest";

import {
  buildOperatorDraftSteps,
  draftSaveLabel,
  parseOperatorDraftSteps,
  operatorDraftBusinessDate,
  transitionDraftSaveState,
  type DraftSaveState,
} from "@/lib/operator/workflows/drafts";

describe("operator workflow drafts", () => {
  it("round-trips the last successfully saved mode and answers", () => {
    const saved = buildOperatorDraftSteps({
      workflow: "delivery",
      mode: "delivery-review",
      lastSavedStep: "How much?",
      answers: { productId: "product-1", quantity: "4.5", expiryChoice: "tomorrow" },
      draftFailures: 3,
    });

    const roundTripped = JSON.parse(JSON.stringify(saved)) as unknown;
    expect(parseOperatorDraftSteps(roundTripped, "delivery", ["start", "delivery-review"])).toEqual({
      schemaVersion: 1,
      workflow: "delivery",
      mode: "delivery-review",
      lastSavedStep: "How much?",
      answers: { productId: "product-1", quantity: "4.5", expiryChoice: "tomorrow" },
      draftFailures: 3,
    });
  });

  it("rejects a draft from another workflow or an obsolete mode", () => {
    const saved = buildOperatorDraftSteps({
      workflow: "serve",
      mode: "confirm",
      lastSavedStep: "How did they pay?",
      answers: {},
    });

    expect(parseOperatorDraftSteps(saved, "waste", ["confirm"])).toBeNull();
    expect(parseOperatorDraftSteps(saved, "serve", ["buy"])).toBeNull();
  });

  it("moves from saved through failure and recovers on the next successful retry", () => {
    let state: DraftSaveState = { status: "saved", consecutiveFailures: 0 };
    state = transitionDraftSaveState(state, "save-started");
    expect(state.status).toBe("saving");
    state = transitionDraftSaveState(state, "save-failed");
    expect(state).toEqual({ status: "failed", consecutiveFailures: 1 });
    expect(draftSaveLabel(state.status)).toContain("sale still works");
    state = transitionDraftSaveState(state, "save-started");
    state = transitionDraftSaveState(state, "save-succeeded");
    expect(state).toEqual({ status: "saved", consecutiveFailures: 0 });
  });

  it("keeps a deterministic consecutive-failure count for operational logging", () => {
    let state: DraftSaveState = { status: "idle", consecutiveFailures: 0 };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = transitionDraftSaveState(state, "save-started");
      state = transitionDraftSaveState(state, "save-failed");
    }
    expect(state).toEqual({ status: "failed", consecutiveFailures: 3 });

    const persisted = buildOperatorDraftSteps({
      workflow: "waste",
      mode: "confirm",
      lastSavedStep: "Photo",
      answers: {},
      draftFailures: state.consecutiveFailures,
    });
    expect(persisted.draft_failures).toBe(3);
  });

  it("limits resume to the branch-local day across the BST midnight boundary", () => {
    expect(operatorDraftBusinessDate(new Date("2026-07-13T23:30:00.000Z"), "Europe/London")).toBe("2026-07-14");
    expect(operatorDraftBusinessDate(new Date("2026-12-13T23:30:00.000Z"), "Europe/London")).toBe("2026-12-13");
  });
});
