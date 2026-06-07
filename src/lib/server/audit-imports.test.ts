import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// V11.2 architecture guard (spec §B App Req #3 & #4): audit emission is server-only.
// The privileged audit helpers carry an RLS-bypassing service-role capability and
// MUST never be importable into a client bundle. This is a static import-graph
// check over the source tree.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// security-audit is the V12.4 edge-safe security_event emitter. It is NOT
// `server-only` (the Edge middleware imports it), but it carries the same
// service-role transport, so it must likewise never reach a client bundle.
const AUDIT_MODULES = ["@/lib/server/audit", "@/lib/server/audit-events", "@/lib/server/security-audit"];

// Sanctioned modules permitted to call the emit_audit_log RPC.
const SANCTIONED_EMITTERS = [join("lib", "server", "audit.ts"), join("lib", "server", "security-audit.ts")];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(SRC);

function isClientModule(src: string): boolean {
  // "use client" must be the first statement; a leading directive is enough.
  const head = src.replace(/^﻿/, "").trimStart();
  return head.startsWith('"use client"') || head.startsWith("'use client'");
}

describe("audit emission import graph", () => {
  it("the audit helper modules declare server-only", () => {
    for (const rel of ["src/lib/server/audit.ts", "src/lib/server/audit-events.ts"]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src.includes('import "server-only"'), `${rel} must import "server-only"`).toBe(true);
    }
  });

  it("no client component imports an audit helper module", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const src = readFileSync(file, "utf8");
      if (!isClientModule(src)) continue;
      for (const mod of AUDIT_MODULES) {
        if (src.includes(`from "${mod}"`) || src.includes(`from '${mod}'`)) {
          offenders.push(`${file} -> ${mod}`);
        }
      }
    }
    expect(offenders, `client modules importing audit helpers: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the emit_audit_log RPC is only ever called from a sanctioned emitter module", () => {
    const callers: string[] = [];
    for (const file of ALL_FILES) {
      const src = readFileSync(file, "utf8");
      if (src.includes("emit_audit_log") && !SANCTIONED_EMITTERS.some((m) => file.endsWith(m))) {
        callers.push(file);
      }
    }
    expect(callers, `unexpected emit_audit_log callers: ${callers.join(", ")}`).toEqual([]);
  });

  it("the audit-events read module performs no writes", () => {
    const src = readFileSync(join(ROOT, "src/lib/server/audit-events.ts"), "utf8");
    for (const write of [".insert(", ".update(", ".delete(", ".upsert("]) {
      expect(src.includes(write), `audit-events.ts must not call ${write}`).toBe(false);
    }
  });

  it("the audit module uses the service client as transport and forces server-derived actor", () => {
    const src = readFileSync(join(ROOT, "src/lib/server/audit.ts"), "utf8");
    expect(src.includes("createSupabaseServiceClient")).toBe(true);
    // There must be no actor/created_at parameter surfaced to callers.
    expect(/p_actor|p_created_at|actorId\s*:/.test(src)).toBe(false);
  });
});
