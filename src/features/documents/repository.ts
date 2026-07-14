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
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type DocumentScanResult,
  type DocumentStatus,
} from "./types";

export { DOCUMENT_CATEGORIES, type DocumentCategory } from "./types";

export type DocumentUploadIntent = {
  id: string;
  companyId: string;
  caseId: string | null;
  documentId: string | null;
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
  expiresAt: string;
};

export type PrivateDocument = {
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
  reviewStatus: "pending" | "verified" | "rejected";
  uploadedBy: string | null;
  uploadedAt: string;
};

export type DocumentUploadRequest = {
  category: DocumentCategory;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
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
  id: string;
  company_id: string;
  case_id: string | null;
  document_id: string | null;
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
  expires_at: string | Date;
};
type DocumentRow = {
  id: string;
  company_id: string;
  case_id: string | null;
  file_type: DocumentCategory;
  file_name: string;
  storage_url: string;
  verification_status: "pending" | "verified" | "rejected";
  uploaded_by: string | null;
  uploaded_at: string | Date;
  content_type: string;
  expected_size_bytes: string | number;
  checksum_sha256: string;
  upload_status: DocumentStatus;
};

function mapIntent(row: IntentRow): DocumentUploadIntent {
  return {
    id: row.id,
    companyId: row.company_id,
    caseId: row.case_id,
    documentId: row.document_id,
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
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

function mapDocument(row: DocumentRow): PrivateDocument {
  return {
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
    reviewStatus: row.verification_status,
    uploadedBy: row.uploaded_by,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
}

function withTransaction<T>(client: QueryClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in client ? (client.begin(fn) as Promise<T>) : fn(client);
}

export type DocumentRepository = {
  createUploadIntent(input: {
    companyId: string;
    caseId?: string;
    replacementDocumentId?: string;
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
  listDocuments(filters?: { companyId?: string; caseId?: string }): Promise<PrivateDocument[]>;
  recordScanResult(intentId: string, result: DocumentScanResult): Promise<DocumentUploadIntent>;
  reviewDocument(input: {
    documentId: string;
    reviewerId: string;
    decision: "verified" | "rejected";
    reason?: string;
  }): Promise<PrivateDocument>;
  expireUploads(now: string): Promise<DocumentUploadIntent[]>;
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
      ? await sql<IntentRow[]>`select * from document_upload_intents where id = ${id} for update`
      : await sql<IntentRow[]>`select * from document_upload_intents where id = ${id}`;
    return rows[0] ? mapIntent(rows[0]) : null;
  }

  async function documentRows(filters: { id?: string; companyId?: string; caseId?: string } = {}) {
    return sql<DocumentRow[]>`
      select d.*, i.content_type, i.expected_size_bytes, i.checksum_sha256, i.status upload_status
      from documents d join document_upload_intents i on i.document_id = d.id
      where (${filters.id ?? null}::uuid is null or d.id = ${filters.id ?? null})
        and (${filters.companyId ?? null}::uuid is null or d.company_id = ${filters.companyId ?? null})
        and (${filters.caseId ?? null}::uuid is null or d.case_id = ${filters.caseId ?? null})
      order by d.uploaded_at desc, d.id`;
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
        if (input.caseId) {
          const cases = await tx<{ company_id: string }[]>`
            select company_id from annual_return_cases where id = ${input.caseId} for update`;
          if (!cases[0] || cases[0].company_id !== input.companyId)
            throw new Error("Case does not belong to the company.");
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
          if (replaced[0].verification_status !== "rejected")
            throw new Error("Only rejected documents may be replaced.");
        }
        const accepted = await tx<{ id: string }[]>`
          select d.id from documents d join document_upload_intents i on i.document_id = d.id
          where d.company_id = ${input.companyId} and d.case_id is not distinct from ${input.caseId ?? null}
            and i.category = ${input.category} and d.verification_status = 'verified' limit 1 for update of d`;
        if (accepted[0]) throw new Error("Accepted documents are immutable.");
        const rows = await tx<IntentRow[]>`
          insert into document_upload_intents (
            company_id, case_id, requested_by_auth_user_id, category, file_name, content_type,
            expected_size_bytes, checksum_sha256, object_key, expires_at
          ) values (${input.companyId}, ${input.caseId ?? null}, ${input.requestedByAuthUserId},
            ${input.category}, ${input.fileName}, ${input.contentType}, ${input.expectedSizeBytes},
            ${input.checksum}, ${input.objectKey}, ${input.expiresAt}) returning *`;
        return mapIntent(rows[0]);
      });
    },
    getUploadIntent,
    finalizeUploadIntent(input) {
      return withTransaction(sql, async (tx) => {
        const intents = await tx<
          IntentRow[]
        >`select * from document_upload_intents where id = ${input.intentId} for update`;
        const intent = intents[0] ? mapIntent(intents[0]) : null;
        if (!intent) throw new Error("Upload intent not found.");
        if (intent.status !== "created") throw new Error("Upload intent cannot be finalized.");
        if (Date.parse(intent.expiresAt) <= Date.now()) throw new Error("Upload intent expired.");
        const documents = await tx<{ id: string }[]>`
          insert into documents (
            company_id, case_id, file_type, file_name, storage_url, upload_source,
            verification_status, uploaded_by
          ) values (${intent.companyId}, ${intent.caseId}, ${intent.category}, ${intent.fileName},
            ${intent.objectKey}, ${input.source}, 'pending', ${input.uploadedBy}) returning id`;
        const updated = await tx<IntentRow[]>`
          update document_upload_intents set document_id = ${documents[0].id}, status = 'quarantined',
            uploaded_at = now(), updated_at = now() where id = ${intent.id} returning *`;
        const rows = await tx<DocumentRow[]>`
          select d.*, i.content_type, i.expected_size_bytes, i.checksum_sha256, i.status upload_status
          from documents d join document_upload_intents i on i.document_id = d.id
          where d.id = ${documents[0].id}`;
        if (!updated[0] || !rows[0]) throw new Error("Unable to finalize document metadata.");
        return mapDocument(rows[0]);
      });
    },
    async getDocument(id) {
      const rows = await documentRows({ id });
      return rows[0] ? mapDocument(rows[0]) : null;
    },
    async listDocuments(filters = {}) {
      return (await documentRows(filters)).map(mapDocument);
    },
    async recordScanResult(intentId, result) {
      const status =
        result.status === "clean"
          ? "available"
          : result.status === "rejected"
            ? "rejected"
            : result.retryable
              ? "quarantined"
              : "failed";
      const rows = await sql<IntentRow[]>`
        update document_upload_intents set status = ${status},
          scan_provider_reference = ${"providerReference" in result ? result.providerReference : null},
          scan_error_code = ${result.status === "failed" || result.status === "rejected" ? ("errorCode" in result ? result.errorCode : result.reason) : null},
          scanned_at = now(), updated_at = now()
        where id = ${intentId} and status = 'quarantined' returning *`;
      if (!rows[0]) throw new Error("Document is not quarantined.");
      return mapIntent(rows[0]);
    },
    reviewDocument(input) {
      return withTransaction(sql, async (tx) => {
        const rows = await tx<DocumentRow[]>`
          select d.*, i.content_type, i.expected_size_bytes, i.checksum_sha256, i.status upload_status
          from documents d join document_upload_intents i on i.document_id = d.id
          where d.id = ${input.documentId} for update of d`;
        if (!rows[0]) throw new Error("Document not found.");
        if (rows[0].upload_status !== "available")
          throw new Error("Only available documents may be reviewed.");
        if (rows[0].verification_status !== "pending")
          throw new Error("Reviewed documents are immutable.");
        await tx`update documents set verification_status = ${input.decision}, verified_by = ${input.reviewerId}, verified_at = now() where id = ${input.documentId}`;
        if (rows[0].case_id) {
          await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${rows[0].company_id}, ${rows[0].case_id}, 'document_reviewed', 'user', ${input.reviewerId},
              ${`Document ${input.decision}.`},
              ${tx.json({ documentId: input.documentId, decision: input.decision, reason: input.reason ?? null })}
            )
          `;
        }
        return { ...mapDocument(rows[0]), reviewStatus: input.decision };
      });
    },
    async expireUploads(now) {
      const rows = await sql<IntentRow[]>`
        update document_upload_intents set status = 'expired', updated_at = now()
        where expires_at <= ${now} and status in ('created','uploaded','quarantined') returning *`;
      return rows.map(mapIntent);
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
