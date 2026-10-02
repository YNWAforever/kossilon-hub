import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

type Query = postgres.Sql | postgres.TransactionSql;
type LineageRow = {
  document_id: string;
  company_id: string;
  case_id: string | null;
  current_version_id: string | null;
  intent_id: string | null;
  object_key: string;
  intent_matches: boolean;
  upload_status: string | null;
  scan_verdict_source: string | null;
  checksum_sha256: string | null;
  verified_checksum_sha256: string | null;
  expected_size_bytes: number | string | null;
  content_type: string | null;
};
export type ObjectObservation = {
  state: "present" | "missing" | "unknown";
  checksum?: string;
  sizeBytes?: number;
  contentType?: string;
};

/** Read-only inventory. A probe must distinguish absent objects from denied/invalid metadata. */
export async function auditDocumentLineage(
  sql: Query,
  options: {
    probeObject?: (objectKey: string) => Promise<ObjectObservation>;
  } = {},
) {
  const [counts] = await sql<{ total: number }[]>`select count(*)::int total from documents`;
  const rows = await sql<LineageRow[]>`
    select d.id document_id, d.company_id, d.case_id, v.id current_version_id,
      i.id intent_id, d.storage_url object_key, i.status upload_status, i.scan_verdict_source,
      i.checksum_sha256, v.verified_checksum_sha256, i.expected_size_bytes, i.content_type,
      coalesce(i.document_id=d.id and i.company_id=d.company_id
        and i.case_id is not distinct from d.case_id and i.object_key=v.storage_url
        and v.storage_url=d.storage_url, false) intent_matches
    from documents d
    left join lateral (select * from document_versions where document_id=d.id
      and superseded_by_version_id is null order by version_number desc limit 1) v on true
    left join document_upload_intents i on i.id=v.intent_id
    order by d.id limit 500`;
  const entries = [];
  for (const row of rows) {
    let object: ObjectObservation | { state: "not_checked" } = { state: "not_checked" };
    if (options.probeObject) {
      try {
        object = await options.probeObject(row.object_key);
      } catch {
        object = { state: "unknown" };
      }
    }
    const complete = Boolean(row.current_version_id && row.intent_id && row.intent_matches);
    const clean =
      complete &&
      row.upload_status === "available" &&
      row.scan_verdict_source === "provider" &&
      Boolean(row.checksum_sha256) &&
      row.verified_checksum_sha256 === row.checksum_sha256;
    const matchingObject =
      object.state === "present" &&
      object.checksum === row.checksum_sha256 &&
      object.sizeBytes === Number(row.expected_size_bytes) &&
      object.contentType === row.content_type;
    const availability = !complete
      ? "metadata_only"
      : row.upload_status === "rejected"
        ? "unsafe"
        : object.state === "missing"
          ? "missing_object"
          : row.upload_status !== "available"
            ? "quarantined"
            : clean && matchingObject
              ? "available"
              : "unscanned";
    entries.push({
      documentId: row.document_id,
      companyId: row.company_id,
      caseId: row.case_id,
      currentVersionId: row.current_version_id,
      intentId: row.intent_id,
      availability,
      objectState: object.state,
      verifiedEvidence: availability === "available",
    });
  }
  return {
    totalDocuments: counts.total,
    truncated: counts.total > rows.length,
    entries,
    mutationsPerformed: false,
    byteReadsPerformed: false,
    scope: "DB lineage and optional object metadata only; no business approval or scan is inferred",
    nextAction:
      "Review each mismatch; preview and approve a versioned additive re-upload. Storage access failures remain unknown.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for read-only document inventory");
  const ssl = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "require").toLowerCase();
  const sql = postgres(url, {
    max: 1,
    ssl: ["disable", "disabled", "false", "off", "0", "no"].includes(ssl) ? false : "require",
    onnotice: () => undefined,
  });
  try {
    console.log(
      JSON.stringify(await sql.begin("read only", (tx) => auditDocumentLineage(tx)), null, 2),
    );
  } catch {
    console.error("Document lineage inventory unavailable. No records or objects changed.");
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
