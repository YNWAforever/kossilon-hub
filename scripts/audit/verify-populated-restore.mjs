import fs from "node:fs";
import crypto from "node:crypto";
import postgres from "postgres";
const dir = ".worktrees/staff-batch2-20261012/";
const original = JSON.parse(
  fs.readFileSync(process.argv[2] ?? dir + "clone-private-inventory.json", "utf8"),
);
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
const localUrl = process.env.R25_LOCAL_URL;
if (!localUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(localUrl).hostname))
  throw Error("Verifier requires owned localhost restore.");
const db = postgres(localUrl, { ssl: false, max: 1 });
try {
  const receipt = await db.begin(async (tx) => {
    await tx.unsafe("set transaction read only");
    const ledger = await tx.unsafe("select * from schema_migrations order by id");
    const originalColumns = Object.groupBy(original.columns, (c) => c.table);
    const compared = [];
    for (const expected of original.rows) {
      const cols = originalColumns[expected.table].map((c) => quote(c.column)).join(",");
      const [row] = await tx.unsafe(
        "select count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from (select " +
          cols +
          " from public." +
          quote(expected.table) +
          ") t",
      );
      compared.push({
        table: expected.table,
        count: row.count,
        equal: row.count === expected.count && row.digest === expected.digest,
      });
    }
    const [outbox] = await tx.unsafe(
      "select count(*)::int total,count(*) filter(where status='pending')::int pending from notification_outbox",
    );
    const [catalog] = await tx.unsafe(
      "select count(*)::int tables from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
    );
    return {
      ledgerOriginalPreserved:
        ledger.length === original.ledger.length &&
        compared.find((r) => r.table === "schema_migrations").equal,
      ledgerCount: ledger.length,
      originalLedgerCount: original.ledger.length,
      originalRows: compared,
      notificationOutbox: outbox,
      catalog,
    };
  });
  const manifest = Object.fromEntries(
    ["clone-public.dump", "original-reconciliation.sql", "local-restored-reconciliation.sql"].map(
      (name) => {
        const b = fs.readFileSync(dir + name);
        return [
          name,
          { bytes: b.length, sha256: crypto.createHash("sha256").update(b).digest("hex") },
        ];
      },
    ),
  );
  const report = {
    scope: "populated public-only local restore; no platform Auth or live dispatch",
    ...receipt,
    manifest,
  };
  fs.writeFileSync(
    process.argv[3] ?? dir + "post-reconciliation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ...report,
      originalRows: {
        tables: report.originalRows.length,
        allEqual: report.originalRows.every((r) => r.equal),
        mismatches: report.originalRows.filter((r) => !r.equal),
      },
    }),
  );
  if (!receipt.ledgerOriginalPreserved || receipt.originalRows.some((r) => !r.equal))
    process.exitCode = 1;
} finally {
  await db.end();
}
