import { alertSpecFor, type AlertAction } from "./alert-registry";

export type OwnerDecisionCopy = {
  problem: string;
  whyItMatters: string;
  recommendation: string;
  ifIgnored: string;
};

type OwnerDecisionSource = {
  kind: string;
  summary: string;
  severity: "warning" | "critical";
  action: AlertAction;
};

/**
 * Present a durable owner alert as a plain business decision. The alert remains
 * the persisted lifecycle record; this is only its role-safe, human projection.
 */
export function toOwnerDecisionCopy(source: OwnerDecisionSource): OwnerDecisionCopy {
  const spec = alertSpecFor(source.kind);
  const urgent = source.severity === "critical";

  return {
    problem: source.summary.trim() || spec.title,
    whyItMatters: urgent
      ? "This could affect food safety, cash, or whether the shop can trade safely."
      : "This needs checking so the shop's stock, money, and paperwork stay trustworthy.",
    recommendation: recommendationFor(source.action, spec.title),
    ifIgnored: urgent
      ? "The risk stays open and could get worse during today's trading."
      : "The next person may make a decision using incomplete or wrong information.",
  };
}

function recommendationFor(action: AlertAction, title: string): string {
  switch (action) {
    case "inline-cost":
      return "Enter the invoice cost and save it.";
    case "confirm-reason":
      return "Check the recorded reason and confirm it.";
    case "link":
      return `Open the right shop work and finish: ${title.toLowerCase()}.`;
    case "note-resolve":
      return "Deal with the issue, then leave a short note saying what you did.";
  }
}
