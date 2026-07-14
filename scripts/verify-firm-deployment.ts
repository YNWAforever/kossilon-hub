import { access, readFile as readFileFromDisk, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scanProductionRoutes } from "./check-production-route-imports.ts";

const root = new URL("../", import.meta.url);
const routeRoot = new URL("src/routes/", root);
const REQUIRED_FILES = [
  "src/server/db/schema.sql",
  "src/server/runtime-env.ts",
  "src/features/auth/neon-auth-server.ts",
  "src/features/documents/scanner.ts",
  "src/features/notifications/outbox.ts",
  "src/server/cron.ts",
] as const;
const REQUIRED_TABLES = [
  "notification_outbox",
  "document_upload_intents",
  "work_items",
  "escalation_events",
] as const;
const REQUIRED_BINDINGS = [
  "FIRM_ID",
  "NEON_AUTH_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "DATABASE_URL",
  "DOCUMENTS_BUCKET",
  "WOZTELL_API_BASE_URL",
  "WOZTELL_ACCESS_TOKEN",
  "WOZTELL_CHANNEL_ID",
  "WOZTELL_WEBHOOK_SECRET",
  "EMAIL_FROM",
] as const;
const BLOCKED_PROVIDERS = [
  "Neon Auth",
  "R2",
  "WOZTELL",
  "email",
  "malware scanner",
  "backups",
] as const;
const LOCAL_GATE_CONTRACTS = {
  "strict-data-mode": [
    {
      file: "src/features/runtime/data-mode.ts",
      snippets: ["export function resolveDataMode", "isProductionBuild", '"production"'],
    },
  ],
  "local-provider-mode": [
    {
      file: "src/server/provider-mode.ts",
      snippets: [
        "export function resolveProviderMode",
        'VITE_PROVIDER_MODE === "local"',
        "Local providers are unavailable in production builds.",
      ],
    },
    {
      file: "src/features/documents/local-r2.ts",
      snippets: ["export function createMemoryR2Bucket", "memoryObjects.set"],
    },
    {
      file: "src/features/notifications/local-transport.ts",
      snippets: [
        "export function createLocalNotificationTransport",
        "providerMessageId: `local:${notification.id}`",
      ],
    },
  ],
  "neon-auth-capability": [
    {
      file: "src/features/auth/neon-auth-server.ts",
      snippets: [
        "export function getNeonAuthUrl",
        "export async function requireActor",
        "get-session",
        "sign-out",
      ],
    },
  ],
  cron: [
    {
      file: "src/server/cron.ts",
      snippets: [
        "export async function runScheduledMaintenance",
        "dispatchDue",
        "cleanupExpiredUploads",
      ],
    },
  ],
} as const;

export type FirmDeploymentVerificationInput = {
  dryRun: boolean;
  fileExists(file: string): Promise<boolean>;
  readFile(file: string): Promise<string>;
  routeFiles: readonly string[];
  readRoute(file: string): Promise<string>;
  readSchema(): Promise<string>;
  readOnlyCapabilities: {
    network: false;
    resourceWrite: false;
  };
};

export type FirmDeploymentVerificationResult = {
  checks: Array<{ name: string; status: "pass" | "fail" | "blocked" }>;
  blockedBindings: string[];
  blockedProviders: string[];
  safety: {
    readOperations: number;
    networkCalls: 0;
    resourceWrites: 0;
  };
  networkCalls: 0;
};

