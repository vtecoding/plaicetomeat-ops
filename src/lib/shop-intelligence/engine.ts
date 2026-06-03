/**
 * V8 Operational Intelligence Engine — the orchestrator.
 *
 * `buildShopIntelligence` is the single pure entry point: hand it a `ShopSnapshot`
 * (assembled by the server from existing reads) and it returns the whole V8 picture
 * — daily briefing, health score, ranked explain-everything findings, weekly report
 * and a top-line confidence statement.
 *
 * It never performs I/O and never mutates anything (Golden Rule, V8.13). The
 * spec-named module `src/lib/domain/operational-intelligence-v2.ts` re-exports this.
 */
import { buildDailyBriefing } from "./briefing";
import { summariseConfidence } from "./confidence";
import { buildGettingStarted } from "./getting-started";
import {
  buildCoachNudges,
  buildConsistencyChecks,
  buildYieldReality,
  findingsFromOwnerActions,
  rankFindings,
} from "./findings";
import { buildHealthScore } from "./health-score";
import type { ShopSnapshot } from "./snapshot";
import type { Finding, ShopIntelligence } from "./types";
import { buildWeeklyReport } from "./weekly-report";

export function buildFindings(snapshot: ShopSnapshot): Finding[] {
  const all = [
    ...findingsFromOwnerActions(snapshot.ownerActions),
    ...buildYieldReality(snapshot.batches),
    ...buildConsistencyChecks(snapshot),
    ...buildCoachNudges(snapshot),
  ];
  return rankFindings(all);
}

export function buildShopIntelligence(snapshot: ShopSnapshot): ShopIntelligence {
  const now = new Date(snapshot.now);
  const findings = buildFindings(snapshot);

  const briefing = buildDailyBriefing(findings, now, {
    orders: { awaitingPrep: snapshot.orders.awaitingPrep, ready: snapshot.orders.ready },
  });
  const health = buildHealthScore(snapshot);
  const weekly = buildWeeklyReport(snapshot, now);

  // Top-line confidence draws on the bases of the findings that drove the briefing,
  // so the headline trust level reflects what's actually being recommended.
  const drivingBases = findings.filter((finding) => finding.severity !== "info").map((finding) => finding.basis);
  const confidence = summariseConfidence(drivingBases.length > 0 ? drivingBases : findings.map((finding) => finding.basis));

  return {
    generatedAt: snapshot.now,
    dataConfigured: snapshot.dataConfigured,
    gettingStarted: buildGettingStarted(snapshot),
    briefing,
    health,
    findings,
    weekly,
    confidence,
  };
}

// Re-export the public surface so callers can import from one place.
export * from "./types";
export { buildDailyBriefing } from "./briefing";
export { buildGettingStarted } from "./getting-started";
export { buildHealthScore } from "./health-score";
export { buildWeeklyReport } from "./weekly-report";
export {
  buildYieldReality,
  buildConsistencyChecks,
  buildCoachNudges,
  findingsFromOwnerActions,
  rankFindings,
} from "./findings";
export { buildBasis, capConfidence, summariseConfidence } from "./confidence";
export { PLAYBOOKS, allPlaybooks, playbookForArea } from "./playbooks";
export type { ShopSnapshot, SnapshotBatch, SnapshotDepletionRow } from "./snapshot";
