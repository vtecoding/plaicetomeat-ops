import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("operator help action boundary", () => {
  it("delegates operation identity, mistake targeting, alert and audit to one authenticated RPC", () => {
    const action = readFileSync(join(process.cwd(), "src/app/actions/operator/help.ts"), "utf8");

    expect(action).toContain("await createSupabaseServerClient()");
    expect(action).toContain('supabase.rpc("create_operator_help_alert_v18"');
    expect(action).not.toContain("createSupabaseServiceClient");
    expect(action).not.toContain("createOwnerAlert");
    expect(action).not.toContain('.from("operator_workflow_runs")');
    expect(action).not.toContain('.from("owner_alerts")');
  });
});
