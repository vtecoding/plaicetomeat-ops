import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ProductionMutationBlockedError } from "@/lib/operator/execution-context";

vi.mock("server-only", () => ({}));

describe("real Operator mutation boundaries", () => {
  it("rejects dry-run and missing context before the till adapter reaches truth", async () => {
    const { recordTillMovement } = await import("@/app/actions/operator/till");
    const input = { runId: crypto.randomUUID(), direction: "in" as const, amountGbp: 1, reasonCode: "change" as const };
    await expect(recordTillMovement({ ...input, executionContext: { mode: "dry-run" } })).rejects.toBeInstanceOf(ProductionMutationBlockedError);
    await expect(recordTillMovement(input)).rejects.toBeInstanceOf(ProductionMutationBlockedError);
  });

  it("places an explicit fail-closed assertion on every tutorial-reachable server adapter", () => {
    const files = [
      "src/app/actions/ops-capture.ts",
      "src/app/actions/operator/serve.ts",
      "src/app/actions/operator/delivery.ts",
      "src/app/actions/operator/waste.ts",
      "src/app/actions/operator/till.ts",
      "src/app/actions/operator/help.ts",
      "src/app/actions/operator/evidence.ts",
      "src/app/actions/operator/certificate.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source, file).toContain("assertProductionMutationAllowed");
    }
  });
});
