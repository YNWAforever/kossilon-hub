import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
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

export type FirmDeploymentVerificationInput = {
  dryRun: boolean;
  fileExists(file: string): Promise<boolean>;
  readSchema(): Promise<string>;
};

export type FirmDeploymentVerificationResult = {
  checks: Array<{ name: string; status: "pass" | "fail" | "blocked" }>;
  blockedBindings: string[];
  blockedProviders: string[];
  networkCalls: 0;
};

export async function verifyFirmDeployment(
  input: FirmDeploymentVerificationInput,
): Promise<FirmDeploymentVerificationResult> {
  if (!input.dryRun) throw new Error("Firm deployment verification requires --dry-run");

  const checks: FirmDeploymentVerificationResult["checks"] = [];
  for (const file of REQUIRED_FILES) {
    checks.push({
      name: `structure ${file}`,
      status: (await input.fileExists(file)) ? "pass" : "fail",
    });
  }

  const schema = await input.readSchema();
  for (const table of REQUIRED_TABLES) {
    checks.push({
      name: `migration table ${table}`,
      status: schema.includes(`create table if not exists ${table}`) ? "pass" : "fail",
    });
  }

  return {
    checks,
    blockedBindings: [...REQUIRED_BINDINGS],
    blockedProviders: [...BLOCKED_PROVIDERS],
    networkCalls: 0,
  };
}

async function main(): Promise<void> {
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
    readSchema: () => readFile(new URL("src/server/db/schema.sql", root), "utf8"),
  });

  for (const check of result.checks) {
    console.log(`${check.status.toUpperCase()} ${check.name}`);
  }
  console.log(
    `BLOCKED live bindings ${result.blockedBindings.join(", ")} (dry-run does not read or print secret values)`,
  );
  console.log(`BLOCKED external provisioning: ${result.blockedProviders.join(", ")}`);
  console.log(
    `PASS dry-run safety: ${result.networkCalls} network calls or resource writes performed`,
  );
  if (result.checks.some((check) => check.status === "fail")) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
