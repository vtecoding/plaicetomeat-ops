import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildComplianceActions(input: ActionEngineInput): OwnerAction[] {
  return input.compliance.rows
    .filter((row) => row.daysToExpiry === null || row.daysToExpiry <= 30)
    .slice(0, 3)
    .map((row) => {
      const expired = row.daysToExpiry !== null && row.daysToExpiry < 0;
      return {
        id: `compliance-${slug(row.supplierName)}-${row.band}`,
        category: "compliance",
        group: expired ? "urgent" : "compliance",
        severity: expired ? "urgent" : "warning",
        title: expired ? `${row.supplierName} certificate is expired` : `${row.supplierName} certificate needs renewal`,
        explanation:
          row.daysToExpiry === null
            ? `${row.supplierName} is missing a certificate expiry date.`
            : expired
              ? `${row.supplierName} certificate expired ${Math.abs(row.daysToExpiry)} days ago.`
              : `${row.supplierName} certificate expires in ${row.daysToExpiry} days.`,
        estimatedImpact: expired ? "Expired certificate blocks a healthy compliance status." : "Renewal prevents compliance drift.",
        recommendedAction: `Contact ${row.supplierName} and upload the renewed halal certificate.`,
        sourceMetrics: {
          supplierName: row.supplierName,
          daysToExpiry: row.daysToExpiry,
          band: row.band,
        },
        createdAt: input.createdAt,
        confidence: "high",
      } satisfies OwnerAction;
    });
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
