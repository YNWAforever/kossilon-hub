import { describe, expect, it } from "vitest";
import { tableNamesIn, verifyFirmDeployment } from "./verify-firm-deployment";

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
  [
    "src/server.ts",
    "export default { async scheduled() { await runScheduledMaintenanceForWorker(0); } } runFirmMaintenance(",
  ],
  ["src/server/maintenance.ts", "export async function runFirmMaintenance() {}"],
]);

const schemaTablesForWiring = [
  "notification_outbox",
  "document_upload_intents",
  "work_items",
  "escalation_events",
];

const verificationInputForWiring = (
  overrides: Partial<Parameters<typeof verifyFirmDeployment>[0]> = {},
) => ({
  dryRun: true,
  readOnlyCapabilities: { network: false, resourceWrite: false } as const,
  fileExists: async () => true,
  readFile: async (file: string) => gateFiles.get(file) ?? "",
  routeFiles: ["index.tsx"],
  readRoute: async () => "const { dataMode } = Route.useRouteContext();",
  readSchema: async () =>
    schemaTablesForWiring.map((table) => "create table if not exists " + table).join("\n"),
  readMigrations: async () =>
    schemaTablesForWiring.map((table) => "create table " + table).join("\n"),
  ...overrides,
});

describe("verifyFirmDeployment", () => {
  const verificationInput = verificationInputForWiring;

  it("reports named local gates and blocks live integrations without secrets", async () => {
    const result = await verifyFirmDeployment(verificationInput());

    expect(result.checks).toEqual(
      expect.arrayContaining([
        { name: "strict-data-mode", status: "pass" },
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

  it("reports binding names but never values", async () => {
    const result = await verifyFirmDeployment(verificationInput());

    expect(result.blockedBindings).toContain("WOZTELL_ACCESS_TOKEN");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(result.safety.networkCalls).toBe(0);
  });
});

/**
 * Every gate used to be `source.includes(snippet)`, so none of them could fail
 * for a behavioural reason. The cron gate printed PASS while the Worker exported
 * no scheduled handler; the migration-schema gate printed PASS while schema.sql
 * was missing five tables the app queries; and routeFiles/readRoute were supplied
 * and never read at all. These tests exist to prove the gates can now fail.
 */
describe("verifyFirmDeployment catches wiring, not just spelling", () => {
  const passingInput = (overrides: Partial<Parameters<typeof verifyFirmDeployment>[0]> = {}) =>
    verificationInputForWiring(overrides);

  it("fails when the cron trigger has no scheduled handler behind it", async () => {
    const result = await verifyFirmDeployment(
      passingInput({
        readFile: async (file: string) =>
          file === "src/server.ts"
            ? "export default { async fetch() {} }"
            : (gateFiles.get(file) ?? ""),
      }),
    );

    expect(result.checks).toContainEqual({ name: "cron", status: "fail" });
  });

  it("fails when a migration creates a table schema.sql does not have", async () => {
    const result = await verifyFirmDeployment(
      passingInput({
        readMigrations: async () =>
          [...schemaTablesForWiring, "whatsapp_messages"]
            .map((table) => "create table " + table)
            .join("\n"),
      }),
    );

    expect(result.checks).toContainEqual({
      name: "schema drift: whatsapp_messages is in migrations but not schema.sql",
      status: "fail",
    });
    expect(result.checks).toContainEqual({ name: "migration-schema", status: "fail" });
  });

  it("fails when a route renders without branching on dataMode", async () => {
    const result = await verifyFirmDeployment(
      passingInput({
        routeFiles: ["payments.tsx"],
        readRoute: async () => "export default function Route() { return null; }",
      }),
    );

    expect(result.checks).toContainEqual({
      name: "route payments.tsx does not branch on dataMode",
      status: "fail",
    });
    expect(result.checks).toContainEqual({ name: "route-data-mode", status: "fail" });
  });

  it("exempts the routes that legitimately serve one mode", async () => {
    const result = await verifyFirmDeployment(
      passingInput({
        routeFiles: ["login.tsx", "work-queue.tsx"],
        readRoute: async () => "export default function Route() { return null; }",
      }),
    );

    expect(result.checks).toContainEqual({ name: "route-data-mode", status: "pass" });
  });

  it("reads the routes it was handed", async () => {
    let reads = 0;
    await verifyFirmDeployment(
      passingInput({
        routeFiles: ["payments.tsx", "documents.tsx"],
        readRoute: async () => {
          reads += 1;
          return "dataMode";
        },
      }),
    );

    expect(reads).toBe(2);
  });
});

describe("tableNamesIn", () => {
  it("reads both the plain and idempotent create forms", () => {
    expect([...tableNamesIn("create table foo (id uuid);")]).toEqual(["foo"]);
    expect([...tableNamesIn("create table if not exists Bar (id uuid);")]).toEqual(["bar"]);
  });

  it("ignores prose that merely mentions a table", () => {
    expect([...tableNamesIn("-- the work_items table is created elsewhere")]).toEqual([]);
  });
});
