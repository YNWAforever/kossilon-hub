import { seedAnnualReturn } from "./db-seed-annual-return";
import { createSqlClient, type SqlClient } from "../src/server/db/client";
import { canonicalPostgresIdentity } from "./validate-neon-auth-demo";

type Environment = Readonly<Record<string, string | undefined>>;
type RedactedStatus = "configured";

export type DemoSeedConfig = {
  databaseUrl: string;
  authUserId: string;
  firmId: string;
  redactedSummary: {
    DATABASE_URL: RedactedStatus;
    DEMO_DATABASE_URL: RedactedStatus;
    DEMO_AUTH_USER_ID: RedactedStatus;
    DEMO_FIRM_ID: RedactedStatus;
    PRODUCTION_DATABASE_URL: RedactedStatus;
  };
};

export type DemoSeedDependencies = {
  createSqlClient: (url: string, options: { max: 1 }) => SqlClient;
  seedAnnualReturn: (sql: SqlClient, options: { adminAuthUserId: string }) => Promise<void>;
  writeSuccess: (message: string) => void;
};

function requiredValue(environment: Environment, variableName: string): string {
  const value = environment[variableName]?.trim();
  if (!value) {
    throw new Error(`${variableName} is required.`);
  }
  return value;
}

export function readDemoSeedConfig(environment: Environment): DemoSeedConfig {
  const databaseUrl = requiredValue(environment, "DEMO_DATABASE_URL");
  const configuredDatabaseUrl = requiredValue(environment, "DATABASE_URL");
  const authUserId = requiredValue(environment, "DEMO_AUTH_USER_ID");
  const firmId = requiredValue(environment, "DEMO_FIRM_ID");
  const productionDatabaseUrl = requiredValue(environment, "PRODUCTION_DATABASE_URL");
  const demoDatabaseIdentity = canonicalPostgresIdentity(databaseUrl, "DEMO_DATABASE_URL");
  const configuredDatabaseIdentity = canonicalPostgresIdentity(
    configuredDatabaseUrl,
    "DATABASE_URL",
  );
  const productionDatabaseIdentity = canonicalPostgresIdentity(
    productionDatabaseUrl,
    "PRODUCTION_DATABASE_URL",
  );

  if (demoDatabaseIdentity !== configuredDatabaseIdentity) {
    throw new Error("DATABASE_URL and DEMO_DATABASE_URL must identify the same demo database.");
  }

  if (demoDatabaseIdentity === productionDatabaseIdentity) {
    throw new Error("DEMO_DATABASE_URL must not identify the configured production database.");
  }

  return {
    databaseUrl,
    authUserId,
    firmId,
    redactedSummary: {
      DATABASE_URL: "configured",
      DEMO_DATABASE_URL: "configured",
      DEMO_AUTH_USER_ID: "configured",
      DEMO_FIRM_ID: "configured",
      PRODUCTION_DATABASE_URL: "configured",
    },
  };
}

const defaultDependencies: DemoSeedDependencies = {
  createSqlClient,
  seedAnnualReturn,
  writeSuccess: (message) => console.log(message),
};

export async function runDemoSeed(
  config: DemoSeedConfig,
  dependencies: DemoSeedDependencies = defaultDependencies,
): Promise<void> {
  const sql = dependencies.createSqlClient(config.databaseUrl, { max: 1 });

  try {
    await dependencies.seedAnnualReturn(sql, { adminAuthUserId: config.authUserId });
    dependencies.writeSuccess(`Seeded annual return demo data for DEMO_FIRM_ID=${config.firmId}.`);
  } finally {
    await sql.end();
  }
}

export type DemoSeedCliDependencies = {
  loadEnvironment: () => Promise<Environment>;
  readConfig: (environment: Environment) => DemoSeedConfig;
  runSeed: (config: DemoSeedConfig) => Promise<void>;
  writeFailure: (message: string) => void;
};

export const DEMO_SEED_CLI_FAILURE_MESSAGE = "Neon Auth demo seed failed.";

const defaultCliDependencies: DemoSeedCliDependencies = {
  loadEnvironment: async () => {
    await import("dotenv/config");
    return process.env;
  },
  readConfig: readDemoSeedConfig,
  runSeed: runDemoSeed,
  writeFailure: (message) => console.error(message),
};

export async function runDemoSeedCli(
  dependencies: DemoSeedCliDependencies = defaultCliDependencies,
): Promise<number> {
  try {
    const environment = await dependencies.loadEnvironment();
    const config = dependencies.readConfig(environment);
    await dependencies.runSeed(config);
    return 0;
  } catch {
    dependencies.writeFailure(DEMO_SEED_CLI_FAILURE_MESSAGE);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runDemoSeedCli();
}
