import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { AnalysisSubject } from "./analysis-worker";
import type { Finding } from "./findings";
import type { DocumentStatus, ScanVerdictSource } from "./types";

/**
 * Reads what an analysis run needs, and writes what it concluded.
 *
 * Separate from the main document repository for the same reason `scan-jobs.ts`
 * is: this is one narrow job with its own lifecycle, and folding it into a file
 * that already serves uploads, access subjects and review would make both harder
 * to read.
 */

type QueryClient = SqlClient | postgres.TransactionSql;
type AnalysisRepositoryOptions = CreateSqlClientOptions & { sql?: QueryClient };

type SubjectRow = {
  id: string;
  document_id: string;
  version_number: number;
  declared_checksum_sha256: string | null;
  verified_checksum_sha256: string | null;
  superseded_by_version_id: string | null;
  storage_url: string;
  content_type: string | null;
  file_name: string;
  declared_byte_size: string | number | null;
  verified_byte_size: string | number | null;
  upload_status: DocumentStatus | null;
  scan_verdict_source: ScanVerdictSource | null;
  page_count: number | null;
};

type PageClaimRow = {
  requirement_instance_id: string;
  page_from: number | null;
  page_to: number | null;
};

type FindingRow = {
  document_version_id: string | null;
  requirement_instance_id: string | null;
  page_from: number | null;
  page_to: number | null;
  tier: Finding["tier"];
  rule_key: string;
  rule_version: string;
  outcome: Finding["outcome"];
  severity: Finding["severity"];
  detail: string;
};

function numberOrNull(value: string | number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapFinding(row: FindingRow): Finding {
  const citation: Finding["citation"] = row.document_version_id
    ? {
        kind: "version",
        documentVersionId: row.document_version_id,
        pageFrom: row.page_from,
        pageTo: row.page_to,
      }
    : row.requirement_instance_id
      ? { kind: "requirement", requirementInstanceId: row.requirement_instance_id }
      : { kind: "none" };

  return {
    ruleKey: row.rule_key,
    ruleVersion: row.rule_version,
    tier: row.tier,
    outcome: row.outcome,
    severity: row.severity,
    detail: row.detail,
    citation,
  };
}

export type DocumentAnalysisRepository = {
  loadForAnalysis(documentVersionId: string): Promise<AnalysisSubject | null>;
  replaceUnresolvedForVersion(input: {
    documentVersionId: string;
    analysisJobId: string;
    findings: readonly Finding[];
  }): Promise<void>;
  listFindingsForVersion(documentVersionId: string): Promise<Finding[]>;
  close(): Promise<void>;
};

export function createDocumentAnalysisRepository(
  options?: AnalysisRepositoryOptions,
): DocumentAnalysisRepository;
export function createDocumentAnalysisRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): DocumentAnalysisRepository;
export function createDocumentAnalysisRepository(
  databaseUrlOrOptions: string | AnalysisRepositoryOptions = {},
  maybeOptions: CreateSqlClientOptions = {},
): DocumentAnalysisRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    async loadForAnalysis(documentVersionId) {
      const rows = await sql<SubjectRow[]>`
        select
          v.id, v.document_id, v.version_number, v.declared_checksum_sha256,
          v.verified_checksum_sha256, v.superseded_by_version_id, v.storage_url,
          v.content_type, v.file_name, v.declared_byte_size, v.verified_byte_size,
          i.status upload_status, i.scan_verdict_source,
          t.page_count
        from document_versions v
        -- Left joins: a staff- or system-created document has no upload intent,
        -- and no version has an extracted-text row yet because nothing extracts.
        left join document_upload_intents i on i.id = v.intent_id
        left join document_version_texts t on t.document_version_id = v.id
        where v.id = ${documentVersionId}
      `;
      const row = rows[0];
      if (!row) return null;

      const claims = await sql<PageClaimRow[]>`
        select requirement_instance_id, page_from, page_to
        from requirement_evidence_links
        where document_id = ${row.document_id}
      `;

      return {
        version: {
          id: row.id,
          documentId: row.document_id,
          versionNumber: row.version_number,
          declaredChecksum: row.declared_checksum_sha256,
          verifiedChecksum: row.verified_checksum_sha256,
          supersededByVersionId: row.superseded_by_version_id,
        },
        objectKey: row.storage_url,
        declaredContentType: row.content_type,
        declaredByteSize: numberOrNull(row.declared_byte_size),
        verifiedByteSize: numberOrNull(row.verified_byte_size),
        knownPageCount: row.page_count,
        pageClaims: claims.map((claim) => ({
          requirementInstanceId: claim.requirement_instance_id,
          pageFrom: claim.page_from,
          pageTo: claim.page_to,
        })),
        // No intent means nothing ever scanned these bytes. 'created' maps to
        // `pending` safety, which is the accurate answer: not yet verified. It
        // must never fall through to a value documentSafetyOf would call
        // verified.
        uploadStatus: row.upload_status ?? "created",
        scanVerdictSource: row.scan_verdict_source,
        fileName: row.file_name,
      };
    },

    async replaceUnresolvedForVersion(input) {
      await withTransaction(sql, async (tx) => {
        // `resolved_by is null` is the whole rule. A run replaces the machine's
        // opinion of this version and never touches a finding a person has dealt
        // with -- that resolution is the record of a decision, and an automated
        // pass has no business erasing it.
        //
        // Every unresolved finding goes, not only those from the tiers that ran
        // this time. If the provider tier is disabled today, yesterday's provider
        // findings are ones the current system can no longer reproduce or stand
        // behind, and leaving them on screen would present a conclusion nothing
        // is prepared to defend.
        await tx`
          delete from document_findings
          where document_version_id = ${input.documentVersionId}
            and resolved_by is null
        `;

        for (const finding of input.findings) {
          const citation = finding.citation;
          const versionId = citation.kind === "version" ? citation.documentVersionId : null;
          const requirementId =
            citation.kind === "requirement" ? citation.requirementInstanceId : null;
          const pageFrom = citation.kind === "version" ? citation.pageFrom : null;
          const pageTo = citation.kind === "version" ? citation.pageTo : null;

          await tx`
            insert into document_findings (
              document_version_id, requirement_instance_id, page_from, page_to,
              tier, rule_key, rule_version, outcome, severity, detail, analysis_job_id
            ) values (
              ${versionId}, ${requirementId}, ${pageFrom}, ${pageTo},
              ${finding.tier}, ${finding.ruleKey}, ${finding.ruleVersion},
              ${finding.outcome}, ${finding.severity}, ${finding.detail}, ${input.analysisJobId}
            )
          `;
        }
      });
    },

    async listFindingsForVersion(documentVersionId) {
      const rows = await sql<FindingRow[]>`
        select document_version_id, requirement_instance_id, page_from, page_to,
          tier, rule_key, rule_version, outcome, severity, detail
        from document_findings
        where document_version_id = ${documentVersionId}
        order by created_at asc
      `;
      return rows.map(mapFinding);
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}

function withTransaction<T>(
  client: QueryClient,
  callback: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return "begin" in client
    ? (client.begin(callback) as Promise<T>)
    : callback(client as postgres.TransactionSql);
}
