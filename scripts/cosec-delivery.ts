import { createHash } from "node:crypto";
import { parseAuditCsv } from "./audit-uat-ledger.ts";

export type DeliveryRecordType = "F" | "R" | "UC" | "LA";
export type DeliverySource = {
  recordType: DeliveryRecordType;
  fileName: string;
  idColumn: string;
  text: string;
  sha256: string;
};

const COUNTS = { F: 35, R: 15, UC: 100, LA: 34 } as const;
const REQUIRED_COLUMNS = [
  "record_type",
  "id",
  "source_file",
  "original_row_json",
  "local_result",
  "local_scope",
  "evidence_paths",
  "native_result",
  "remaining_scope",
];

function records(csv: string) {
  const [header, ...rows] = parseAuditCsv(csv.replace(/^\uFEFF/, ""));
  if (!header || new Set(header).size !== header.length) throw new Error("Invalid CSV columns.");
  return {
    header,
    rows: rows.map((row) => {
      if (row.length !== header.length) throw new Error("Malformed CSV row.");
      return Object.fromEntries(header.map((key, index) => [key, row[index]]));
    }),
  };
}

function unchangedOriginal(value: unknown, original: Record<string, string>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(original).length &&
    Object.entries(original).every(([key, field]) => actual[key] === field)
  );
}

/** Offline packaging only. This run has no authority or evidence for native acceptance. */
export function verifyCosecDelivery(input: {
  csv: string;
  sources: DeliverySource[];
  candidate: Record<string, unknown>;
  expectedSourceSha: string;
  runId: string;
  evidenceExists: (relativePath: string) => boolean;
}) {
  if (
    !/^[a-f0-9]{40}$/.test(input.expectedSourceSha) ||
    input.candidate.source_sha !== input.expectedSourceSha
  )
    throw new Error("Candidate source SHA does not match the inspected commit.");
  if (input.candidate.run_id !== input.runId) throw new Error("Candidate run mismatch.");
  if (input.candidate.release_gate !== "NO_GO")
    throw new Error("Local delivery must retain NO_GO.");
  if (input.candidate.auth_runtime_verified !== false)
    throw new Error("No native Auth acceptance exists for this run.");
  if (!/^[a-f0-9]{40}$/.test(String(input.candidate.base_sha)))
    throw new Error("Invalid base SHA.");

  const originals = new Map<string, { source: DeliverySource; row: Record<string, string> }>();
  const sourceTypes = new Set<string>();
  for (const source of input.sources) {
    if (sourceTypes.has(source.recordType)) throw new Error("Duplicate original source.");
    sourceTypes.add(source.recordType);
    if (createHash("sha256").update(source.text).digest("hex") !== source.sha256.toLowerCase())
      throw new Error(`Original input checksum mismatch: ${source.fileName}.`);
    const original = records(source.text);
    if (
      !original.header.includes(source.idColumn) ||
      original.rows.length !== COUNTS[source.recordType]
    )
      throw new Error(`Wrong original count/ID column: ${source.recordType}.`);
    for (const row of original.rows) {
      const id = row[source.idColumn];
      const key = `${source.recordType}:${id}`;
      if (!id || originals.has(key)) throw new Error(`Duplicate original ID: ${key}.`);
      originals.set(key, { source, row });
    }
  }
  if (originals.size !== 184 || sourceTypes.size !== 4)
    throw new Error("All 184 original records are required.");
  const ledger = records(input.csv);
  if (REQUIRED_COLUMNS.some((column) => !ledger.header.includes(column)))
    throw new Error("Missing delivery column.");
  if (ledger.rows.length !== 184) throw new Error("Exactly 184 delivery rows required.");
  const seen = new Set<string>();
  for (const row of ledger.rows) {
    const key = `${row.record_type}:${row.id}`;
    if (seen.has(key)) throw new Error(`Duplicate delivery ID: ${key}.`);
    seen.add(key);
    const original = originals.get(key);
    if (!original || row.source_file !== original.source.fileName)
      throw new Error(`Unknown original record: ${key}.`);
    let saved: unknown;
    try {
      saved = JSON.parse(row.original_row_json);
    } catch {
      throw new Error(`Malformed original row: ${key}.`);
    }
    if (!unchangedOriginal(saved, original.row))
      throw new Error(`Changed original evidence: ${key}.`);
    if (!["BLOCKED", "NOT_RUN"].includes(row.native_result))
      throw new Error(`No native pass may be claimed: ${key}.`);
    if (!row.local_result?.trim() || !row.local_scope?.trim() || !row.remaining_scope?.trim())
      throw new Error(`Missing local/remaining scope: ${key}.`);
    const evidence = row.evidence_paths
      .split(";")
      .map((path) => path.trim())
      .filter(Boolean);
    if (!evidence.length) throw new Error(`Missing evidence: ${key}.`);
    for (const path of evidence) {
      if (
        /^[\\/]|:/.test(path) ||
        [...path].some((character) => character.charCodeAt(0) < 32) ||
        path.split(/[\\/]/).includes("..")
      )
        throw new Error(`Unsafe evidence path: ${key}.`);
      if (!input.evidenceExists(path)) throw new Error(`Missing evidence file: ${path}.`);
    }
  }
  return { original: { ...COUNTS }, rows: seen.size, nativePasses: 0, releaseGate: "NO_GO" };
}
