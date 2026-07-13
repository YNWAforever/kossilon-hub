import { describe, expect, it } from "vitest";
import { verifyFirmDeployment } from "./verify-firm-deployment";

describe("verifyFirmDeployment", () => {
  it("reports binding names but never values", async () => {
    const result = await verifyFirmDeployment({
      dryRun: true,
      fileExists: async () => true,
      readSchema: async () =>
        ["notification_outbox", "document_upload_intents", "work_items", "escalation_events"]
          .map((table) => `create table if not exists ${table}`)
          .join("\n"),
    });

    expect(result.blockedBindings).toContain("WOZTELL_ACCESS_TOKEN");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(result.networkCalls).toBe(0);
  });
});
