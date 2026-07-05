import postgres, { type Sql } from "postgres";

export type SqlClient = Sql;

export type DatabaseSslOption = "require" | "allow" | "prefer" | "verify-full" | boolean | object;

export type CreateSqlClientOptions = {
  max?: number;
  ssl?: DatabaseSslOption;
};

const POSTGRES_SSL_MODES = new Set(["require", "allow", "prefer", "verify-full"]);
const SSL_ENABLED_VALUES = new Set(["1", "true", "on"]);
const SSL_DISABLED_VALUES = new Set(["0", "false", "off", "disable", "disabled", "none"]);

let singletonSqlClient: SqlClient | undefined;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for Annual Return Control Center data access.");
  }
  return url;
}

function getDatabaseSsl(): DatabaseSslOption {
  const configured = process.env.DATABASE_SSL ?? process.env.PGSSLMODE;

  if (!configured) {
    return "require";
  }

  const normalized = configured.trim().toLowerCase();

  if (SSL_DISABLED_VALUES.has(normalized)) {
    return false;
  }

  if (SSL_ENABLED_VALUES.has(normalized)) {
    return true;
  }

  if (POSTGRES_SSL_MODES.has(normalized)) {
    return normalized as "require" | "allow" | "prefer" | "verify-full";
  }

  throw new Error(
    "DATABASE_SSL must be one of require, allow, prefer, verify-full, true, or false.",
  );
}

export function createSqlClient(
  url = getDatabaseUrl(),
  options: CreateSqlClientOptions = {},
): SqlClient {
  return postgres(url, {
    ssl: options.ssl ?? getDatabaseSsl(),
    max: options.max ?? 1,
  });
}

export function getSqlClient(): SqlClient {
  singletonSqlClient ??= createSqlClient();
  return singletonSqlClient;
}

export const sql = new Proxy((() => undefined) as unknown as SqlClient, {
  apply(_target, thisArg, args) {
    return Reflect.apply(getSqlClient(), thisArg, args);
  },
  get(_target, property) {
    const client = getSqlClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as SqlClient;
