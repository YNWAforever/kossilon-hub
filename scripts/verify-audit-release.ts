import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifyAuditUatLedger, type UatBaseline } from "./audit-uat-ledger.ts";

// Read-only packaging: no dotenv, DB client, credential access or provider calls.
const baseline: UatBaseline = JSON.parse(
  await readFile("docs/audit-remediation/uat-original-2026-10-01.json", "utf8"),
);
const uat = verifyAuditUatLedger(
  await readFile("docs/audit-remediation/uat-results.csv", "utf8"),
  baseline,
);
const manifest = [];
for (const file of (await readdir("db/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const body = await readFile(`db/migrations/${file}`);
  manifest.push({
    file,
    sha256: createHash("sha256").update(body).digest("hex"),
    candidate: Number(file.slice(0, 4)) >= 67,
  });
}
console.log(
  JSON.stringify(
    {
      localLedgerContract: "PASS",
      productionReleaseGate: "NO_GO",
      authority:
        "This read-only report grants no migration, deployment, send or invitation authority.",
      uat,
      sourceMigrationCount: manifest.length,
      productionLastObservedHistoricalCount: 66,
      historyReconciliation:
        "BLOCKED: physical DDL and historical IDs differ; do not replay this manifest or fabricate ledger IDs.",
      manifest,
    },
    null,
    2,
  ),
);
