import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { AnalysisPublicationInput, AnalysisSubject } from "./analysis-worker";
import type { AnalysisFieldExpectation } from "./analysis-checks";
import { isBoundEvidence, spanMatchesEvidence } from "./evidence-contract";
import { assertStaffDocumentAccess, isDocumentVisibleToStaffActor } from "./authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createDocumentRepository } from "./repository";
import { groundProviderFindings } from "./ai-provider";
import type { AnalysisProvenance, Finding, PersistedFinding } from "./findings";
import { analysisStateFrom, viewFor, type DocumentFindingsView } from "./findings-review";
import type { ExtractedEvidence, StoredExtraction } from "./text-extraction";
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
  scan_document_version_id: string | null;
  intent_checksum: string | null;
  page_count: number | null;
  company_name: string;
  context_version: string;
  requirements: RequirementFact[];
  lineage_verified: boolean;
};

type RequirementFact = {
  id: string;
  requirement_key: string;
  party_id: string | null;
  applicability: "required" | "not_applicable" | "waived";
  authorized_by: string | null;
  reference_date: string | null;
  party_name: string | null;
  party_confirmed: boolean;
  return_year: number;
  page_from: number | null;
  page_to: number | null;
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
  evidence: Finding["evidence"] | null;
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
    ...(row.evidence ? { evidence: row.evidence } : {}),
  };
}

