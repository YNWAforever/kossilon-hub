import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { AnalysisRunMetadata, AnalysisSubject } from "./analysis-worker";
import {
  buildAnalysisContext,
  CONTEXT_RULE_SET_VERSION,
  type AnalysisContextInput,
} from "./analysis-context";
import type { Finding, PersistedFinding } from "./findings";
import { analysisStateFrom, viewFor, type DocumentFindingsView } from "./findings-review";
import type { StoredExtraction } from "./text-extraction";
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

type ContextRow = {
  case_id: string;
  company_id: string;
  company_name: string;
  cr_number: string;
  return_year: number;
  verified_checksum_sha256: string;
  party_snapshot: { id: string; name: string }[];
  requirement_snapshot: { id: string; label: string }[];
};

type PageClaimRow = {
  requirement_instance_id: string;
  page_from: number | null;
  page_to: number | null;
};

type PersistedRow = {
  id: string;
  resolved_by: string | null;
  resolved_at: string | Date | null;
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
  evidence_quote: string | null;
  evidence_confidence: string | number | null;
  evidence_extraction_method: "text-layer" | "ocr" | null;
  evidence_bbox: [number, number, number, number] | null;
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
    ...(row.evidence_quote &&
    row.document_version_id &&
    row.page_from &&
    row.evidence_extraction_method &&
    row.evidence_confidence !== null
      ? {
          evidence: {
            sourceVersionId: row.document_version_id,
            page: row.page_from,
            quote: row.evidence_quote,
            confidence: Number(row.evidence_confidence),
            extractionMethod: row.evidence_extraction_method,
            bbox: row.evidence_bbox,
          },
        }
      : {}),
  };
}

