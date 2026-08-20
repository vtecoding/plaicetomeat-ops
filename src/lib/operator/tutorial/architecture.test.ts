import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertProductionMutationAllowed, ProductionMutationBlockedError } from "@/lib/operator/execution-context";
import { en, ps } from "@/lib/operator/i18n/resources";
import { completeShopDaySteps } from "./scenario";
import { tutorialTargets } from "./targets";

function sourceTree(root: string): string {
  return fs.readdirSync(root, { withFileTypes: true }).map((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? sourceTree(full) : /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? fs.readFileSync(full, "utf8") : "";
  }).join("\n");
}

describe("dry-run architecture invariants", () => {
  it("fails closed for dry-run, missing and unknown mutation contexts", () => {
    expect(() => assertProductionMutationAllowed({ mode: "live" }, "payment")).not.toThrow();
    expect(() => assertProductionMutationAllowed({ mode: "dry-run" }, "payment")).toThrow(ProductionMutationBlockedError);
    expect(() => assertProductionMutationAllowed(undefined, "payment")).toThrow(ProductionMutationBlockedError);
    expect(() => assertProductionMutationAllowed({ mode: "future" } as never, "payment")).toThrow(ProductionMutationBlockedError);
  });

  it("keeps exact English/Pashto key parity and has tutorial copy", () => {
    expect(Object.keys(ps).sort()).toEqual(Object.keys(en).sort());
    for (const step of completeShopDaySteps) {
      expect(en[step.titleKey]).toBeTruthy();
      expect(ps[step.titleKey]).toBeTruthy();
      expect(en[step.instructionKey]).toBeTruthy();
      expect(ps[step.instructionKey]).toBeTruthy();
    }
  });

  it("uses 35 unique stable semantic targets that exist in canonical Operator UI", () => {
    expect(completeShopDaySteps).toHaveLength(35);
    const registered = new Set<string>(tutorialTargets);
    const referenced = completeShopDaySteps.flatMap((step) => step.target ? [step.target] : []);
    expect(referenced.every((target) => registered.has(target))).toBe(true);
    expect(new Set(referenced).size).toBe(referenced.length);
    const operatorSources = sourceTree(path.resolve(process.cwd(), "src/app/operator"));
    for (const target of tutorialTargets) expect(operatorSources).toContain(`\"${target}\"`);
  });

  it("keeps tutorial infrastructure and owner fixtures free of production adapters", () => {
    const tutorialSources = sourceTree(path.resolve(process.cwd(), "src/lib/operator/tutorial"));
    const ownerSources = sourceTree(path.resolve(process.cwd(), "src/app/admin/tutorial"));
    for (const source of [tutorialSources, ownerSources]) {
      expect(source).not.toMatch(/@\/app\/actions|@\/lib\/supabase|createSupabase|\.from\(|\.rpc\(/);
    }
  });
});
