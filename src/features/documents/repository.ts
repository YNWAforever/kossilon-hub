import { assertClientCompanyAccess, assertStaffAccess } from "@/features/auth/authorization";
import type { ClientCompanyMembership } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import { boundedPageSize, readTupleCursor, tupleCursor } from "@/server/db/pagination";
export type DocumentListFilters = {
  id?: string;
  companyId?: string;
  caseId?: string;
  teamId?: string;
  assignedUserId?: string;
  q?: string;
  category?: string;
  cursor?: string;
  limit?: number;
};
import type { DocumentAccessSubject } from "./authorization";
import { assertStaffDocumentAccess } from "./authorization";
import { enqueueDocumentAnalysisJob } from "./analysis-jobs";
import { enqueueDocumentScanJob } from "./scan-jobs";
import { DocumentVersionConflictError } from "./version-conflict";
import { paymentProofWasReturned } from "@/features/annual-return/payment-evidence-state";
import {
  type DocumentCategory,
  type DocumentAvailability,
  type DocumentScanResult,
  type DocumentStatus,
  type ScanVerdictSource,
} from "./types";

/**
 * How long received-but-unscanned bytes are held.
 *
 * Deliberately generous, and deliberately NOT the 15-minute upload-intent
 * expiry it was accidentally sharing. `expires_at` answers "did the browser ever
 * come back with the bytes"; this answers "how long may a received file wait for
 * a scanner". Conflating them meant a file uploaded at minute 14 was deleted at
 * minute 15 (see migration 0023). Reaching this window escalates for an operator;
 * it never deletes evidence.
 */
export const QUARANTINE_RETENTION_DAYS = 14;

export function quarantineRetentionUntil(receivedAt: string | Date): string {
  return new Date(
    new Date(receivedAt).getTime() + QUARANTINE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export { DOCUMENT_CATEGORIES, type DocumentCategory } from "./types";

export type DocumentUploadIntent = {
  currentVersionId?: string | null;
  scannedVersionId?: string | null;
  id: string;
  companyId: string;
  caseId: string | null;
  documentId: string | null;
  /** Which checklist requirement this upload answers, when the uploader said. */
  checklistItemId: string | null;
  requestedByAuthUserId: string;
  category: DocumentCategory;
  fileName: string;
  contentType: string;
  expectedSizeBytes: number;
  checksum: string;
  objectKey: string;
  status: DocumentStatus;
  scanProviderReference: string | null;
  scanErrorCode: string | null;
  /**
   * NULL means the verdict predates this distinction and is unverifiable, so it
   * reads the same as 'deterministic': unknown safety, not verified safety.
   */
  scanVerdictSource: ScanVerdictSource | null;
  expiresAt: string;
  /** Set at receipt; null until then and after a terminal verdict. */
  quarantineRetentionUntil: string | null;
};

export type PrivateDocument = {
  currentVersionId?: string | null;
  scannedVersionId?: string | null;
  reviewedVersionId?: string | null;
  verifiedChecksum?: string | null;
  id: string;
  companyId: string;
  caseId: string | null;
  category: DocumentCategory;
  fileName: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  uploadStatus: DocumentStatus;
  /**
   * Carried onto the document because "is this file safe to open" is decided
   * wherever the file is served, and a NULL or 'deterministic' verdict is not
   * safety. Without it here every consumer would have to re-join the intent to
   * find out, and the one that forgot would serve an unscanned file.
   */
  scanVerdictSource: ScanVerdictSource | null;
  reviewStatus: "pending" | "verified" | "rejected";
  uploadedBy: string | null;
  uploadedAt: string;
  availability?: DocumentAvailability;
};

/** A register entry is visible even when it cannot safely supply bytes. */
export type DocumentSummary = Omit<
  PrivateDocument,
  "contentType" | "sizeBytes" | "checksum" | "uploadStatus"
> & {
  contentType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  uploadStatus: DocumentStatus | null;
  currentVersionId?: string | null;
  intentId?: string | null;
  /** Listing metadata does not check storage or prove that an object exists. */
  objectAvailability?: "not_checked";
};

export type DocumentUploadRequest = {
  category: DocumentCategory;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
};

export type DocumentRecoveryRequest = { documentId: string; expectedToken: string; reason: string };
export type DocumentRecoveryPreview = {
  documentId: string;
  companyId: string;
  caseId: string | null;
  category: DocumentCategory;
  fileName: string;
  currentVersionId: string | null;
  versionToken: string;
  availability: DocumentAvailability;
  action: "additive_reupload";
  /** Internal storage observation input; removed by the server RPC. */
  objectKey: string;
};

const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
};
const EXTENSIONS_BY_CATEGORY: Record<DocumentCategory, readonly string[]> = {
  identity: ["pdf"],
  registry: ["pdf"],
  signature: ["pdf"],
  payment: ["pdf", "png", "jpg", "jpeg"],
  packet: ["pdf"],
  submission: ["pdf"],
  receipt: ["pdf"],
  other: ["pdf", "png", "jpg", "jpeg"],
};
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function validateDocumentUploadRequest(input: DocumentUploadRequest): void {
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_DOCUMENT_BYTES
  ) {
    throw new Error(`Document size must be between 1 and ${MAX_DOCUMENT_BYTES} bytes.`);
  }
  if (!/^[0-9a-f]{64}$/.test(input.checksum)) throw new Error("Invalid SHA-256 checksum.");
  const extension = input.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTENSIONS_BY_CATEGORY[input.category].includes(extension)) {
    throw new Error(`Unsupported extension for ${input.category} documents.`);
  }
  if (!MIME_BY_EXTENSION[extension]?.includes(input.contentType)) {
    throw new Error("Content type does not match the file extension.");
  }
}

