import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { verifyCosecDelivery, type DeliveryRecordType } from "./cosec-delivery.ts";

// Raw original CSV digests from the supplied authenticated audit, not generated results.
const originals: [DeliveryRecordType, string, string, string][] = [
  [
    "F",
    "Kossilon_Findings_35_Updated_2026-10-23.csv",
    "finding_id",
    "bd7663aaf7b95302241f106c56f6cb44e3e42e5b69049b69bbc8ee8f6249c247",
  ],
  [
    "R",
    "Kossilon_Remediation_Tasks_15_Updated_2026-10-23.csv",
    "task_id",
    "9fdb5cbb515ebfa5220a10e55f0db1a975e7450d8752269fa288b922adfe91a8",
  ],
  [
    "UC",
    "Kossilon_Test_Cases_100_With_Followup_2026-10-23.csv",
    "case_id",
    "4bfe0a2e5e0e0f180ba542f05b901f3f973288119952dd89e76cfbe5bc2d3526",
  ],
  [
    "LA",
    "Kossilon_Live_Assertions_34_2026-10-23.csv",
    "assertion_id",
    "5597705ff8f3a011d3aecba21a609a69111c3bc0d0b7f2f870e7cc3ded55f4ce",
  ],
];

const [runDirectory, expectedSourceSha] = process.argv.slice(2);
if (!runDirectory || !expectedSourceSha || process.argv.length !== 4)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/verify-cosec-delivery.ts <run-directory> <inspected-source-SHA>",
  );
const root = realpathSync(resolve(runDirectory));
const candidate = JSON.parse(readFileSync(join(root, "release-candidate.json"), "utf8"));
const result = verifyCosecDelivery({
  csv: readFileSync(join(root, "acceptance-results.csv"), "utf8"),
  candidate,
  expectedSourceSha,
  runId: "cosec-20261023-79d324f0",
  sources: originals.map(([recordType, fileName, idColumn, sha256]) => ({
    recordType,
    fileName,
    idColumn,
    sha256,
    text: readFileSync(join(root, "source-inputs", fileName), "utf8"),
  })),
  evidenceExists(path) {
    try {
      const target = realpathSync(join(root, path));
      const within = relative(root, target);
      return (
        within !== ".." &&
        !within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
        !isAbsolute(within) &&
        statSync(target).isFile()
      );
    } catch {
      return false;
    }
  },
});
console.log(
  JSON.stringify(
    {
      ...result,
      source_sha: expectedSourceSha,
      authority:
        "Offline local delivery integrity only; no deployment, DB, provider or native acceptance authority.",
    },
    null,
    2,
  ),
);
