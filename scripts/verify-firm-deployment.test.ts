import { describe, expect, it } from "vitest";
import { verifyFirmDeployment } from "./verify-firm-deployment";

describe("verifyFirmDeployment", () => {
  const gateFiles = new Map<string, string>([
    [
      "src/features/runtime/data-mode.ts",
      'export function resolveDataMode(input: { isProductionBuild: boolean }) { return "production"; }',
    ],
    [
      "src/server/provider-mode.ts",
      'export function resolveProviderMode() { throw new Error("Local providers are unavailable in production builds."); } const requested: ProviderMode = configured === "local" || configured === "simulated" ? configured : "live";',
    ],
    [
      "src/features/documents/local-r2.ts",
      'export function createMemoryR2Bucket() { memoryObjects.set("key", {}); }',
    ],
    [
      "src/features/notifications/local-transport.ts",
      "export function createLocalNotificationTransport() { return { providerMessageId: `local:${notification.id}` }; }",
    ],
    [
      "src/features/auth/neon-auth-server.ts",
      "export function getNeonAuthUrl() {} export async function requireActor() {} get-session sign-out",
    ],
    [
      "src/server/cron.ts",
      "export async function runScheduledMaintenance() {} dispatchDue cleanupExpiredUploads",
    ],
  ]);
  const verificationInput = (
    overrides: Partial<Parameters<typeof verifyFirmDeployment>[0]> = {},
  ) => ({
    dryRun: true,
    readOnlyCapabilities: { network: false, resourceWrite: false },
    fileExists: async () => true,
    readFile: async (file: string) => gateFiles.get(file) ?? "",
    routeFiles: ["index.tsx"],
    readRoute: async () => "export default function Route() { return null; }",
    readSchema: async () =>
      ["notification_outbox", "document_upload_intents", "work_items", "escalation_events"]
        .map((table) => "create table if not exists " + table)
        .join("\n"),
    ...overrides,
  });

  it("reports named local gates and blocks live integrations without secrets", async () => {
    const result = await verifyFirmDeployment(verificationInput());

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
    expect(result.safety.networkCalls).toBe(0);
    expect(result.safety.resourceWrites).toBe(0);
    expect(result.safety.readOperations).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("fails a local gate when its implementation contract is missing", async () => {
    gateFiles.set("src/server/cron.ts", "export async function runScheduledMaintenance() {}");

    const result = await verifyFirmDeployment(verificationInput());

    expect(result.checks).toContainEqual({ name: "cron", status: "fail" });
    gateFiles.set(
      "src/server/cron.ts",
      "export async function runScheduledMaintenance() {} dispatchDue cleanupExpiredUploads",
    );
  });

  it("fails the route gate when protected mutations are imported by a route", async () => {
    const result = await verifyFirmDeployment(
      verificationInput({
        readRoute: async () =>
          'import { sendFollowUpNow } from "@/lib/annual-return-store"; export default function Route() { return null; }',
      }),
    );

    expect(result.checks).toContainEqual({ name: "route-import-guard", status: "fail" });
  });

  it("reports binding names but never values", async () => {
    const result = await verifyFirmDeployment(verificationInput());

    expect(result.blockedBindings).toContain("WOZTELL_ACCESS_TOKEN");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(result.safety.networkCalls).toBe(0);
  });
});
