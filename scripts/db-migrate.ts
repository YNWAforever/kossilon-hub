import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import {
  assertMigrationPreflight,
  readSchemaCatalog,
} from "../src/features/operations/schema-catalog.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

// Same policy as the app's own client (src/server/db/client.ts): TLS is required
// unless DATABASE_SSL/PGSSLMODE explicitly disables it. Hardcoding "require" here
// made the runner unable to target a local Postgres at all, which is why nothing
// could verify a migration before it reached a hosted database.
const SSL_DISABLED_VALUES = new Set(["disable", "disabled", "false", "off", "0", "no"]);
const configuredSsl = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE)?.trim().toLowerCase();
const ssl = configuredSsl && SSL_DISABLED_VALUES.has(configuredSsl) ? false : "require";

const sql = postgres(databaseUrl, {
  ssl,
  max: 1,
  onnotice: () => undefined,
});
const migrationsDir = join(process.cwd(), "db", "migrations");

try {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const bodies = new Map(
    await Promise.all(
      files.map(async (file) => [file, await readFile(join(migrationsDir, file), "utf8")] as const),
    ),
  );
  const expectedHashes = Object.fromEntries(
    [...bodies].map(([file, body]) => [file, createHash("sha256").update(body).digest("hex")]),
  );
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('kossilon:schema-migrations'))`;
    const catalog = await readSchemaCatalog(tx);
    assertMigrationPreflight({ expected: files, expectedHashes, ...catalog });
    await tx`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const appliedIds = new Set(catalog.ledger.applied);
    for (const file of files) {
      if (appliedIds.has(file)) {
        console.log(`Skipping ${file}`);
        continue;
      }
      const body = bodies.get(file)!;
      await tx.unsafe(body);
      await tx`insert into schema_migrations (id) values (${file})`;
      console.log(`Applied ${file} (commit pending)`);
    }
  });
  console.log("Migration transaction committed.");
} finally {
  await sql.end();
}
