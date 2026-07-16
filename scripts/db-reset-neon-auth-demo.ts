import { seedAnnualReturn } from "./db-seed-annual-return";
import { createSqlClient, type SqlClient } from "../src/server/db/client";
import { readDemoSeedConfig, type DemoSeedConfig } from "./db-seed-neon-auth-demo";

export const DEMO_RESET_CLI_FAILURE_MESSAGE = "Neon Auth demo reset failed.";

const DEMO_RESET_TABLES = [
  "assignment_events",
  "escalation_events",
  "notification_outbox",
  "document_upload_intents",
  "whatsapp_webhook_events",
  "whatsapp_messages",
  "whatsapp_templates",
  "whatsapp_contacts",
  "annual_return_audit_events",
  "staff_skills",
  "client_company_memberships",
  "business_calendar_holidays",
  "work_items",
  "sla_policies",
  "business_calendars",
  "staff_profiles",
  "reminder_logs",
  "case_notes",
  "timeline_events",
  "payments",
  "annual_return_checklist_items",
  "annual_return_cases",
  "documents",
  "companies",
  "teams",
  "users",
] as const;

const DEMO_RESET_SQL = `truncate table ${DEMO_RESET_TABLES.map((table) => `public.${table}`).join(
  ", ",
)} restart identity cascade`;

export function readDemoResetOptions(args: string[]): { confirmFirmId: string } {
  const index = args.indexOf("--confirm-firm");
  const confirmFirmId = index >= 0 ? args[index + 1]?.trim() : undefined;
  if (confirmFirmId !== "kossilon-demo") {
    throw new Error("--confirm-firm requires kossilon-demo.");
  }
  return { confirmFirmId };
}

export type DemoResetDependencies = {
  createSqlClient(url: string, options: { max: 1 }): SqlClient;
  seedAnnualReturn(sql: SqlClient, options: { adminAuthUserId: string }): Promise<void>;
  writeSuccess(message: string): void;
};

export async function runDemoReset(
  config: DemoSeedConfig,
  dependencies: DemoResetDependencies = defaultResetDependencies,
): Promise<void> {
  const sql = dependencies.createSqlClient(config.databaseUrl, { max: 1 });
  try {
    await sql.begin(async (tx) => tx.unsafe(DEMO_RESET_SQL));
    await dependencies.seedAnnualReturn(sql, { adminAuthUserId: config.authUserId });
    dependencies.writeSuccess(`Reset Neon Auth demo data for DEMO_FIRM_ID=${config.firmId}.`);
  } finally {
    await sql.end();
  }
}

const defaultResetDependencies: DemoResetDependencies = {
  createSqlClient,
  seedAnnualReturn,
  writeSuccess: (message) => console.log(message),
};

export type DemoResetCliDependencies = {
  loadEnvironment(): Promise<Readonly<Record<string, string | undefined>>>;
  readConfig(environment: Readonly<Record<string, string | undefined>>): DemoSeedConfig;
  readOptions(args: string[]): { confirmFirmId: string };
  runReset(config: DemoSeedConfig): Promise<void>;
  writeFailure(message: string): void;
};

const defaultCliDependencies: DemoResetCliDependencies = {
  loadEnvironment: async () => {
    await import("dotenv/config");
    return process.env;
  },
  readConfig: readDemoSeedConfig,
  readOptions: readDemoResetOptions,
  runReset: runDemoReset,
  writeFailure: (message) => console.error(message),
};

export async function runDemoResetCli(
  args = process.argv.slice(2),
  dependencies: DemoResetCliDependencies = defaultCliDependencies,
): Promise<number> {
  try {
    dependencies.readOptions(args);
    const environment = await dependencies.loadEnvironment();
    const config = dependencies.readConfig(environment);
    if (config.firmId !== "kossilon-demo") throw new Error("Unexpected demo firm.");
    await dependencies.runReset(config);
    return 0;
  } catch {
    dependencies.writeFailure(DEMO_RESET_CLI_FAILURE_MESSAGE);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runDemoResetCli();
}