export async function verifyFirmDeployment(
  input: FirmDeploymentVerificationInput,
): Promise<FirmDeploymentVerificationResult> {
  if (!input.dryRun) throw new Error("Firm deployment verification requires --dry-run");
  if (input.readOnlyCapabilities.network || input.readOnlyCapabilities.resourceWrite) {
    throw new Error("Firm deployment verification accepts read-only capabilities only");
  }

  const checks: FirmDeploymentVerificationResult["checks"] = [];
  let readOperations = 0;
  const existsCache = new Map<string, boolean>();
  const fileExists = async (file: string): Promise<boolean> => {
    const cached = existsCache.get(file);
    if (cached !== undefined) return cached;

    readOperations += 1;
    const exists = await input.fileExists(file);
    existsCache.set(file, exists);
    return exists;
  };
  const readText = async (file: string): Promise<string | undefined> => {
    readOperations += 1;
    try {
      return await input.readFile(file);
    } catch {
      return undefined;
    }
  };
  const allFilesExist = async (files: readonly string[]) =>
    (await Promise.all(files.map((file) => fileExists(file)))).every(Boolean);
  const hasContract = async (
    contracts: readonly { file: string; snippets: readonly string[] }[],
  ): Promise<boolean> => {
    const sources = await Promise.all(
      contracts.map(async (contract) => {
        const source = await readText(contract.file);
        return (
          source !== undefined && contract.snippets.every((snippet) => source.includes(snippet))
        );
      }),
    );
    return sources.every(Boolean);
  };

  const structureReady = await allFilesExist(REQUIRED_FILES);
  const schema = await (async () => {
    readOperations += 1;
    return input.readSchema();
  })();
  const migrationReady = REQUIRED_TABLES.every((table) =>
    schema.includes("create table if not exists " + table),
  );
  const strictDataModeReady =
    structureReady && (await hasContract(LOCAL_GATE_CONTRACTS["strict-data-mode"]));
  const localProviderReady = await hasContract(LOCAL_GATE_CONTRACTS["local-provider-mode"]);
  const neonAuthReady = await hasContract(LOCAL_GATE_CONTRACTS["neon-auth-capability"]);
  const cronReady = await hasContract(LOCAL_GATE_CONTRACTS.cron);

  let routeImportReady = false;
  if (input.routeFiles.length > 0) {
    try {
      const routeScan = await scanProductionRoutes({
        routeFiles: input.routeFiles,
        readRoute: async (file) => {
          readOperations += 1;
          return input.readRoute(file);
        },
      });
      routeImportReady = routeScan.failures.length === 0;
    } catch {
      routeImportReady = false;
    }
  }

  for (const file of REQUIRED_FILES) {
    checks.push({
      name: "structure " + file,
      status: (await fileExists(file)) ? "pass" : "fail",
    });
  }

  for (const table of REQUIRED_TABLES) {
    checks.push({
      name: "migration table " + table,
      status: schema.includes("create table if not exists " + table) ? "pass" : "fail",
    });
  }

  checks.push(
    {
      name: "strict-data-mode",
      status: strictDataModeReady ? "pass" : "fail",
    },
    {
      name: "route-import-guard",
      status: routeImportReady ? "pass" : "fail",
    },
    { name: "local-provider-mode", status: localProviderReady ? "pass" : "fail" },
    { name: "migration-schema", status: migrationReady ? "pass" : "fail" },
    {
      name: "neon-auth-capability",
      status: neonAuthReady ? "pass" : "fail",
    },
    {
      name: "cron",
      status: cronReady ? "pass" : "fail",
    },
    { name: "database", status: "blocked" },
    { name: "storage", status: "blocked" },
    { name: "malware-scanner", status: "blocked" },
    { name: "whatsapp", status: "blocked" },
    { name: "email", status: "blocked" },
    { name: "backups", status: "blocked" },
    { name: "browser-evidence", status: "blocked" },
  );

  const safety = {
    readOperations,
    networkCalls: Number(input.readOnlyCapabilities.network) as 0,
    resourceWrites: Number(input.readOnlyCapabilities.resourceWrite) as 0,
  };
  return {
    checks,
    blockedBindings: [...REQUIRED_BINDINGS],
    blockedProviders: [...BLOCKED_PROVIDERS],
    safety,
    networkCalls: safety.networkCalls,
  };
}

async function main(): Promise<void> {
  const routeFiles = (await readdir(routeRoot))
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    .sort();
  const result = await verifyFirmDeployment({
    dryRun: process.argv.includes("--dry-run"),
    fileExists: async (file) => {
      try {
        await access(new URL(file, root));
        return true;
      } catch {
        return false;
      }
    },
    readFile: (file) => readFileFromDisk(new URL(file, root), "utf8"),
    routeFiles,
    readRoute: (file) => readFileFromDisk(new URL(file, routeRoot), "utf8"),
    readSchema: () => readFileFromDisk(new URL("src/server/db/schema.sql", root), "utf8"),
    readOnlyCapabilities: { network: false, resourceWrite: false },
  });

  for (const check of result.checks) {
    console.log(`${check.status.toUpperCase()} ${check.name}`);
  }
  console.log(
    `BLOCKED live bindings ${result.blockedBindings.join(", ")} (dry-run does not read or print secret values)`,
  );
  console.log(`BLOCKED external provisioning: ${result.blockedProviders.join(", ")}`);
  console.log(
    `PASS dry-run safety: ${result.safety.readOperations} read operations; ${result.safety.networkCalls} network calls and ${result.safety.resourceWrites} resource writes performed`,
  );
  if (result.checks.some((check) => check.status === "fail")) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
