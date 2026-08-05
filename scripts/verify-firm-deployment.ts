import { access, readFile as readFileFromDisk, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
        'configured === "local" || configured === "simulated"',
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
    // Presence of the function proved nothing: it existed, was tested, and was
    // never called, because the Worker exported only `fetch` while the template
    // declared a cron. The trigger needs a handler on the other end of it.
    {
      file: "src/server.ts",
      snippets: ["async scheduled(", "runScheduledMaintenanceForWorker", "runFirmMaintenance("],
    },
    {
      file: "src/server/maintenance.ts",
      snippets: ["export async function runFirmMaintenance"],
    },
  ],
} as const;

/**
 * Routes allowed not to branch on dataMode, and why. Mirrors the list in
 * src/lib/demo-store-boundary.test.ts — this gate runs offline before a deploy,
 * that one runs in the suite.
 */
const ROUTES_WITHOUT_A_MODE_BRANCH = new Set([
  "login.tsx",
  "admin.tsx",
  "work-queue.tsx",
  "__root.tsx",
]);

export type FirmDeploymentVerificationInput = {
  dryRun: boolean;
  fileExists(file: string): Promise<boolean>;
  readFile(file: string): Promise<string>;
  routeFiles: readonly string[];
  readRoute(file: string): Promise<string>;
  readSchema(): Promise<string>;
  /** Every migration concatenated, for the schema-drift diff. */
  readMigrations(): Promise<string>;
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
  const migrations = await (async () => {
    readOperations += 1;
    return input.readMigrations();
  })();

  // Was: does schema.sql mention four hardcoded table names. That passed while
  // schema.sql was missing five tables the migrations create and the app queries.
  const schemaTables = tableNamesIn(schema);
  const migrationTables = tableNamesIn(migrations);
  const tablesMissingFromSchema = [...migrationTables]
    .filter((table) => !schemaTables.has(table))
    .sort();
  const migrationReady =
    tablesMissingFromSchema.length === 0 &&
    REQUIRED_TABLES.every((table) => schemaTables.has(table));

  // routeFiles and readRoute were supplied and never read, so the gate carried
  // route-reading machinery while inspecting no routes — which is where the
  // fixture-in-production bugs actually live.
  const ungatedRoutes: string[] = [];
  for (const file of input.routeFiles) {
    if (ROUTES_WITHOUT_A_MODE_BRANCH.has(file)) continue;
    readOperations += 1;
    const body = await input.readRoute(file);
    if (!body.includes("dataMode")) ungatedRoutes.push(file);
  }
  const strictDataModeReady =
    structureReady && (await hasContract(LOCAL_GATE_CONTRACTS["strict-data-mode"]));
  const localProviderReady = await hasContract(LOCAL_GATE_CONTRACTS["local-provider-mode"]);
  const neonAuthReady = await hasContract(LOCAL_GATE_CONTRACTS["neon-auth-capability"]);
  const cronReady = await hasContract(LOCAL_GATE_CONTRACTS.cron);

  for (const file of REQUIRED_FILES) {
    checks.push({
      name: "structure " + file,
      status: (await fileExists(file)) ? "pass" : "fail",
    });
  }

  for (const table of REQUIRED_TABLES) {
    checks.push({
      name: "migration table " + table,
      status: schemaTables.has(table) ? "pass" : "fail",
    });
  }

  for (const table of tablesMissingFromSchema) {
    checks.push({
      name: `schema drift: ${table} is in migrations but not schema.sql`,
      status: "fail",
    });
  }

  for (const file of ungatedRoutes) {
    checks.push({ name: `route ${file} does not branch on dataMode`, status: "fail" });
  }

  checks.push({
    name: "route-data-mode",
    status: ungatedRoutes.length === 0 ? "pass" : "fail",
  });

  checks.push(
    {
      name: "strict-data-mode",
      status: strictDataModeReady ? "pass" : "fail",
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

export function tableNamesIn(sql: string): Set<string> {
  const names = new Set<string>();
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;

  for (const match of sql.matchAll(pattern)) {
    names.add(match[1].toLowerCase());
  }

  return names;
}

async function main(): Promise<void> {
  const routeFiles = (await readdir(routeRoot))
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    // Route-directory tests are prefixed with "-" so the router ignores them.
    .filter((file) => !file.startsWith("-"))
    .sort();
  const migrationsRoot = new URL("db/migrations/", root);
  const migrationFiles = (await readdir(migrationsRoot)).filter((file) => file.endsWith(".sql"));
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
    readMigrations: async () =>
      (
        await Promise.all(
          migrationFiles
            .sort()
            .map((file) => readFileFromDisk(new URL(file, migrationsRoot), "utf8")),
        )
      ).join("\n"),
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
