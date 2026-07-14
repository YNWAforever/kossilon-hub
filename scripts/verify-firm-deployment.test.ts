import { describe, expect, it } from "vitest";
import { verifyFirmDeployment } from "./verify-firm-deployment";

describe("verifyFirmDeployment", () => {
  it("reports named local gates and blocks live integrations without secrets", async () => {
    const result = await verifyFirmDeployment({
      dryRun: true,
      fileExists: async () => true,
      readSchema: async () =>
        ["notification_outbox", "document_upload_intents", "work_items", "escalation_events"]
          .map((table) => "create table if not exists " + table)
          .join("\n"),
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        { name: "strict-data-mode", status: "pass" },
        { name: "route-import-guard", status: "pass" },
        { name: "local-provider-mode", status: "pass" },
        { name: "migration-schema", status: "pass" },
        { name: "neon-auth-capability", status: "pass" },
        { name: "cron", status: "pass" },
        { name: "database", status: "blocked" },
        { name: "storage", status: "blocked" },
        { name: "malware-scanner", status: "blocked" },
        { name: "whatsapp", status: "blocked" },
        { name: "email", status: "blocked" },
        { name: "backups", status: "blocked" },
        { name: "browser-evidence", status: "blocked" },
      ]),
    );
    expect(result.networkCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

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