export type DocumentAnalysisRepository = {
  loadForAnalysis(documentVersionId: string): Promise<AnalysisSubject | null>;
  loadAnalysisContextInput(documentVersionId: string): Promise<AnalysisContextInput | null>;
  replaceUnresolvedForVersion(input: {
    documentVersionId: string;
    analysisJobId: string;
    findings: readonly Finding[];
    runMetadata?: AnalysisRunMetadata;
  }): Promise<void>;
  /**
   * Records what extraction found for this version, replacing any earlier run.
   *
   * Its own table, never the version row: a pass that could write the version
   * row could write its storage key or checksum with it (see migration 0027).
   */
  upsertText(documentVersionId: string, extraction: StoredExtraction): Promise<void>;
  listFindingsForVersion(documentVersionId: string): Promise<Finding[]>;
  /** Every current version on a case, with its findings and its run state. */
  listFindingsForCase(caseId: string): Promise<DocumentFindingsView[]>;
  /**
   * A person deals with a finding.
   *
   * `resolved_by is null` in the predicate makes it first-writer-wins rather
   * than last: one reviewer's decision is never silently replaced by another's,
   * and a double click records one resolution rather than two.
   */
  resolveFinding(input: {
    findingId: string;
    /**
     * Scopes the write, and is the authorization rather than a hint. A caller
     * that checked "may this actor see case X" and then updated by finding id
     * alone could be handed a visible caseId paired with a finding from a case
     * the actor cannot see. Joining the case into the UPDATE keeps the check and
     * the write in one statement, so nothing can slip between them.
     */
    caseId: string;
    resolvedByUserId: string;
    note: string | null;
  }): Promise<boolean>;
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
        -- and a version nobody has extracted yet has no text row.
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

    async loadAnalysisContextInput(documentVersionId) {
      // One statement gives a consistent server-side snapshot. No fact is taken
      // from the uploaded file or caller-provided metadata.
      const rows = await sql<ContextRow[]>`
        select c.id case_id, co.id company_id, co.company_name, co.cr_number,
          c.return_year, v.verified_checksum_sha256,
          coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.id)
            from case_parties p where p.case_id = c.id and p.active
          ), '[]'::jsonb) party_snapshot,
          coalesce((
            select jsonb_agg(jsonb_build_object('id', r.id, 'label', i.item_label) order by r.id)
            from case_requirement_instances r
            join annual_return_checklist_items i on i.id = r.checklist_item_id
            where r.case_id = c.id
          ), '[]'::jsonb) requirement_snapshot
        from document_versions v
        join documents d on d.id = v.document_id
        join annual_return_cases c on c.id = d.case_id and c.company_id = d.company_id
        join companies co on co.id = c.company_id
        where v.id = ${documentVersionId}
          and v.verified_checksum_sha256 is not null
          and v.superseded_by_version_id is null
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        caseId: row.case_id,
        company: { id: row.company_id, name: row.company_name, crNumber: row.cr_number },
        returnYear: row.return_year,
        partySnapshot: row.party_snapshot,
        requirementSnapshot: row.requirement_snapshot,
        documentVersionId,
        contentSha256: row.verified_checksum_sha256,
        ruleSetVersion: CONTEXT_RULE_SET_VERSION,
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
              tier, rule_key, rule_version, outcome, severity, detail, analysis_job_id,
              evidence_quote, evidence_confidence, evidence_extraction_method, evidence_bbox
            ) values (
              ${versionId}, ${requirementId}, ${pageFrom}, ${pageTo},
              ${finding.tier}, ${finding.ruleKey}, ${finding.ruleVersion},
              ${finding.outcome}, ${finding.severity}, ${finding.detail}, ${input.analysisJobId},
              ${finding.evidence?.quote ?? null}, ${finding.evidence?.confidence ?? null},
              ${finding.evidence?.extractionMethod ?? null},
              ${finding.evidence?.bbox ? JSON.stringify(finding.evidence.bbox) : null}::jsonb
            )
          `;
        }
        if (input.runMetadata) {
          const run = input.runMetadata;
          await tx`
            insert into document_analysis_run_metadata (
              analysis_job_id, document_version_id, context_hash, rule_set_version,
              extraction_method, model_version, prompt_version, cost_minor, latency_ms
            ) values (
              ${input.analysisJobId}, ${input.documentVersionId}, ${run.contextHash},
              ${run.ruleSetVersion}, ${run.extractionMethod}, ${run.modelVersion},
              ${run.promptVersion}, ${run.costMinor}, ${run.latencyMs}
            )
            on conflict (analysis_job_id) do update set
              context_hash = excluded.context_hash,
              rule_set_version = excluded.rule_set_version,
              extraction_method = excluded.extraction_method,
              model_version = excluded.model_version,
              prompt_version = excluded.prompt_version,
              cost_minor = excluded.cost_minor,
              latency_ms = excluded.latency_ms
          `;
        }
      });
    },

    async upsertText(documentVersionId, extraction) {
      const text = extraction.method === "text-layer" ? extraction.text : null;
      const truncated = extraction.method === "text-layer" ? extraction.truncated : false;
      await sql`
        insert into document_version_texts (
          document_version_id, extracted_text, page_count, extraction_method,
          truncated, extractor_version, extracted_at
        ) values (
          ${documentVersionId}, ${text}, ${extraction.pageCount}, ${extraction.method},
          ${truncated}, ${extraction.extractorVersion}, now()
        )
        on conflict (document_version_id) do update set
          extracted_text = excluded.extracted_text,
          page_count = excluded.page_count,
          extraction_method = excluded.extraction_method,
          truncated = excluded.truncated,
          extractor_version = excluded.extractor_version,
          extracted_at = excluded.extracted_at
      `;
    },

    async listFindingsForVersion(documentVersionId) {
      const rows = await sql<FindingRow[]>`
        select document_version_id, requirement_instance_id, page_from, page_to,
          tier, rule_key, rule_version, outcome, severity, detail,
          evidence_quote, evidence_confidence, evidence_extraction_method, evidence_bbox
        from document_findings
        where document_version_id = ${documentVersionId}
        order by created_at asc
      `;
      return rows.map(mapFinding);
    },

    async listFindingsForCase(caseId) {
      const versions = await sql<
        {
          document_id: string;
          document_version_id: string;
          file_name: string;
          job_status: "pending" | "processing" | "succeeded" | "failed" | "cancelled" | null;
          job_error_code: string | null;
          context_hash: string | null;
        }[]
      >`
        select
          d.id document_id, v.id document_version_id, v.file_name,
          j.status job_status, j.last_error_code job_error_code,
          m.context_hash
        from documents d
        -- The current version only. A superseded one is not what a reviewer is
        -- deciding about, and showing its findings beside the live ones would
        -- invite approving bytes the client has already replaced.
        join document_versions v
          on v.document_id = d.id and v.superseded_by_version_id is null
        -- The most recent run. Left, because a version with no job at all is a
        -- real state the view has to be able to report.
        left join lateral (
          select id, status, last_error_code
          from document_analysis_jobs
          where document_version_id = v.id
          order by created_at desc
          limit 1
        ) j on true
        left join document_analysis_run_metadata m on m.analysis_job_id = j.id
        where d.case_id = ${caseId}
        order by d.uploaded_at desc
      `;
      if (versions.length === 0) return [];

      const versionIds = versions.map((row) => row.document_version_id);
      const rows = await sql<(FindingRow & PersistedRow)[]>`
        select id, document_version_id, requirement_instance_id, page_from, page_to,
          tier, rule_key, rule_version, outcome, severity, detail, resolved_by, resolved_at,
          evidence_quote, evidence_confidence, evidence_extraction_method, evidence_bbox
        from document_findings
        where document_version_id = any(${versionIds}::uuid[])
      `;

      const byVersion = new Map<string, PersistedFinding[]>();
      for (const row of rows) {
        if (!row.document_version_id) continue;
        const bucket = byVersion.get(row.document_version_id) ?? [];
        bucket.push({
          id: row.id,
          finding: mapFinding(row),
          resolvedByUserId: row.resolved_by,
          resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
        });
        byVersion.set(row.document_version_id, bucket);
      }

      return Promise.all(
        versions.map(async (row) => {
          let state = analysisStateFrom(
            row.job_status === null
              ? null
              : { status: row.job_status, lastErrorCode: row.job_error_code },
          );
          if (state === "analysed" && !row.context_hash) state = "stale";
          if (state === "analysed" && row.context_hash) {
            try {
              const currentInput = await this.loadAnalysisContextInput(row.document_version_id);
              const current = currentInput ? await buildAnalysisContext(currentInput) : null;
              if (!current || current.contextHash !== row.context_hash) state = "stale";
            } catch {
              state = "stale";
            }
          }
          return viewFor({
            documentId: row.document_id,
            documentVersionId: row.document_version_id,
            fileName: row.file_name,
            state,
            findings: byVersion.get(row.document_version_id) ?? [],
          });
        }),
      );
    },

    async resolveFinding(input) {
      const rows = await sql<{ id: string }[]>`
        update document_findings f
        set resolved_by = ${input.resolvedByUserId}, resolved_at = now(),
          resolution_note = ${input.note}
        from document_versions v
        join documents d on d.id = v.document_id
        where f.id = ${input.findingId}
          and f.resolved_by is null
          and v.id = f.document_version_id
          and d.case_id = ${input.caseId}
        returning f.id
      `;
      return rows.length === 1;
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