export function assertDocumentCompanyAccess(
  actor: AuthenticatedActor,
  companyId: string,
  memberships: readonly ClientCompanyMembership[],
): AuthenticatedActor {
  return actor.role === "Client"
    ? assertClientCompanyAccess(actor, companyId, memberships)
    : assertStaffAccess(actor);
}

type QueryClient = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
type IntentRow = {
  current_version_id?: string | null;
  scan_document_version_id?: string | null;
  id: string;
  company_id: string;
  case_id: string | null;
  document_id: string | null;
  checklist_item_id: string | null;
  requested_by_auth_user_id: string;
  category: DocumentCategory;
  file_name: string;
  content_type: string;
  expected_size_bytes: string | number;
  checksum_sha256: string;
  object_key: string;
  status: DocumentStatus;
  scan_provider_reference: string | null;
  scan_error_code: string | null;
  scan_verdict_source: ScanVerdictSource | null;
  expires_at: string | Date;
  quarantine_retention_until: string | Date | null;
};
type DocumentRow = {
  cursor_uploaded_at: string;
  scan_document_version_id?: string | null;
  reviewed_document_version_id?: string | null;
  id: string;
  company_id: string;
  case_id: string | null;
  file_type: DocumentCategory;
  file_name: string;
  storage_url: string;
  verification_status: "pending" | "verified" | "rejected";
  uploaded_by: string | null;
  uploaded_at: string | Date;
  content_type: string | null;
  expected_size_bytes: string | number | null;
  checksum_sha256: string | null;
  upload_status: DocumentStatus | null;
  scan_verdict_source: ScanVerdictSource | null;
  current_version_id?: string | null;
  intent_id?: string | null;
  verified_checksum_sha256?: string | null;
  version_token?: string;
};

type AccessSubjectRow = {
  company_id: string;
  assigned_team_id: string | null;
  case_id: string | null;
  owner_id: string | null;
  reviewer_id: string | null;
};

function mapAccessSubject(row: AccessSubjectRow): DocumentAccessSubject {
  return {
    companyId: row.company_id,
    companyTeamId: row.assigned_team_id,
    caseId: row.case_id,
    caseOwnerId: row.owner_id,
    caseReviewerId: row.reviewer_id,
  };
}

function mapIntent(row: IntentRow): DocumentUploadIntent {
  return {
    currentVersionId: row.current_version_id ?? null,
    scannedVersionId: row.scan_document_version_id ?? null,
    id: row.id,
    companyId: row.company_id,
    caseId: row.case_id,
    documentId: row.document_id,
    checklistItemId: row.checklist_item_id ?? null,
    requestedByAuthUserId: row.requested_by_auth_user_id,
    category: row.category,
    fileName: row.file_name,
    contentType: row.content_type,
    expectedSizeBytes: Number(row.expected_size_bytes),
    checksum: row.checksum_sha256,
    objectKey: row.object_key,
    status: row.status,
    scanProviderReference: row.scan_provider_reference,
    scanErrorCode: row.scan_error_code,
    scanVerdictSource: row.scan_verdict_source,
    expiresAt: new Date(row.expires_at).toISOString(),
    quarantineRetentionUntil:
      row.quarantine_retention_until === null || row.quarantine_retention_until === undefined
        ? null
        : new Date(row.quarantine_retention_until).toISOString(),
  };
}

