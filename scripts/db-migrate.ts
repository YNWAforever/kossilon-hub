import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");

const SSL_DISABLED_VALUES = new Set(["disable", "disabled", "false", "off", "0", "no"]);
const configuredSsl = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE)?.trim().toLowerCase();
const ssl = configuredSsl && SSL_DISABLED_VALUES.has(configuredSsl) ? false : "require";
const sql = postgres(databaseUrl, { ssl, max: 1, onnotice: () => undefined });
const migrationsDir = join(process.cwd(), "db", "migrations");

try {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  // Inspect before changing anything. An older ledger entry may represent a
  // renamed migration, but a filename match alone cannot prove that it is safe
  // to replay or silently discard it. T01 reconciles those cases explicitly.
  const [presence] = await sql<{ present: boolean }[]>`
    select to_regclass('schema_migrations') is not null as present
  `;
  if (!presence?.present) {
    const [catalog] = await sql<{ user_tables: number }[]>`
      select count(*)::int as user_tables from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p')
    `;
    if ((catalog?.user_tables ?? 0) > 0) {
      throw new Error("Schema has tables but no migration ledger; reconcile it before migrating.");
    }
    await sql`
      create table schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `;
  }

  const appliedRows = await sql<{ id: string }[]>`select id from schema_migrations`;
  const applied = new Set(appliedRows.map((row) => row.id));
  const known = new Set(files);
  const unknown = [...applied].filter((id) => !known.has(id)).sort();
  if (unknown.length > 0) {
    throw new Error(
      `Unknown migration ledger entries: ${unknown.join(", ")}. Reconcile before migrating.`,
    );
  }

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file}`);
      continue;
    }
    const body = await readFile(join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (id) values (${file})`;
    });
    console.log(`Applied ${file}`);
  }
} finally {
  await sql.end();
}
