import type { OwnerAction } from "./action-types";

const severityScore: Record<OwnerAction["severity"], number> = {
  urgent: 3,
  warning: 2,
  info: 1,
};

export function sortOwnerActions(actions: OwnerAction[]) {
  return [...actions].sort((a, b) => {
    const severityDelta = severityScore[b.severity] - severityScore[a.severity];
    if (severityDelta !== 0) return severityDelta;
    return a.title.localeCompare(b.title);
  });
}