function mapDocument(row: DocumentRow): PrivateDocument {
  if (
    !row.content_type ||
    row.expected_size_bytes === null ||
    !row.checksum_sha256 ||
    !row.upload_status
  ) {
    throw new Error("Document upload lineage is incomplete.");
  }
  return {
    currentVersionId: row.current_version_id ?? null,
    scannedVersionId: row.scan_document_version_id ?? null,
    reviewedVersionId: row.reviewed_document_version_id ?? null,
    verifiedChecksum: row.verified_checksum_sha256 ?? null,
    id: row.id,
    companyId: row.company_id,
    caseId: row.case_id,
    category: row.file_type,
    fileName: row.file_name,
    objectKey: row.storage_url,
    contentType: row.content_type,
    sizeBytes: Number(row.expected_size_bytes),
    checksum: row.checksum_sha256,
    uploadStatus: row.upload_status,
    scanVerdictSource: row.scan_verdict_source,
    reviewStatus:
      row.reviewed_document_version_id === row.current_version_id && row.current_version_id
        ? row.verification_status
        : "pending",
    uploadedBy: row.uploaded_by,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
}

function availabilityOf(row: DocumentRow): DocumentAvailability {
  if (!row.current_version_id || !row.intent_id) return "metadata_only";
  if (row.upload_status === "rejected") return "unsafe";
  if (row.upload_status !== "available") return "quarantined";
  return row.scan_verdict_source === "provider" &&
    row.scan_document_version_id === row.current_version_id &&
    Boolean(row.checksum_sha256) &&
    row.verified_checksum_sha256 === row.checksum_sha256
    ? "available"
    : "unscanned";
}

function mapDocumentSummary(row: DocumentRow): DocumentSummary {
  return {
    scannedVersionId: row.scan_document_version_id ?? null,
    reviewedVersionId: row.reviewed_document_version_id ?? null,
    verifiedChecksum: row.verified_checksum_sha256 ?? null,
    id: row.id,
    companyId: row.company_id,
    caseId: row.case_id,
    category: row.file_type,
    fileName: row.file_name,
    objectKey: row.storage_url,
    contentType: row.content_type,
    sizeBytes: row.expected_size_bytes === null ? null : Number(row.expected_size_bytes),
    checksum: row.checksum_sha256,
    uploadStatus: row.upload_status,
    scanVerdictSource: row.scan_verdict_source,
    reviewStatus:
      row.reviewed_document_version_id === row.current_version_id && row.current_version_id
        ? row.verification_status
        : "pending",
    uploadedBy: row.uploaded_by,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    currentVersionId: row.current_version_id ?? null,
    intentId: row.intent_id ?? null,
    availability: availabilityOf(row),
    objectAvailability: "not_checked",
  };
}

function withTransaction<T>(client: QueryClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in client ? (client.begin(fn) as Promise<T>) : fn(client);
}

export type DocumentRepository = {
  createUploadIntent(input: {
    companyId: string;
    caseId?: string;
    checklistItemId?: string;
    replacementDocumentId?: string;
    recovery?: DocumentRecoveryRequest;
    recoveryApprovedBy?: string;
    /** Server observer only; never accepted by the RPC input validator. */
    recoveryObjectState?: "missing";
    recoveryObjectObservedAt?: string;
    requestedByAuthUserId: string;
    category: DocumentCategory;
    fileName: string;
    contentType: string;
    expectedSizeBytes: number;
    checksum: string;
    objectKey: string;
    expiresAt: string;
  }): Promise<DocumentUploadIntent>;
  getUploadIntent(id: string, lock?: boolean): Promise<DocumentUploadIntent | null>;
  finalizeUploadIntent(input: {
    intentId: string;
    uploadedBy: string | null;
    source: "staff" | "client";
  }): Promise<PrivateDocument>;
  getDocument(id: string): Promise<PrivateDocument | null>;
  getDocumentRecoveryPreview(id: string): Promise<DocumentRecoveryPreview | null>;
  listDocuments(filters?: DocumentListFilters): Promise<DocumentSummary[]>;
  listDocumentPage(
    filters?: DocumentListFilters,
  ): Promise<{ documents: DocumentSummary[]; nextCursor: string | null }>;
  /**
   * The authoritative scope of one document/intent/company, for
   * `assertStaffDocumentAccess`. Loaded here rather than accepted from the
   * caller: authorization that trusts a client-supplied company or case is not
   * authorization.
   */
  getDocumentAccessSubject(documentId: string): Promise<DocumentAccessSubject | null>;
  getIntentAccessSubject(intentId: string): Promise<DocumentAccessSubject | null>;
  getCompanyAccessSubject(
    companyId: string,
    caseId?: string | null,
  ): Promise<DocumentAccessSubject | null>;
  recordScanResult(
    intentId: string,
    result: DocumentScanResult,
    options?: {
      verdictSource?: ScanVerdictSource;
      expectedChecksum?: string;
      expectedVersionId?: string;
      scanJobClaim?: { jobId: string; attemptCount: number };
      /**
       * Which current statuses may receive this verdict. Defaults to
       * ['quarantined'] -- the normal first scan. A genuine re-scan of a legacy
       * file also passes 'available', because those files sit at 'available'
       * with an unverifiable verdict and must be able to receive a real one
       * without first being pushed back through quarantine, which would change
       * what `status` means for every existing consumer.
       */
      allowStatuses?: readonly DocumentStatus[];
    },
  ): Promise<DocumentUploadIntent>;
  reviewDocument(input: {
    documentId: string;
    expectedVersionId: string;
    reviewerId: string;
    reviewerAuthUserId?: string;
    decision: "verified" | "rejected";
    reason?: string;
  }): Promise<PrivateDocument>;
  expireUploads(now: string): Promise<DocumentUploadIntent[]>;
  listStalledQuarantine(now: string, limit?: number): Promise<DocumentUploadIntent[]>;
  close(): Promise<void>;
};

export function createDocumentRepository(
  options?: CreateSqlClientOptions & { sql?: QueryClient },
): DocumentRepository;
export function createDocumentRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): DocumentRepository;
export function createDocumentRepository(
  databaseUrlOrOptions: string | (CreateSqlClientOptions & { sql?: QueryClient }) = {},
  maybeOptions: CreateSqlClientOptions = {},
): DocumentRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  async function getUploadIntent(id: string, lock = false): Promise<DocumentUploadIntent | null> {
    const rows = lock
      ? await sql<IntentRow[]>`select i.*,v.id current_version_id from document_upload_intents i
          left join document_versions v on v.intent_id=i.id and v.superseded_by_version_id is null
          where i.id=${id} for update of i`
      : await sql<IntentRow[]>`select i.*,v.id current_version_id from document_upload_intents i
          left join document_versions v on v.intent_id=i.id and v.superseded_by_version_id is null where i.id=${id}`;
    return rows[0] ? mapIntent(rows[0]) : null;
  }

  async function documentRows(
    filters: DocumentListFilters = {},
    client: QueryClient = sql,
    extra = false,
  ) {
    const limit = boundedPageSize(filters.limit),
      cursor = readTupleCursor(filters.cursor, 2);
    const q = filters.q?.trim()
      ? `%${filters.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`
      : null;
    return client<DocumentRow[]>`
      with page as materialized (
      select d.* from documents d join companies c on c.id=d.company_id
      where (${filters.id ?? null}::uuid is null or d.id = ${filters.id ?? null})
        and (${filters.companyId ?? null}::uuid is null or d.company_id = ${filters.companyId ?? null})
        and (${filters.caseId ?? null}::uuid is null or d.case_id = ${filters.caseId ?? null})
        and (${filters.category ?? null}::text is null or d.file_type=${filters.category ?? null})
        and (${q}::text is null or d.file_name ilike ${q} escape '\\' or c.company_name ilike ${q} escape '\\')
        -- Send the boundary as text: postgres.js serializes timestamptz through JS Date, losing microseconds.
        and (${cursor === null} or d.uploaded_at<${cursor?.[0] ?? null}::text::timestamptz or (d.uploaded_at=${cursor?.[0] ?? null}::text::timestamptz and d.id>${cursor?.[1] ?? null}::uuid))
        and (
          (${filters.teamId ?? null}::uuid is null and ${filters.assignedUserId ?? null}::uuid is null)
          or c.assigned_team_id = ${filters.teamId ?? null}::uuid
          or exists(select 1 from annual_return_cases a where a.id=d.case_id and a.company_id=d.company_id
            and (a.owner_id=${filters.assignedUserId ?? null}::uuid or a.reviewer_id=${filters.assignedUserId ?? null}::uuid))
        )
      order by d.uploaded_at desc, d.id limit ${limit + (extra ? 1 : 0)})
      select d.*, d.uploaded_at::text as cursor_uploaded_at, i.content_type, i.expected_size_bytes, i.checksum_sha256, i.status upload_status,
        i.scan_verdict_source,i.scan_document_version_id,v.id current_version_id,i.id intent_id,v.verified_checksum_sha256,
        md5(jsonb_build_object('document',to_jsonb(d),'version',to_jsonb(v),'intent',to_jsonb(i))::text) version_token
      from page d left join lateral (
        select * from document_versions where document_id=d.id and superseded_by_version_id is null order by version_number desc limit 1
      ) v on true
      left join document_upload_intents i on i.id=v.intent_id and i.document_id=d.id
        and i.company_id=d.company_id and i.case_id is not distinct from d.case_id and i.object_key=v.storage_url and v.storage_url=d.storage_url
      order by d.uploaded_at desc,d.id`;
  }

  async function lockRecoverySource(tx: Tx, id: string) {
    await tx`select id from documents where id=${id} for update`;
    const versions = await tx<
      { id: string; intent_id: string | null }[]
    >`select intent_id from document_versions
      where document_id=${id} and superseded_by_version_id is null`;
    if (versions[0]?.intent_id)
      await tx`select id from document_upload_intents where id=${versions[0].intent_id} for update`;
    await tx`select id from document_versions where document_id=${id} and superseded_by_version_id is null for update`;
    return (await documentRows({ id }, tx))[0];
  }

  return {
    async createUploadIntent(input) {
      validateDocumentUploadRequest({
        category: input.category,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.expectedSizeBytes,
        checksum: input.checksum,
      });
      return withTransaction(sql, async (tx) => {
        // Shared lock order with ordinary replacement and case evidence writes.
        if (input.caseId) {
          const cases = await tx<{ company_id: string }[]>`
            select company_id from annual_return_cases where id = ${input.caseId} for update`;
          if (!cases[0] || cases[0].company_id !== input.companyId)
            throw new Error("Case does not belong to the company.");
        }
        if (input.recovery) {
          if (
            !input.recoveryApprovedBy ||
            !input.recovery.reason.trim() ||
            input.replacementDocumentId
          ) {
            throw new Error("Recovery requires staff approval and a reason.");
          }
          const original = await lockRecoverySource(tx, input.recovery.documentId);
          if (
            !original ||
            original.company_id !== input.companyId ||
            original.case_id !== (input.caseId ?? null) ||
            original.file_type !== input.category
          ) {
            throw new Error("Recovery document scope does not match.");
          }
          if (original.version_token !== input.recovery.expectedToken)
            throw new Error("Recovery source changed; preview again.");
          if (availabilityOf(original) === "available" && input.recoveryObjectState !== "missing")
            throw new Error("Document has a complete verified chain; recovery is not required.");
          const prior = await tx<
            IntentRow[]
          >`select i.* from timeline_events e join document_upload_intents i on i.id::text=e.metadata->>'intentId'
            where e.event_type='document_recovery_requested' and e.metadata->>'sourceDocumentId'=${input.recovery.documentId}
              and i.status not in ('expired','rejected','failed') and (i.status<>'created' or i.expires_at>now())
            order by e.created_at desc limit 1`;
          if (prior[0]) {
            if (
              prior[0].requested_by_auth_user_id === input.requestedByAuthUserId &&
              prior[0].checksum_sha256 === input.checksum &&
              Number(prior[0].expected_size_bytes) === input.expectedSizeBytes &&
              prior[0].file_name === input.fileName &&
              prior[0].content_type === input.contentType
            )
              return mapIntent(prior[0]);
            throw new Error(
              "A recovery is already pending or received; review that attempt first.",
            );
          }
        }
        if (input.checklistItemId) {
          // Checked against the case, not merely for existence. A client-supplied
          // checklist item id from another company's case would otherwise let one
          // client's upload satisfy another client's requirement.
          if (!input.caseId) throw new Error("A checklist item requires a case.");
          const items = await tx<{ case_id: string }[]>`
            select case_id from annual_return_checklist_items
            where id = ${input.checklistItemId} for update`;
          if (!items[0] || items[0].case_id !== input.caseId)
            throw new Error("Checklist item does not belong to the case.");
        }
        if (input.replacementDocumentId) {
          const replaced = await tx<
            { company_id: string; case_id: string | null; verification_status: string }[]
          >`
            select company_id, case_id, verification_status from documents
            where id = ${input.replacementDocumentId} for update`;
          if (
            !replaced[0] ||
            replaced[0].company_id !== input.companyId ||
            replaced[0].case_id !== (input.caseId ?? null)
          ) {
            throw new Error("Replacement document scope does not match.");
          }
          const [currentVersion] = await tx<
            { id: string }[]
          >`select id from document_versions where document_id=${input.replacementDocumentId} and superseded_by_version_id is null`;
          const paymentReturned =
            input.category === "payment" &&
            currentVersion &&
            (await paymentProofWasReturned(tx, input.replacementDocumentId, currentVersion.id));
          if (replaced[0].verification_status !== "rejected" && !paymentReturned)
            throw new Error("Only rejected documents may be replaced.");
        }
        // There used to be a guard here refusing any new intent when a *verified*
        // document already existed for (company, case, category). `category` is
        // one of eight broad buckets with no notion of a person, so once one
        // director's HKID was verified under 'identity', a second director's HKID
        // could not be uploaded at all -- and replacementDocumentId was no escape
        // because it requires the prior document to be 'rejected'.
        //
        // It was reaching for immutability of accepted bytes, which is real but
        // belongs elsewhere and is already enforced there: an upload never
        // mutates an existing row (finalizeUploadIntent inserts a new documents
        // row), and reviewDocument refuses anything whose verification_status is
        // not 'pending', so an accepted document cannot be re-decided.
        //
        // So additive uploads are permitted. A new file does not overwrite,
        // supersede or inherit the approval of an old one. Until Phase B/C
        // introduce person-level requirement slots, an extra document in an
        // already-satisfied category is unassigned evidence a human must map:
        // reviewAnnualReturnEvidenceAction already requires an explicit
        // checklistItemId for checklist categories, so nothing auto-attaches.
        const rows = await tx<IntentRow[]>`
          insert into document_upload_intents (
            company_id, case_id, checklist_item_id, requested_by_auth_user_id, category, file_name,
            content_type, expected_size_bytes, checksum_sha256, object_key, expires_at
          ) values (${input.companyId}, ${input.caseId ?? null}, ${input.checklistItemId ?? null},
            ${input.requestedByAuthUserId},
            ${input.category}, ${input.fileName}, ${input.contentType}, ${input.expectedSizeBytes},
            ${input.checksum}, ${input.objectKey}, ${input.expiresAt}) returning *`;
        if (input.recovery)
          await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,actor_id,description,metadata)
          values(${input.companyId},${input.caseId ?? null},'document_recovery_requested','user',${input.recoveryApprovedBy!},'Versioned additive document recovery approved.',
            ${tx.json({
              sourceDocumentId: input.recovery.documentId,
              expectedToken: input.recovery.expectedToken,
              reason: input.recovery.reason,
              intentId: rows[0].id,
              objectState: input.recoveryObjectState ?? "not_checked",
              objectObservedAt: input.recoveryObjectObservedAt ?? null,
            })})`;
        return mapIntent(rows[0]);
      });
    },
    getUploadIntent,
    finalizeUploadIntent(input) {
      return withTransaction(sql, async (tx) => {
        const [candidate] = await tx<
          IntentRow[]
        >`select * from document_upload_intents where id=${input.intentId}`;
        if (candidate?.case_id) {
          const [caseRow] = await tx<
            { company_id: string }[]
          >`select company_id from annual_return_cases where id=${candidate.case_id} for update`;
          if (!caseRow || caseRow.company_id !== candidate.company_id)
            throw new Error("Case does not belong to the company.");
        }
        const intents = await tx<
          IntentRow[]
        >`select * from document_upload_intents where id = ${input.intentId} for update`;
        const intent = intents[0] ? mapIntent(intents[0]) : null;
        if (!intent) throw new Error("Upload intent not found.");
        if (intent.status !== "created") throw new Error("Upload intent cannot be finalized.");
        if (Date.parse(intent.expiresAt) <= Date.now()) throw new Error("Upload intent expired.");
        const [recovery] = await tx<
          { metadata: { sourceDocumentId: string; expectedToken: string } }[]
        >`select metadata from timeline_events
          where event_type='document_recovery_requested' and metadata->>'intentId'=${intent.id} limit 1`;
        if (recovery) {
          const original = await lockRecoverySource(tx, recovery.metadata.sourceDocumentId);
          if (!original || original.version_token !== recovery.metadata.expectedToken)
            throw new Error("Recovery source changed; preview again.");
        }
        const documents = await tx<{ id: string }[]>`
          insert into documents (
            company_id, case_id, file_type, file_name, storage_url, upload_source,
            verification_status, uploaded_by
          ) values (${intent.companyId}, ${intent.caseId}, ${intent.category}, ${intent.fileName},
            ${intent.objectKey}, ${input.source}, 'pending', ${input.uploadedBy}) returning id`;
        if (recovery)
          await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,actor_id,description,metadata)
          values(${intent.companyId},${intent.caseId},'document_recovery_received','user',${input.uploadedBy},'Recovery file received; scanning and review still required.',
            ${tx.json({ ...recovery.metadata, intentId: intent.id, documentId: documents[0].id })})`;

        // Version 1 of these bytes, in the same transaction as the document, so
        // that no document can ever exist without a version and the rest of the
        // codebase never has to special-case "documents that predate versioning".
        //
        // The checksum and size go into the *declared* columns. They came from
        // the client when the intent was created, before the bytes existed, and
        // nothing enabled has compared them to the stored object -- only the
        // provider scanner reads and hashes it, and that is BLOCKED_INTEGRATION.
        // verified_checksum_sha256 stays null until it does.
        const versions = await tx<{ id: string }[]>`
          insert into document_versions (
            document_id, version_number, declared_checksum_sha256, declared_byte_size,
            content_type, file_name, storage_url, intent_id, uploaded_by
          ) values (${documents[0].id}, 1, ${intent.checksum}, ${intent.expectedSizeBytes},
            ${intent.contentType}, ${intent.fileName}, ${intent.objectKey}, ${intent.id},
            ${input.uploadedBy}) returning id`;

        // Analysis work, enqueued in the same transaction and for the same
        // reason as the scan job below: a version must never exist without the
        // work that examines it. A Worker killed between the commit and a
        // post-commit enqueue would leave a document nothing will ever look at,
        // and no error anywhere to say so.
        //
        // Enqueued even though no scanner has passed the file yet. The worker
        // itself holds the gate -- it refuses to read bytes whose safety is not
        // `verified` and backs off -- so queuing now costs a cheap deferred
        // claim, and means nothing has to remember to enqueue later when the
        // verdict finally lands.
        await enqueueDocumentAnalysisJob(tx, { documentVersionId: versions[0].id });

        // quarantine_retention_until is set here, from the moment of actual
        // receipt, and from now on it -- not expires_at -- governs these bytes.
        // expires_at answers "did the upload ever complete"; this row has just
        // proved that it did.
        const updated = await tx<IntentRow[]>`
          update document_upload_intents set document_id = ${documents[0].id}, status = 'quarantined',
            uploaded_at = now(), updated_at = now(),
            quarantine_retention_until = now() + ${`${QUARANTINE_RETENTION_DAYS} days`}::interval
          where id = ${intent.id} returning *`;

        // Enqueued inside this transaction on purpose. Scanning used to be a
        // staff-triggered HTTP call with zero production callers, so a received
        // file simply waited forever. Enqueuing after the commit instead would
        // reintroduce the same hole on a narrower window: a Worker killed between
        // the two would leave a received object with no outstanding work and no
        // error anywhere. Either both land or neither does.
        await enqueueDocumentScanJob(tx, {
          intentId: intent.id,
          documentVersionId: versions[0].id,
          checksum: intent.checksum,
          reason: "initial",
        });

        // The checklist finally hears about the upload.
        //
        // In the same transaction as the document, because a received file whose
        // requirement still reads 'Missing' is the exact state that had the
        // client chased for a document already in hand.
        //
        // Only from Missing or Rejected, and never over a Verified item: an
        // approval is a human decision about specific bytes and a later upload
        // does not undo it. A Received item stays Received -- the second upload
        // is additional evidence for the same requirement, not a fresh receipt.
        //
        // Written here rather than through annual-return's updateChecklistItem
        // deliberately. That path also calls ensureWorkItemForEvent, which throws
        // when no active SLA policy exists for the work type, and an upload must
        // not fail because of a missing policy row. The receipt is recorded; the
        // internal review task is derived from the 'Received' status itself.
        if (intent.checklistItemId) {
          await tx`
            update annual_return_checklist_items
            set status = 'Received', received_at = now(), document_id = ${documents[0].id},
              updated_at = now()
            where id = ${intent.checklistItemId}
              and case_id = ${intent.caseId}
              and status in ('Missing', 'Rejected')`;
        }

        const rows = await tx<DocumentRow[]>`
          select d.*, i.content_type, i.expected_size_bytes, i.checksum_sha256, i.status upload_status,
             i.scan_verdict_source
          from documents d join document_upload_intents i on i.document_id = d.id
          where d.id = ${documents[0].id}`;
        if (!updated[0] || !rows[0]) throw new Error("Unable to finalize document metadata.");
        return mapDocument({ ...rows[0], current_version_id: versions[0].id });
      });
    },
    async getDocument(id) {
      const rows = await documentRows({ id });
      const row = rows[0];
      if (
        !row ||
        !row.current_version_id ||
        !row.intent_id ||
        !row.content_type ||
        row.expected_size_bytes === null ||
        !row.checksum_sha256 ||
        !row.upload_status
      )
        return null;
      return {
        ...mapDocument(row),
        currentVersionId: row.current_version_id,
        availability: availabilityOf(row),
      };
    },
    async getDocumentRecoveryPreview(id) {
      const [row] = await documentRows({ id });
      if (!row) return null;
      return {
        documentId: row.id,
        companyId: row.company_id,
        caseId: row.case_id,
        category: row.file_type,
        fileName: row.file_name,
        currentVersionId: row.current_version_id ?? null,
        versionToken: row.version_token!,
        availability: availabilityOf(row),
        action: "additive_reupload",
        objectKey: row.storage_url,
      };
    },
    async getDocumentAccessSubject(documentId) {
      const rows = await sql<AccessSubjectRow[]>`
        select d.company_id, c.assigned_team_id, d.case_id, a.owner_id, a.reviewer_id
        from documents d
        join companies c on c.id = d.company_id
        left join annual_return_cases a on a.id = d.case_id and a.company_id=d.company_id
        where d.id = ${documentId}`;
      return rows[0] ? mapAccessSubject(rows[0]) : null;
    },
    async getIntentAccessSubject(intentId) {
      const rows = await sql<AccessSubjectRow[]>`
        select i.company_id, c.assigned_team_id, i.case_id, a.owner_id, a.reviewer_id
        from document_upload_intents i
        join companies c on c.id = i.company_id
        left join annual_return_cases a on a.id = i.case_id and a.company_id=i.company_id
        where i.id = ${intentId}`;
      return rows[0] ? mapAccessSubject(rows[0]) : null;
    },
    async getCompanyAccessSubject(companyId, caseId) {
      // The case is joined on its own id AND its company, so a caseId belonging
      // to another company contributes no owner/reviewer rather than silently
      // granting that company's assignees access here.
      const rows = await sql<AccessSubjectRow[]>`
        select c.id company_id, c.assigned_team_id,
          a.id case_id, a.owner_id, a.reviewer_id
        from companies c
        left join annual_return_cases a
          on a.id = ${caseId ?? null} and a.company_id = c.id
        where c.id = ${companyId}`;
      return rows[0] ? mapAccessSubject(rows[0]) : null;
    },
    async listDocuments(filters = {}) {
      const limit = boundedPageSize(filters.limit),
        rows = await documentRows(filters, sql, true);
      if (rows.length > limit)
        throw new Error(
          "Document list exceeds its bounded page; use listDocumentPage to continue.",
        );
      return rows.map(mapDocumentSummary);
    },
    async listDocumentPage(filters = {}) {
      const limit = boundedPageSize(filters.limit),
        rows = await documentRows(filters, sql, true);
      const page = rows.slice(0, limit).map(mapDocumentSummary),
        last = page.at(-1);
      return {
        documents: page,
        nextCursor:
          rows.length > limit && last
            ? tupleCursor([rows[limit - 1].cursor_uploaded_at, last.id])
            : null,
      };
    },
    recordScanResult(intentId, result, options = {}) {
      const status =
        result.status === "clean"
          ? "available"
          : result.status === "rejected"
            ? "rejected"
            : result.retryable
              ? "quarantined"
              : "failed";
      // Transactional because a clean verdict from a scanner that actually read
      // the bytes also establishes the document's content identity. The verdict
      // and that identity are the same fact; committing one without the other
      // would leave a released document whose hash nobody recorded, or a hash
      // attached to a verdict that never landed.
      return withTransaction(sql, async (tx) => {
        // Match recovery/approval lock order: document -> intent -> version.
        // The current version and every byte claim are checked under these locks.
        const [identity] = await tx<
          { document_id: string | null }[]
        >`select document_id from document_upload_intents where id=${intentId}`;
        if (!identity?.document_id) throw new Error("Document version is missing.");
        await tx`select id from documents where id=${identity.document_id} for update`;
        const [intent] = await tx<
          IntentRow[]
        >`select * from document_upload_intents where id=${intentId} for update`;
        const [version] = await tx<
          {
            id: string;
            declared_checksum_sha256: string | null;
            verified_checksum_sha256: string | null;
          }[]
        >`
          select id,declared_checksum_sha256,verified_checksum_sha256 from document_versions
          where intent_id=${intentId} and document_id=${identity.document_id} and superseded_by_version_id is null for update`;
        if (!version || (options.expectedVersionId && options.expectedVersionId !== version.id))
          throw new DocumentVersionConflictError("Document version changed or was superseded.");
        if (options.scanJobClaim) {
          const claim = options.scanJobClaim;
          const [job] = await tx<{ id: string }[]>`select id from document_scan_jobs
            where id=${claim.jobId} and intent_id=${intentId} and checksum_sha256=${intent.checksum_sha256}
              and document_version_id=${version.id} and status='processing' and attempt_count=${claim.attemptCount} for update`;
          if (!job) throw new Error("Scan claim or attempt changed.");
        }
        if (
          result.status === "clean" &&
          result.verifiedChecksum &&
          (options.verdictSource !== "provider" ||
            result.verifiedChecksum !== intent.checksum_sha256 ||
            result.verifiedChecksum !== version.declared_checksum_sha256 ||
            (version.verified_checksum_sha256 &&
              version.verified_checksum_sha256 !== result.verifiedChecksum))
        )
          throw new Error("Verified checksum disagrees with the received version.");
        if (
          result.status === "clean" &&
          result.documentVersionId &&
          result.documentVersionId !== version.id
        )
          throw new DocumentVersionConflictError("Scanner result version changed.");
        const bound =
          result.status === "clean" &&
          options.verdictSource === "provider" &&
          result.verifiedChecksum === intent.checksum_sha256 &&
          result.verifiedByteSize === Number(intent.expected_size_bytes) &&
          Number(intent.expected_size_bytes) > 0;
        // A verdict is only about the content it was computed over. If the intent
        // now carries a different checksum, this result is a late answer about
        // superseded bytes: it stays as job history and is never applied as the
        // current status. Matching on the checksum in the UPDATE keeps that check
        // and the write in one statement, so nothing can slip between them.
        const rows = await tx<IntentRow[]>`
        update document_upload_intents set status = ${status},
          scan_provider_reference = ${"providerReference" in result ? result.providerReference : null},
          scan_error_code = ${result.status === "failed" || result.status === "rejected" ? ("errorCode" in result ? result.errorCode : result.reason) : null},
          scan_verdict_source = ${options.verdictSource ?? null},
          scan_document_version_id = ${bound ? version.id : null},
          scanned_at = now(), updated_at = now(),
          -- A terminal verdict ends the retention obligation; a retryable failure
          -- leaves the file quarantined and keeps its window open.
          quarantine_retention_until = case
            when ${status} = 'quarantined' then quarantine_retention_until
            else null
          end
        where id = ${intentId}
          and status = any(${(options.allowStatuses ?? ["quarantined"]) as string[]}::text[])
          and (${options.expectedChecksum ?? null}::text is null
               or checksum_sha256 = ${options.expectedChecksum ?? null})
        returning *`;
        if (!rows[0]) throw new Error("Document is not quarantined.");

        // Only from a scanner that read the object. `is null` in the predicate
        // makes this write-once: a later verdict cannot quietly restate what the
        // bytes are underneath a decision already recorded against them.
        if (bound && result.status === "clean") {
          await tx`
          update document_versions
          set verified_checksum_sha256 = ${result.verifiedChecksum!},
            verified_byte_size = ${result.verifiedByteSize ?? null},
            verified_at = now()
          where id = ${version.id} and intent_id = ${intentId} and superseded_by_version_id is null
            and verified_checksum_sha256 is null`;
        }

        return mapIntent({ ...rows[0], current_version_id: version.id });
      });
    },
    reviewDocument(input) {
      return withTransaction(sql, async (tx) => {
        const [initial] = await documentRows({ id: input.documentId }, tx);
        if (!initial) throw new Error("Document not found.");
        if (!input.expectedVersionId || initial.current_version_id !== input.expectedVersionId)
          throw new DocumentVersionConflictError();
        const [staff] = await tx<
          {
            id: string;
            role: "Admin" | "Manager" | "Staff";
            team_id: string | null;
            auth_user_id: string;
          }[]
        >`
          select u.id,u.role,u.team_id,sp.auth_user_id from users u join staff_profiles sp on sp.user_id=u.id
          where u.id=${input.reviewerId} and u.active and sp.active and sp.role=u.role
            and sp.team_id is not distinct from u.team_id and u.role in ('Admin','Manager','Staff')
            and (${input.reviewerAuthUserId ?? null}::text is null or sp.auth_user_id=${input.reviewerAuthUserId ?? null})
          for share of u,sp`;
        if (!staff) throw new Error("Forbidden: current verified staff identity is required.");
        if (initial.case_id)
          await tx`select a.id from annual_return_cases a join companies c on c.id=a.company_id
          where a.id=${initial.case_id} and c.id=${initial.company_id} for share of a,c`;
        else await tx`select id from companies where id=${initial.company_id} for share`;
        const row = await lockRecoverySource(tx, input.documentId);
        if (
          !row ||
          row.current_version_id !== input.expectedVersionId ||
          row.company_id !== initial.company_id ||
          row.case_id !== initial.case_id
        )
          throw new DocumentVersionConflictError();
        if (availabilityOf(row) !== "available")
          throw new Error("Only current genuinely scanned documents may be reviewed.");
        const [scope] = await tx<
          AccessSubjectRow[]
        >`select c.id company_id,c.assigned_team_id,d.case_id,a.owner_id,a.reviewer_id
          from documents d join companies c on c.id=d.company_id
          left join annual_return_cases a on a.id=d.case_id and a.company_id=d.company_id
          where d.id=${input.documentId}`;
        assertStaffDocumentAccess(
          {
            userId: staff.id,
            authUserId: staff.auth_user_id,
            role: staff.role,
            teamId: staff.team_id,
            active: true,
          },
          mapAccessSubject(scope),
        );
        if (
          row.reviewed_document_version_id === row.current_version_id &&
          row.verification_status !== "pending"
        )
          throw new Error("Reviewed documents are immutable.");
        await tx`update documents set verification_status = ${input.decision}, verified_by = ${input.reviewerId}, verified_at = now(),reviewed_document_version_id=${row.current_version_id} where id = ${input.documentId}`;
        if (row.case_id) {
          await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${row.company_id}, ${row.case_id}, 'document_reviewed', 'user', ${input.reviewerId},
              ${`Document ${input.decision}.`},
              ${tx.json({
                documentId: input.documentId,
                documentVersionId: row.current_version_id,
                checksum: row.verified_checksum_sha256,
                decision: input.decision,
                reason: input.reason ?? null,
                previousReview: {
                  status: row.verification_status,
                  versionId: row.reviewed_document_version_id ?? null,
                },
              })}
            )
          `;
        }
        return {
          ...mapDocument(row),
          reviewStatus: input.decision,
          reviewedVersionId: row.current_version_id,
        };
      });
    },
    async expireUploads(now) {
      // 'quarantined' used to be in this list. It is the status a SUCCESSFULLY
      // RECEIVED file holds, and maintenance.ts deletes the R2 object for every
      // row this returns -- so a file uploaded at minute 14 had its bytes deleted
      // at minute 15, leaving an orphaned documents row that could never be
      // scanned (recordScanResult matches only 'quarantined') and never be read
      // (downloadDocumentForActor requires 'available'). Received evidence is now
      // governed by quarantine_retention_until, which escalates rather than
      // deletes. Never widen this predicate back.
      //
      // `document_id is null` is a second, independent guard on the same
      // invariant: a row with a document attached has received evidence, and a
      // lapsed expiry is not authority to delete that. It closes the window where
      // a sweep that read the row before a concurrent finalize committed could
      // still act on it -- the finalize sets document_id inside its own
      // transaction, so this predicate cannot see a half-finished one.
      const rows = await sql<IntentRow[]>`
        update document_upload_intents set status = 'expired', updated_at = now()
        where expires_at <= ${now}
          and status in ('created','uploaded')
          and document_id is null
        returning *`;
      return rows.map(mapIntent);
    },

    /**
     * Received files whose retention window has lapsed without a verdict.
     *
     * Deliberately a read, not a sweep: the caller escalates: it does not delete.
     * Losing evidence to a scanner outage is the exact failure this phase exists
     * to remove, so nothing here may take a destructive action.
     */
    async listStalledQuarantine(now, limit = 100) {
      const rows = await sql<IntentRow[]>`
        select * from document_upload_intents
        where status = 'quarantined'
          and quarantine_retention_until is not null
          and quarantine_retention_until <= ${now}
        order by quarantine_retention_until asc
        limit ${limit}`;
      return rows.map(mapIntent);
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
