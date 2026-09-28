import "dotenv/config";
import postgres from "postgres";
import { EXPECTED_MIGRATIONS } from "../src/features/operations/schema-health.ts";
import {
  inspectSchemaCompatibility,
  type SchemaCatalog,
} from "../src/features/operations/schema-compatibility.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for read-only schema inspection.");
const sslOff = new Set(["disable", "disabled", "false", "off", "0", "no"]);
const sslSetting = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE)?.trim().toLowerCase();
const sql = postgres(databaseUrl, {
  ssl: sslSetting && sslOff.has(sslSetting) ? false : "require",
  max: 1,
  onnotice: () => undefined,
});

try {
  const report = await sql.begin(async (tx) => {
    await tx`set transaction read only`;
    const [presence] = await tx<{ present: boolean }[]>`
      select to_regclass('schema_migrations') is not null as present
    `;
    const applied = presence?.present
      ? (await tx<{ id: string }[]>`select id from schema_migrations order by id`).map(
          (row) => row.id,
        )
      : [];
    const tables = await tx<{ name: string }[]>`
      select c.relname as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p')
    `;
    const columns = await tx<{ name: string; definition: string }[]>`
      select c.relname || '.' || a.attname as name,
             format_type(a.atttypid, a.atttypmod) as definition
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p')
        and a.attnum > 0 and not a.attisdropped
    `;
    const indexes = await tx<{ name: string; definition: string }[]>`
      select i.relname as name, pg_get_indexdef(x.indexrelid) as definition
      from pg_index x join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = current_schema()
    `;
    const constraints = await tx<{ name: string; definition: string }[]>`
      select p.conname as name, pg_get_constraintdef(p.oid) as definition
      from pg_constraint p join pg_namespace n on n.oid = p.connamespace
      where n.nspname = current_schema()
    `;
    const catalog: SchemaCatalog = {
      tables: tables.map((row) => row.name),
      columns: Object.fromEntries(columns.map((row) => [row.name, row.definition])),
      indexes: Object.fromEntries(indexes.map((row) => [row.name, row.definition])),
      constraints: Object.fromEntries(constraints.map((row) => [row.name, row.definition])),
    };
    return inspectSchemaCompatibility({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: presence?.present === true, applied },
      catalog,
    });
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.canRelease && !process.argv.includes("--report-only")) process.exitCode = 1;
} finally {
  await sql.end();
}
