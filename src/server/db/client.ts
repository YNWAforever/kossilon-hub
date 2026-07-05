import postgres, { type Sql } from "postgres";

export type SqlClient = Sql;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for Annual Return Control Center data access.");
  }
  return url;
}

export function createSqlClient(url = getDatabaseUrl()): SqlClient {
  return postgres(url, {
    ssl: "require",
    max: 1,
  });
}

export const sql = createSqlClient();