export type DocumentAnalysisRepository = {
  loadForAnalysis(documentVersionId: string): Promise<AnalysisSubject | null>;
  publishAnalysis(input: AnalysisPublicationInput): Promise<boolean>;
  replaceUnresolvedForVersion(input: {
    documentVersionId: string;
    analysisJobId: string;
    findings: readonly Finding[];
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
  listFindingsForCase(caseId: string, actor: AuthenticatedActor): Promise<DocumentFindingsView[]>;
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
    resolvedByAuthUserId?: string;
    expectedDocumentVersionId: string;
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

  const repository: DocumentAnalysisRepository = {
    async loadForAnalysis(documentVersionId) {
      const rows = await sql<SubjectRow[]>`
        select
          v.id, v.document_id, v.version_number, v.declared_checksum_sha256,
          v.verified_checksum_sha256, v.superseded_by_version_id, v.storage_url,
          v.content_type, v.file_name, v.declared_byte_size, v.verified_byte_size,
          i.status upload_status, i.scan_verdict_source, i.scan_document_version_id,i.checksum_sha256 intent_checksum,
          t.page_count, c.company_name,
          coalesce(i.document_id=d.id and i.company_id=d.company_id and i.case_id is not distinct from d.case_id
            and i.object_key=v.storage_url and i.content_type=v.content_type
            and i.expected_size_bytes=v.declared_byte_size and v.verified_byte_size=v.declared_byte_size
            and i.checksum_sha256=v.declared_checksum_sha256 and v.declared_checksum_sha256=v.verified_checksum_sha256
            and (d.case_id is null or a.id is not null),false) lineage_verified,
          coalesce(facts.requirements, '[]'::jsonb) requirements,
          md5(jsonb_build_array(to_jsonb(c), to_jsonb(a), d.company_id,d.case_id,coalesce(facts.requirements,'[]'::jsonb))::text) context_version
        from document_versions v
        join documents d on d.id=v.document_id
        join companies c on c.id=d.company_id
        left join annual_return_cases a on a.id=d.case_id and a.company_id=c.id
        -- Left joins: a staff- or system-created document has no upload intent,
        -- and a version nobody has extracted yet has no text row.
        left join document_upload_intents i on i.id = v.intent_id
        left join document_version_texts t on t.document_version_id = v.id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'id', r.id, 'requirement_key',r.requirement_key,'party_id',r.party_id,'applicability',r.applicability,
            'authorized_by',r.authorized_by,'reference_date',r.reference_date,'party_name',p.display_name,
            'party_confirmed',coalesce(p.active and p.confirmed_at is not null and p.confirmed_by is not null,false),
            'return_year',ca.return_year,'page_from',l.page_from,'page_to',l.page_to,
            'source',jsonb_build_array(to_jsonb(l),to_jsonb(r),to_jsonb(p),to_jsonb(ca))) order by l.id) requirements
          from requirement_evidence_links l join case_requirement_instances r on r.id=l.requirement_instance_id
          join annual_return_cases ca on ca.id=r.case_id and ca.company_id=d.company_id
          left join case_parties p on p.id=r.party_id and p.case_id=ca.id
          where l.document_id=d.id and (d.case_id is null or d.case_id=ca.id)
        ) facts on true
        where v.id = ${documentVersionId}
      `;
      const row = rows[0];
      if (!row) return null;

      const claims: PageClaimRow[] = row.requirements.map((r) => ({
        requirement_instance_id: r.id,
        page_from: r.page_from,
        page_to: r.page_to,
      }));
      const expectations: AnalysisFieldExpectation[] = row.requirements.flatMap((r) => {
        const common = {
          partyId: r.party_id,
          requirementInstanceId: r.id,
          applicability: r.party_id && !r.party_confirmed ? ("unknown" as const) : r.applicability,
          authorised: r.authorized_by !== null,
        };
        const fields: AnalysisFieldExpectation[] = [
          {
            ...common,
            field: "party_name",
            expected: r.party_id ? (r.party_confirmed ? r.party_name : null) : row.company_name,
          },
        ];
        if (/^(?:nar1|signed_nar1|signed-nar1)$/i.test(r.requirement_key))
          fields.push({ ...common, field: "return_year", expected: String(r.return_year) });
        if (r.reference_date)
          fields.push({
            ...common,
            field: "document_date",
            expected: null,
            referenceDate: r.reference_date,
            maxAgeDays: null,
          });
        return fields;
      });

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
        scanVerdictSource:
          row.lineage_verified &&
          row.scan_document_version_id === row.id &&
          row.intent_checksum === row.verified_checksum_sha256
            ? row.scan_verdict_source
            : null,
        fileName: row.file_name,
        expectations,
        contextVersion: row.context_version,
      };
    },

    async publishAnalysis(input) {
      if (
        !isBoundEvidence(input.evidence) ||
        input.evidence.documentVersionId !== input.documentVersionId ||
        input.evidence.sha256 !== input.sha256 ||
        !input.contextVersion
      )
        throw new Error("Analysis must carry bound version, SHA, pages and context.");
      for (const finding of input.findings) {
        if (
          finding.citation.kind !== "version" ||
          finding.citation.documentVersionId !== input.documentVersionId ||
          (finding.evidence &&
            (finding.evidence.sha256 !== input.sha256 ||
              finding.evidence.spans.some((span) => !spanMatchesEvidence(input.evidence, span))))
        )
          throw new Error("Analysis finding has an unbound citation.");
        // An uncertain provider note describes a skipped/failed call and has no
        // invented page. Every provider observation must carry grounded spans.
        if (
          finding.tier === "provider" &&
          (finding.outcome !== "uncertain" || finding.citation.pageFrom !== null) &&
          !groundProviderFindings(input.evidence, [finding])
        )
          throw new Error("Provider observation has no grounded citation.");
      }
      if (
        input.extraction?.evidence &&
        JSON.stringify(input.extraction.evidence) !== JSON.stringify(input.evidence)
      )
        throw new Error("Extraction evidence differs from publication.");
      return withTransaction(sql, async (tx) => {
        const [initial] = await tx<
          {
            document_id: string;
            intent_id: string | null;
            company_id: string;
            case_id: string | null;
          }[]
        >`
          select v.document_id,v.intent_id,d.company_id,d.case_id from document_versions v join documents d on d.id=v.document_id where v.id=${input.documentVersionId}`;
        if (!initial) return false;
        await tx`select id from companies where id=${initial.company_id} for update`;
        await tx`select id from annual_return_cases where id=${initial.case_id} or id in
          (select r.case_id from case_requirement_instances r join requirement_evidence_links l on l.requirement_instance_id=r.id where l.document_id=${initial.document_id}) order by id for update`;
        await tx`select id from documents where id=${initial.document_id} for update`;
        await tx`select id from document_upload_intents where id=${initial.intent_id} for update`;
        await tx`select id from document_versions where id=${input.documentVersionId} for update`;
        await tx`select r.id from case_requirement_instances r join requirement_evidence_links l on l.requirement_instance_id=r.id where l.document_id=${initial.document_id} order by r.id for share of r,l`;
        await tx`select p.id from case_parties p join case_requirement_instances r on r.party_id=p.id join requirement_evidence_links l on l.requirement_instance_id=r.id where l.document_id=${initial.document_id} order by p.id for share of p`;
        const [job] = await tx<
          { id: string }[]
        >`select id from document_analysis_jobs where id=${input.analysisJobId} and document_version_id=${input.documentVersionId} and status='processing' and attempt_count=${input.attemptCount} for update`;
        if (!job) return false;
        const local = createDocumentAnalysisRepository({ sql: tx });
        const current = await local.loadForAnalysis(input.documentVersionId);
        if (
          !current ||
          current.version.supersededByVersionId !== null ||
          current.version.verifiedChecksum !== input.sha256 ||
          current.version.declaredChecksum !== input.sha256 ||
          current.uploadStatus !== "available" ||
          current.scanVerdictSource !== "provider" ||
          current.contextVersion !== input.contextVersion
        )
          return false;
        for (const finding of input.findings) {
          const requirementId = finding.evidence?.requirementInstanceId;
          if (
            requirementId &&
            !current.pageClaims.some((claim) => claim.requirementInstanceId === requirementId)
          )
            throw new Error("Finding names an unrelated requirement.");
          if (
            finding.evidence?.partyId &&
            !current.expectations?.some(
              (expectation) =>
                expectation.requirementInstanceId === requirementId &&
                expectation.partyId === finding.evidence!.partyId,
            )
          )
            throw new Error("Finding names an unrelated party.");
        }
        if (input.extraction)
          await local.upsertText(input.documentVersionId, {
            ...input.extraction,
            evidence: input.evidence,
          });
        await local.replaceUnresolvedForVersion(input);
        await tx`update document_analysis_jobs set status='succeeded',completed_at=now(),updated_at=now(),last_error_code=null,last_error_message=null,provenance=${tx.json(input.provenance as postgres.JSONValue)} where id=${job.id}`;
        return true;
      });
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
              tier, rule_key, rule_version, outcome, severity, detail, analysis_job_id, evidence
            ) values (
              ${versionId}, ${requirementId}, ${pageFrom}, ${pageTo},
              ${finding.tier}, ${finding.ruleKey}, ${finding.ruleVersion},
              ${finding.outcome}, ${finding.severity}, ${finding.detail}, ${input.analysisJobId}, ${finding.evidence ? tx.json(finding.evidence) : null}
            )
          `;
        }
      });
    },

    async upsertText(documentVersionId, extraction) {
      const method =
        extraction.evidence?.method === "manual"
          ? "none"
          : (extraction.evidence?.method ?? extraction.method);
      const text =
        extraction.evidence && method !== "none"
          ? extraction.evidence.pages
              .map((page) => page.text)
              .join("\n")
              .slice(0, 200_000)
          : extraction.method === "text-layer" && !extraction.evidence
            ? extraction.text
            : null;
      const truncated = extraction.method === "text-layer" ? extraction.truncated : false;
      await sql`
        insert into document_version_texts (
          document_version_id, extracted_text, page_count, extraction_method,
          truncated, extractor_version, extracted_at, evidence
        ) values (
          ${documentVersionId}, ${text}, ${extraction.evidence?.pageCount ?? extraction.pageCount}, ${method},
          ${truncated}, ${extraction.extractorVersion}, now(), ${extraction.evidence ? sql.json(extraction.evidence) : null}
        )
        on conflict (document_version_id) do update set
          extracted_text = excluded.extracted_text,
          page_count = excluded.page_count,
          extraction_method = excluded.extraction_method,
          truncated = excluded.truncated,
          extractor_version = excluded.extractor_version,
          extracted_at = excluded.extracted_at,
          evidence = excluded.evidence
      `;
    },

    async listFindingsForVersion(documentVersionId) {
      const rows = await sql<FindingRow[]>`
        select document_version_id, requirement_instance_id, page_from, page_to,
          tier, rule_key, rule_version, outcome, severity, detail, evidence
        from document_findings
        where document_version_id = ${documentVersionId}
        order by created_at asc
      `;
      return rows.map(mapFinding);
    },

    async listFindingsForCase(caseId, actor) {
      const candidates = await sql<
        {
          document_id: string;
          document_version_id: string;
          file_name: string;
          job_status: "pending" | "processing" | "succeeded" | "failed" | "cancelled" | null;
          job_error_code: string | null;
          provenance: AnalysisProvenance | null;
          evidence: ExtractedEvidence | null;
          upload_status: DocumentStatus | null;
          scan_verdict_source: ScanVerdictSource | null;
          safe_source: boolean;
          company_id: string;
          company_team_id: string | null;
          case_id: string | null;
          case_owner_id: string | null;
          case_reviewer_id: string | null;
        }[]
      >`
        select
          d.id document_id, v.id document_version_id, v.file_name,
          d.company_id,c.assigned_team_id company_team_id,d.case_id,
          a.owner_id case_owner_id,a.reviewer_id case_reviewer_id,
          j.status job_status, j.last_error_code job_error_code,j.provenance,t.evidence,
          i.status upload_status,i.scan_verdict_source,
          coalesce(i.scan_document_version_id=v.id and i.document_id=d.id and i.company_id=d.company_id
            and i.case_id is not distinct from d.case_id and i.object_key=v.storage_url
            and i.content_type=v.content_type and i.expected_size_bytes=v.verified_byte_size
            and i.checksum_sha256=v.verified_checksum_sha256 and v.declared_checksum_sha256=v.verified_checksum_sha256,false) safe_source
        from documents d
        join companies c on c.id=d.company_id
        left join annual_return_cases a on a.id=d.case_id and a.company_id=d.company_id
        -- The current version only. A superseded one is not what a reviewer is
        -- deciding about, and showing its findings beside the live ones would
        -- invite approving bytes the client has already replaced.
        join document_versions v
          on v.document_id = d.id and v.superseded_by_version_id is null
        left join document_upload_intents i on i.id=v.intent_id
        left join document_version_texts t on t.document_version_id=v.id
        -- The most recent run. Left, because a version with no job at all is a
        -- real state the view has to be able to report.
        left join lateral (
          select status, last_error_code, provenance
          from document_analysis_jobs
          where document_version_id = v.id
          order by created_at desc
          limit 1
        ) j on true
        where d.case_id = ${caseId} or (d.case_id is null and exists (
          select 1 from requirement_evidence_links l join case_requirement_instances r on r.id=l.requirement_instance_id
          join annual_return_cases a on a.id=r.case_id and a.company_id=d.company_id
          where l.document_id=d.id and r.case_id=${caseId}))
        order by d.uploaded_at desc
      `;
      // A case assignment grants access to that case's documents. It cannot
      // turn a company-level shared document into a case-owned document.
      const versions = candidates.filter((row) =>
        isDocumentVisibleToStaffActor(actor, {
          companyId: row.company_id,
          companyTeamId: row.company_team_id,
          caseId: row.case_id,
          caseOwnerId: row.case_owner_id,
          caseReviewerId: row.case_reviewer_id,
        }),
      );
      if (versions.length === 0) return [];

      const versionIds = versions.map((row) => row.document_version_id);
      const rows = await sql<(FindingRow & PersistedRow)[]>`
        select id, document_version_id, requirement_instance_id, page_from, page_to,
          tier, rule_key, rule_version, outcome, severity, detail, evidence, resolved_by, resolved_at
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

      return versions.map((row) =>
        viewFor({
          documentId: row.document_id,
          documentVersionId: row.document_version_id,
          fileName: row.file_name,
          state: analysisStateFrom(
            row.job_status === null
              ? null
              : { status: row.job_status, lastErrorCode: row.job_error_code },
          ),
          findings: byVersion.get(row.document_version_id) ?? [],
          provenance: row.provenance,
          evidence: row.evidence,
          document: {
            id: row.document_id,
            currentVersionId: row.document_version_id,
            uploadStatus: row.upload_status,
            scanVerdictSource: row.safe_source ? row.scan_verdict_source : null,
            availability:
              row.safe_source && row.upload_status === "available" ? "available" : "unscanned",
          },
        }),
      );
    },

    async resolveFinding(input) {
      return withTransaction(sql, async (tx) => {
        const [source] = await tx<
          { document_id: string; company_id: string; case_id: string | null; id: string }[]
        >`select v.id,v.document_id,d.company_id,d.case_id from document_findings f join document_versions v on v.id=f.document_version_id join documents d on d.id=v.document_id where f.id=${input.findingId}`;
        if (
          !source ||
          source.id !== input.expectedDocumentVersionId ||
          (source.case_id !== null && source.case_id !== input.caseId)
        )
          return false;
        const [staff] = await tx<
          {
            id: string;
            role: "Admin" | "Manager" | "Staff";
            team_id: string | null;
            auth_user_id: string;
          }[]
        >`select u.id,u.role,u.team_id,sp.auth_user_id from users u join staff_profiles sp on sp.user_id=u.id where u.id=${input.resolvedByUserId} and u.active and sp.active and sp.role=u.role and sp.team_id is not distinct from u.team_id and u.role in ('Admin','Manager','Staff') and (${input.resolvedByAuthUserId ?? null}::text is null or sp.auth_user_id=${input.resolvedByAuthUserId ?? null}) for share of u,sp`;
        if (!staff) throw new Error("Forbidden: current verified staff identity is required.");
        const cases =
          await tx`select a.id from annual_return_cases a join companies c on c.id=a.company_id where a.id=${input.caseId} and c.id=${source.company_id} for share of a,c`;
        if (cases.length !== 1) return false;
        await tx`select id from documents where id=${source.document_id} for update`;
        await tx`select id from document_versions where id=${source.id} for update`;
        const scope = await createDocumentRepository({ sql: tx }).getDocumentAccessSubject(
          source.document_id,
        );
        if (
          !scope ||
          (scope.caseId !== null && scope.caseId !== input.caseId) ||
          scope.companyId !== source.company_id
        )
          return false;
        if (scope.caseId === null) {
          const links =
            await tx`select l.id from requirement_evidence_links l join case_requirement_instances r on r.id=l.requirement_instance_id where l.document_id=${source.document_id} and r.case_id=${input.caseId} for share of l,r`;
          if (links.length === 0) return false;
        }
        assertStaffDocumentAccess(
          {
            userId: staff.id,
            authUserId: staff.auth_user_id,
            role: staff.role,
            teamId: staff.team_id,
            active: true,
          },
          scope,
        );
        const rows = await tx<{ id: string }[]>`
        update document_findings f
        set resolved_by = ${input.resolvedByUserId}, resolved_at = now(),
          resolution_note = ${input.note}
        from document_versions v
        join documents d on d.id = v.document_id
        where f.id = ${input.findingId}
          and f.resolved_by is null
          and v.id = f.document_version_id
          and (d.case_id = ${input.caseId} or (d.case_id is null and exists (
            select 1 from requirement_evidence_links l
            join case_requirement_instances r on r.id=l.requirement_instance_id
            join annual_return_cases a on a.id=r.case_id and a.company_id=d.company_id
            where l.document_id=d.id and r.case_id=${input.caseId})))
          and v.id=${input.expectedDocumentVersionId} and v.superseded_by_version_id is null
        returning f.id
      `;
        if (rows.length === 1)
          await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,actor_id,description,metadata) values(${source.company_id},${input.caseId},'document_finding_resolved','user',${staff.id},'已由人手處理文件檢查結果',${tx.json({ findingId: input.findingId, documentVersionId: source.id, note: input.note })})`;
        return rows.length === 1;
      });
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
  return repository;
}

function withTransaction<T>(
  client: QueryClient,
  callback: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return "begin" in client
    ? (client.begin(callback) as Promise<T>)
    : callback(client as postgres.TransactionSql);
}
