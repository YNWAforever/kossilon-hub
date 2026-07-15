import { seedAnnualReturn } from "./db-seed-annual-return";
import { createSqlClient, type SqlClient } from "../src/server/db/client";

type Environment = Readonly<Record<string, string | undefined>>;
type RedactedStatus = "configured" | "not provided";

export type DemoSeedConfig = {
  databaseUrl: string;
  authUserId: string;
  firmId: string;
  redactedSummary: {
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

function parsePostgresUrl(value: string, variableName: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${variableName} must use the postgres: or postgresql: scheme.`);
  }

  if (!url.hostname) {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (!databaseName) {
    throw new Error(`${variableName} must include a non-empty database path.`);
  }

  return url;
}

function normalizedDatabaseIdentity(url: URL): string {
  const databaseName = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "").toLowerCase();
  const port = url.port || "5432";

  return `${url.hostname.toLowerCase()}:${port}/${databaseName}`;
}

export function readDemoSeedConfig(environment: Environment): DemoSeedConfig {
  const databaseUrl = requiredValue(environment, "DEMO_DATABASE_URL");
  const authUserId = requiredValue(environment, "DEMO_AUTH_USER_ID");
  const firmId = requiredValue(environment, "DEMO_FIRM_ID");
  const parsedDemoUrl = parsePostgresUrl(databaseUrl, "DEMO_DATABASE_URL");
  const productionDatabaseUrl = environment.PRODUCTION_DATABASE_URL?.trim();

  if (productionDatabaseUrl) {
    const parsedProductionUrl = parsePostgresUrl(productionDatabaseUrl, "PRODUCTION_DATABASE_URL");
    if (normalizedDatabaseIdentity(parsedDemoUrl) === normalizedDatabaseIdentity(parsedProductionUrl)) {
      throw new Error("DEMO_DATABASE_URL must not identify the configured production database.");
    }
  }

  return {
    databaseUrl,
    authUserId,
    firmId,
    redactedSummary: {
      DEMO_DATABASE_URL: "configured",
      DEMO_AUTH_USER_ID: "configured",
      DEMO_FIRM_ID: "configured",
      PRODUCTION_DATABASE_URL: productionDatabaseUrl ? "configured" : "not provided",
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

async function runCli() {
  await import("dotenv/config");
  await runDemoSeed(readDemoSeedConfig(process.env));
}

if (import.meta.main) {
  await runCli();
}
