import { describe, expect, it } from "vitest";

import { advanceInstruction, createDryRunSession, goBack, handleTutorialEvent, restartSession, restoreSession, serializeSession } from "./engine";

const now = new Date("2026-08-20T08:00:00.000Z");

describe("dry-run tutorial engine", () => {
  it("advances instructions and only accepts the expected semantic event", () => {
    let session = advanceInstruction(createDryRunSession("en", now, "session-1"));
    expect(handleTutorialEvent(session, { id: "wrong", name: "operator.serve.selected" })).toBe(session);
    session = handleTutorialEvent(session, { id: "right", name: "operator.open.selected" });
    expect(session.currentStep).toBe(2);
  });

  it("validates values and ignores duplicate or stale events", () => {
    let session = advanceInstruction(createDryRunSession("en", now, "session-2"));
    session = handleTutorialEvent(session, { id: "open", name: "operator.open.selected" });
    session = handleTutorialEvent(session, { id: "clean", name: "operator.open.checklist_confirmed" });
    expect(handleTutorialEvent(session, { id: "random", name: "operator.temperature.entered", value: "4.1" })).toBe(session);
    session = handleTutorialEvent(session, { id: "warm", name: "operator.temperature.entered", value: "8.5" });
    expect(session.simulatedState.openingTemperature).toBe("8.5");
    session = handleTutorialEvent(session, { id: "correct", name: "operator.temperature.entered", value: "3.2" });
    expect(session.simulatedState.openingTemperature).toBe("3.2");
    expect(handleTutorialEvent(session, { id: "correct", name: "operator.temperature.entered", value: "3.2" })).toBe(session);
    expect(handleTutorialEvent(session, { id: "late", name: "operator.open.selected" })).toBe(session);
  });

  it("restores snapshots on Back and resets on Restart", () => {
    let session = advanceInstruction(createDryRunSession("ps-AF", now, "session-3"));
    session = handleTutorialEvent(session, { id: "open", name: "operator.open.selected" });
    session = handleTutorialEvent(session, { id: "clean", name: "operator.open.checklist_confirmed" });
    expect(session.simulatedState.openingClean).toBe(true);
    session = goBack(session);
    expect(session.simulatedState.openingClean).toBe(false);
    const restarted = restartSession(session, new Date("2026-08-20T09:00:00.000Z"));
    expect(restarted.currentStep).toBe(0);
    expect(restarted.locale).toBe("ps-AF");
    expect(restarted.id).toBe("session-3");
  });

  it("resumes valid sessions but rejects expired, stale-version, malformed and corrupt state", () => {
    const session = createDryRunSession("en", now, "session-4");
    expect(restoreSession(serializeSession(session), new Date("2026-08-20T09:00:00.000Z"))?.id).toBe("session-4");
    expect(restoreSession(serializeSession(session), new Date("2026-08-20T17:00:01.000Z"))).toBeNull();
    expect(restoreSession(JSON.stringify({ ...session, scenarioId: "complete-shop-day-v2" }), now)).toBeNull();
    expect(restoreSession(JSON.stringify({ ...session, snapshots: null }), now)).toBeNull();
    expect(restoreSession("not-json", now)).toBeNull();
  });
});
