import type postgres from "postgres";
import type { SchemaFact, SchemaLedger } from "./schema-health.ts";

type Query = postgres.Sql | postgres.TransactionSql;
const MARKER_MIGRATION = "0034_notification_outbox_dispatch_marker.sql";

/** Catalog SELECTs only. Caller may wrap these in a read-only transaction. */
export async function readSchemaCatalog(sql: Query): Promise<{
  ledger: SchemaLedger;
  facts: SchemaFact[];
  applicationPresent: boolean;
}> {
  const [presence] = await sql<{ ledger: boolean; application: boolean }[]>`
    select to_regclass('schema_migrations') is not null ledger,
           (to_regclass('notification_outbox') is not null
            or to_regclass('companies') is not null
            or to_regclass('annual_return_cases') is not null) application
  `;
  let ledger: SchemaLedger = { present: presence.ledger, applied: [] };
  if (presence.ledger) {
    const [hashColumn] = await sql<{ present: boolean }[]>`
      select exists(select 1 from pg_attribute
        where attrelid = to_regclass('schema_migrations') and attname = 'sha256'
          and not attisdropped and atttypid = 'text'::regtype) present
    `;
    if (hashColumn.present) {
      const rows = await sql<
        { id: string; sha256: string | null }[]
      >`select id, sha256 from schema_migrations order by id`;
      ledger = {
        present: true,
        applied: rows.map((row) => row.id),
        hashes: Object.fromEntries(rows.map((row) => [row.id, row.sha256])),
      };
    } else {
      const rows = await sql<{ id: string }[]>`select id from schema_migrations order by id`;
      ledger = { present: true, applied: rows.map((row) => row.id) };
    }
  }
  const columns = await sql<
    { type: string; not_null: boolean; default_expression: string | null }[]
  >`
    select format_type(a.atttypid, a.atttypmod) type, a.attnotnull not_null,
           pg_get_expr(d.adbin, d.adrelid) default_expression
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = to_regclass('notification_outbox') and a.attname = 'dispatch_started_attempt'
      and not a.attisdropped
  `;
  const indexes = await sql<
    { valid: boolean; definition: string; key_column: string; predicate: string | null }[]
  >`
    select i.indisvalid and i.indisready and i.indnkeyatts=1 and i.indnatts=1
      and am.amname='btree' valid, pg_get_indexdef(i.indexrelid) definition,
      pg_get_indexdef(i.indexrelid,1,true) key_column,
      pg_get_expr(i.indpred,i.indrelid) predicate
    from pg_index i join pg_class idx on idx.oid = i.indexrelid
    join pg_am am on am.oid=idx.relam
    where i.indrelid = to_regclass('notification_outbox') and idx.relname = 'notification_outbox_dispatch_marker_idx'
  `;
  const column = columns[0];
  const index = indexes[0];
  const validIndex = Boolean(
    index?.valid &&
    index.key_column === "updated_at" &&
    index.predicate ===
      "((status = 'processing'::text) AND (dispatch_started_attempt IS NOT NULL))",
  );
  return {
    ledger,
    applicationPresent: presence.application,
    facts: [
      {
        key: "notification_outbox.dispatch_started_attempt",
        migrationId: MARKER_MIGRATION,
        present: Boolean(
          column &&
          column.type === "integer" &&
          !column.not_null &&
          column.default_expression === null,
        ),
        expected: "nullable integer without default",
        observed: column
          ? `${column.type}; nullable=${!column.not_null}; default=${column.default_expression ?? "none"}`
          : null,
      },
      {
        key: "notification_outbox_dispatch_marker_idx",
        migrationId: MARKER_MIGRATION,
        present: validIndex,
        expected:
          "valid index on updated_at where status=processing and dispatch_started_attempt is not null",
        observed: index?.definition ?? null,
      },
    ],
  };
}

/** Fail before DDL if the existing database has unexplained history or damage. */
export function assertMigrationPreflight(input: {
  expected: readonly string[];
  expectedHashes?: Readonly<Record<string, string>>;
  ledger: SchemaLedger;
  facts: readonly SchemaFact[];
  applicationPresent: boolean;
}) {
  if (!input.ledger.present) {
    if (input.applicationPresent)
      throw new Error(
        "Migration blocked: existing application schema has no ledger; run read-only audit and review reconciliation.",
      );
    return;
  }
  const expected = new Set(input.expected);
  if (input.ledger.applied.length === 0 && input.applicationPresent) {
    throw new Error(
      "Migration blocked: empty ledger over existing application schema; review reconciliation before replaying historical SQL.",
    );
  }
  if (
    input.ledger.applied.some((id) => {
      const recorded = input.ledger.hashes?.[id];
      const wanted = input.expectedHashes?.[id];
      return recorded && wanted && recorded.toLowerCase() !== wanted.toLowerCase();
    })
  ) {
    throw new Error(
      "Migration blocked: recorded hash mismatch; review migration source history before DDL.",
    );
  }
  if (input.ledger.applied.some((id) => !expected.has(id))) {
    throw new Error(
      "Migration blocked: unrecognised recorded IDs; review schema/deployment lineage before DDL.",
    );
  }
  const applied = new Set(input.ledger.applied);
  if (
    input.facts.some(
      (fact) => fact.migrationId && applied.has(fact.migrationId) && fact.present !== true,
    )
  ) {
    throw new Error(
      "Migration blocked: recorded migration lacks required physical DDL; prepare forward-only repair.",
    );
  }
  // Only a contiguous prefix can be advanced automatically; gaps require review.
  const firstMissing = input.expected.findIndex((id) => !applied.has(id));
  if (firstMissing >= 0 && input.expected.slice(firstMissing).some((id) => applied.has(id))) {
    throw new Error(
      "Migration blocked: historical gap in recorded IDs; review before replaying SQL.",
    );
  }
}
