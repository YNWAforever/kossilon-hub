import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ProviderMode } from "@/server/provider-mode";
import type { DocumentScannerConfig, R2BucketLike } from "@/server/runtime-env";
import {
  assertStaffDocumentAccess,
  documentScopeForStaffActor,
  type StaffDocumentScope,
  type DocumentAccessSubject,
} from "./authorization";
import { createLiveDocumentScanner } from "./live-scanner";
import { getLocalMemoryR2Bucket } from "./local-r2";
import type { DocumentRepository, DocumentRecoveryRequest } from "./repository";
import { assertDocumentServable, canApproveDocument, documentSafetyOf } from "./safety";
import { createDeterministicDocumentScanner } from "./scanner";
import { DOCUMENT_CATEGORIES, type DocumentStorage, type IdentifiedDocumentScanner } from "./types";
import { createDocumentStorage, createOpaqueDocumentKey } from "./storage";
import { DocumentVersionConflictError, withDocumentVersionConflict } from "./version-conflict";

export function createDocumentStorageForProviderMode(
  providerMode: ProviderMode,
  liveBucket?: R2BucketLike,
): DocumentStorage {
  if (providerMode === "local") {
    return createDocumentStorage(getLocalMemoryR2Bucket());
  }
  if (!liveBucket) throw new Error("Live document storage requires an R2 bucket.");
  return createDocumentStorage(liveBucket);
}

/**
 * The one place a scanner is chosen.
 *
 * `loadDefaultDocumentContext` used to call `createDeterministicDocumentScanner()`
 * unconditionally, including in live mode, so real malware was marked available.
 * Mirrors createDocumentStorageForProviderMode's shape above so the two cannot
 * drift apart.
 *
 * Live throws rather than falling back. A missing scanner has to block release,
 * never grant it, and a silent downgrade to a fixed-response scanner is exactly
 * the failure this function exists to make impossible.
 */
export function createDocumentScannerForProviderMode(
  providerMode: ProviderMode,
  options: { config?: DocumentScannerConfig | null; storage?: DocumentStorage } = {},
): IdentifiedDocumentScanner {
  if (providerMode === "live") {
    if (!options.config) {
      throw new Error(
        "Live document scanning requires DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_API_KEY.",
      );
    }
    if (!options.storage) throw new Error("Live document scanning requires document storage.");
    return createLiveDocumentScanner({ config: options.config, storage: options.storage });
  }
  // local and simulated both get the fixed-response scanner, and both record
  // 'deterministic' on every verdict, so a row written in either mode is
  // self-describing rather than something an auditor has to infer later.
  return createDeterministicDocumentScanner();
}

export type DocumentOperationDependencies = {
  repository: DocumentRepository;
  storage: DocumentStorage;
  /**
   * A factory, not an instance, and that is the whole point.
   *
   * This used to be built eagerly for every request. In live mode
   * createDocumentScannerForProviderMode throws with no config -- correctly, so
   * a missing scanner can never silently downgrade to the fixed-response one --
   * and DOCUMENT_SCANNER_* is unset under BLOCKED_INTEGRATION:
   * malware-scanner-provider. The throw happened before any handler body, so
   * createDocumentUploadIntent, finalizeDocumentUpload, listDocuments,
   * downloadDocument and reviewDocument all returned 500 in a live deployment.
   *
   * A blocked scanner must disable scanning, not the entire documents feature.
   * The identical mistake was already found and fixed on the cron path; see the
   * comment on createScanWorker in src/server/maintenance.ts. Deferring
   * construction means only the operation that genuinely needs a verdict is
   * refused.
   */
  createScanner(): IdentifiedDocumentScanner;
  /**
   * Replaces the old `authorizeCompany(actor, companyId)`, which for any
   * non-Client actor was exactly `assertStaffAccess` -- "is this an active staff
   * account", with no notion of which company. The subject carries the
   * authoritative team and case assignment, loaded server-side, so a by-ID
   * operation can no longer reach what the list would have hidden.
   */
  authorizeDocument(actor: AuthenticatedActor, subject: DocumentAccessSubject): Promise<void>;
};

const loadDefaultDocumentContext = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { requireActor, requireClientCompanyAccess },
    { createDocumentRepository },
    { getDocumentsBucketBinding, getDocumentScannerConfig },
    { currentProviderMode },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
    import("@/server/runtime-env"),
    import("@/server/provider-mode"),
  ]);
  const request = getRequest();
  const actor = await requireActor(request);
  const repository = createDocumentRepository();
  const providerMode = currentProviderMode();
  const storage = createDocumentStorageForProviderMode(
    providerMode,
    providerMode === "live" ? getDocumentsBucketBinding() : undefined,
  );
  return {
    actor,
    dependencies: {
      repository,
      storage,
      createScanner: () =>
        createDocumentScannerForProviderMode(providerMode, {
          config: providerMode === "live" ? getDocumentScannerConfig() : null,
          storage,
        }),
      authorizeDocument: async (candidate: AuthenticatedActor, subject: DocumentAccessSubject) => {
        // Re-read database authority even during a long storage/scan request.
        const current = await requireActor(request);
        if (
          !current.active ||
          current.authUserId !== candidate.authUserId ||
          current.userId !== candidate.userId ||
          current.role !== candidate.role ||
          current.teamId !== candidate.teamId
        )
          throw new Error("Forbidden: document actor authority changed; reload your session.");
        if (candidate.role === "Client") {
          // Membership is a database fact, so it stays with the request-scoped
          // resolver. A client's reach is their company list and nothing else --
          // team and case assignment are staff concepts.
          await requireClientCompanyAccess(request, subject.companyId);
          return;
        }
        assertStaffDocumentAccess(current, subject);
      },
    } satisfies DocumentOperationDependencies,
  };
});

/**
 * Resolve the authoritative scope of a document and authorize against it.
 *
 * The subject is always loaded here, never accepted from the caller: an
 * authorization check that trusts a client-supplied company or case id is not a
 * check. "Not found" is used for a missing row so a probe cannot distinguish an
 * id that does not exist from one the actor may not see.
 */
async function authorizeDocumentById(
  actor: AuthenticatedActor,
  documentId: string,
  dependencies: Pick<DocumentOperationDependencies, "repository" | "authorizeDocument">,
): Promise<void> {
  if (!actor.active) throw new Error("Forbidden: inactive users cannot access documents.");
  const subject = await dependencies.repository.getDocumentAccessSubject(documentId);
  if (!subject) throw new Error("Document not found.");
  await dependencies.authorizeDocument(actor, subject);
}

async function authorizeIntentById(
  actor: AuthenticatedActor,
  intentId: string,
  dependencies: Pick<DocumentOperationDependencies, "repository" | "authorizeDocument">,
): Promise<void> {
  if (!actor.active) throw new Error("Forbidden: inactive users cannot access documents.");
  const subject = await dependencies.repository.getIntentAccessSubject(intentId);
  if (!subject) throw new Error("Upload intent not found.");
  await dependencies.authorizeDocument(actor, subject);
}

async function authorizeCompanyScope(
  actor: AuthenticatedActor,
  input: { companyId: string; caseId?: string | null },
  dependencies: Pick<DocumentOperationDependencies, "repository" | "authorizeDocument">,
): Promise<void> {
  if (!actor.active) throw new Error("Forbidden: inactive users cannot access documents.");
  const subject = await dependencies.repository.getCompanyAccessSubject(
    input.companyId,
    input.caseId ?? null,
  );
  if (!subject) throw new Error("Company not found.");
  await dependencies.authorizeDocument(actor, subject);
}

async function withDefaultDocumentContext<T>(
  handler: (actor: AuthenticatedActor, dependencies: DocumentOperationDependencies) => Promise<T>,
): Promise<T> {
  const { actor, dependencies } = await loadDefaultDocumentContext();
  try {
    return await withDocumentVersionConflict(() => handler(actor, dependencies));
  } finally {
    await dependencies.repository.close();
  }
}

async function sha256Hex(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(body).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createDocumentUploadIntentForActor(
  actor: AuthenticatedActor,
  input: {
    companyId: string;
    caseId?: string;
    checklistItemId?: string;
    replacementDocumentId?: string;
    recovery?: DocumentRecoveryRequest;
    category: (typeof DOCUMENT_CATEGORIES)[number];
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
  },
  dependencies: DocumentOperationDependencies,
) {
  if (input.recovery) assertStaffAccess(actor);
  await authorizeCompanyScope(actor, input, dependencies);
  let recoveryObjectState: "missing" | undefined;
  let recoveryObjectObservedAt: string | undefined;
  if (input.recovery) {
    await authorizeDocumentById(actor, input.recovery.documentId, dependencies);
    const source = await dependencies.repository.getDocumentRecoveryPreview(
      input.recovery.documentId,
    );
    if (!source) throw new Error("Document not found.");
    if (source.availability === "available") {
      const observation = await inspectRecoveryObject(source.objectKey, dependencies.storage);
      if (observation.state === "unknown" || observation.state === "not_checked")
        throw new Error(
          "Object availability is unknown; obtain storage owner evidence before recovery.",
        );
      if (observation.state !== "missing")
        throw new Error("Object is present; review its evidence before recovery.");
      recoveryObjectState = "missing";
      recoveryObjectObservedAt = new Date().toISOString();
    }
  }
  return dependencies.repository.createUploadIntent({
    companyId: input.companyId,
    caseId: input.caseId,
    // Scoped against the case inside createUploadIntent's own transaction, so a
    // client-supplied item id from another company's case cannot satisfy this
    // one's requirement.
    checklistItemId: input.checklistItemId,
    replacementDocumentId: input.replacementDocumentId,
    recovery: input.recovery,
    recoveryApprovedBy: input.recovery ? actor.userId! : undefined,
    recoveryObjectState,
    recoveryObjectObservedAt,
    requestedByAuthUserId: actor.authUserId,
    category: input.category,
    fileName: input.fileName,
    contentType: input.contentType,
    expectedSizeBytes: input.sizeBytes,
    checksum: input.checksum,
    objectKey: createOpaqueDocumentKey(input),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
}

async function inspectRecoveryObject(objectKey: string, storage: DocumentStorage) {
  if (!storage.inspect) return { state: "not_checked" as const };
  try {
    return await storage.inspect(objectKey);
  } catch {
    return { state: "unknown" as const };
  }
}

export async function previewDocumentRecoveryForActor(
  actor: AuthenticatedActor,
  documentId: string,
  dependencies: DocumentOperationDependencies,
) {
  assertStaffAccess(actor);
  await authorizeDocumentById(actor, documentId, dependencies);
  const preview = await dependencies.repository.getDocumentRecoveryPreview(documentId);
  if (!preview) throw new Error("Document not found.");
  const { objectKey, ...publicPreview } = preview;
  const observation = await inspectRecoveryObject(objectKey, dependencies.storage);
  return {
    ...publicPreview,
    availability:
      observation.state === "missing" ? ("missing_object" as const) : publicPreview.availability,
    objectAvailability: observation.state,
  };
}

export async function finalizeDocumentUploadForActor(
  actor: AuthenticatedActor,
  intentId: string,
  body: Uint8Array,
  dependencies: DocumentOperationDependencies,
) {
  const intent = await dependencies.repository.getUploadIntent(intentId);
  if (!intent) throw new Error("Upload intent not found.");
  if (intent.status !== "created") throw new Error("Upload intent cannot be finalized.");
  if (Date.parse(intent.expiresAt) <= Date.now()) throw new Error("Upload intent expired.");
  await authorizeIntentById(actor, intentId, dependencies);
  if (actor.role === "Client" && intent.requestedByAuthUserId !== actor.authUserId) {
    throw new Error("Forbidden: upload intent belongs to another user.");
  }
  if (body.byteLength !== intent.expectedSizeBytes)
    throw new Error("Uploaded size does not match intent.");
  if ((await sha256Hex(body)) !== intent.checksum)
    throw new Error("Uploaded checksum does not match intent.");
  await dependencies.storage.put({
    objectKey: intent.objectKey,
    body,
    checksum: intent.checksum,
    contentType: intent.contentType,
    sizeBytes: intent.expectedSizeBytes,
  });
  return dependencies.repository.finalizeUploadIntent({
    intentId,
    uploadedBy: actor.userId,
    source: actor.role === "Client" ? "client" : "staff",
  });
}

export async function scanQuarantinedDocumentForActor(
  actor: AuthenticatedActor,
  intentId: string,
  dependencies: DocumentOperationDependencies,
) {
  // Was `assertStaffAccess(actor)` and nothing else: any active staff account
  // could drive any company's scan lifecycle by passing an intent id.
  await authorizeIntentById(actor, intentId, dependencies);
  const intent = await dependencies.repository.getUploadIntent(intentId);
  if (!intent) throw new Error("Upload intent not found.");
  if (intent.status !== "quarantined") throw new Error("Document is not quarantined.");
  if (!intent.currentVersionId) throw new Error("Document version is missing; review its lineage.");
  const stored = await dependencies.storage.head(intent.objectKey);
  if (
    !stored ||
    stored.checksum !== intent.checksum ||
    stored.sizeBytes !== intent.expectedSizeBytes ||
    stored.contentType !== intent.contentType
  ) {
    throw new Error("Stored object metadata does not match the upload intent.");
  }
  // Built here, so a deployment with no scanner refuses this operation and only
  // this one.
  const scanner = dependencies.createScanner();
  const result = await scanner.scan({
    documentVersionId: intent.currentVersionId,
    objectKey: intent.objectKey,
    checksum: intent.checksum,
    contentType: intent.contentType,
    fileName: intent.fileName,
  });
  // The verdict records which scanner produced it, and is applied only while the
  // intent still carries the checksum that was scanned -- a late answer about
  // superseded bytes is history, never a current status.
  return dependencies.repository.recordScanResult(intent.id, result, {
    verdictSource: scanner.verdictSource,
    expectedChecksum: intent.checksum,
    expectedVersionId: intent.currentVersionId,
  });
}

export async function downloadDocumentForActor(
  actor: AuthenticatedActor,
  documentId: string,
  dependencies: DocumentOperationDependencies,
  expectedVersionId?: string,
) {
  const document = await dependencies.repository.getDocument(documentId);
  if (!document) throw new Error("Document not found.");
  await authorizeDocumentById(actor, documentId, dependencies);
  if (expectedVersionId && document.currentVersionId !== expectedVersionId)
    throw new DocumentVersionConflictError("Document version changed; reload the current proof.");
  // Scan safety, not business review status. A pending-review document that a
  // real scanner passed is exactly what a reviewer must be able to open; a
  // document whose only "clean" came from the deterministic test scanner is not
  // safe to serve however long ago it was approved.
  assertDocumentServable(actor, documentSafetyOf(document));
  if (
    !document.currentVersionId ||
    document.scannedVersionId !== document.currentVersionId ||
    document.verifiedChecksum !== document.checksum
  )
    throw new Error("Document scan is not bound to the current version checksum.");
  const stored = await dependencies.storage.get(document.objectKey);
  if (!stored) throw new Error("Authorized document object was not found.");
  if (
    stored.checksum !== document.checksum ||
    stored.sizeBytes !== document.sizeBytes ||
    stored.body.byteLength !== document.sizeBytes ||
    stored.contentType !== document.contentType
  ) {
    throw new Error("Stored object metadata does not match document metadata.");
  }
  const hash = await crypto.subtle.digest("SHA-256", stored.body);
  const checksum = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (checksum !== document.verifiedChecksum) throw new Error("Stored document checksum changed.");
  // Re-authorize and re-read after asynchronous storage work. A replaced version
  // or revoked membership never returns the old content to the caller.
  await authorizeDocumentById(actor, documentId, dependencies);
  const current = await dependencies.repository.getDocument(documentId);
  if (
    !current ||
    current.currentVersionId !== document.currentVersionId ||
    current.scannedVersionId !== document.currentVersionId ||
    current.checksum !== checksum ||
    current.verifiedChecksum !== checksum ||
    current.objectKey !== document.objectKey
  )
    throw new DocumentVersionConflictError("Document version changed; reload the current proof.");
  assertDocumentServable(actor, documentSafetyOf(current));
  return { document, body: stored.body };
}

export type DocumentScope = StaffDocumentScope;

export function documentFiltersForActor(actor: AuthenticatedActor): DocumentScope {
  return documentScopeForStaffActor(actor);
}

export async function listDocumentsForActor(
  actor: AuthenticatedActor,
  filters: { companyId?: string; caseId?: string },
  dependencies: Pick<DocumentOperationDependencies, "repository" | "authorizeDocument">,
) {
  if (!actor.active) throw new Error("Forbidden: inactive users cannot list documents.");
  if (actor.role === "Client") {
    if (!filters.companyId) throw new Error("Client document lists require a company ID.");
    await authorizeCompanyScope(actor, { companyId: filters.companyId }, dependencies);
    return dependencies.repository.listDocuments(filters);
  }

  const scope = documentFiltersForActor(actor);
  return dependencies.repository.listDocuments({ ...filters, ...scope });
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The declared size is capped on the intent, but the upload body was only
 * `z.string().min(1)` — unbounded. bytesFromBase64 decoded the whole thing before
 * finalizeDocumentUploadForActor compared byteLength to the intent, so a caller
 * with any valid intent could hand the Worker a several-hundred-megabyte string
 * and OOM it against the 128MB limit before the size check ever ran.
 *
 * Bounding the encoded length rejects that at the validator, ahead of any
 * allocation. 4 characters per 3 bytes, plus padding.
 */
const MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;

const createIntentSchema = z
  .object({
    companyId: z.string().uuid(),
    caseId: z.string().uuid().optional(),
    checklistItemId: z.string().uuid().optional(),
    replacementDocumentId: z.string().uuid().optional(),
    recovery: z
      .object({
        documentId: z.string().uuid(),
        expectedToken: z.string().regex(/^[0-9a-f]{32}$/),
        reason: z.string().trim().min(1).max(500),
      })
      .strict()
      .optional(),
    category: z.enum(DOCUMENT_CATEGORIES),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const intentIdSchema = z.object({ intentId: z.string().uuid() }).strict();
const documentIdSchema = z.object({ documentId: z.string().uuid() }).strict();

export const previewDocumentRecovery = createServerFn({ method: "GET" })
  .validator(documentIdSchema)
  .handler(({ data }) =>
    withDefaultDocumentContext((actor, dependencies) =>
      previewDocumentRecoveryForActor(actor, data.documentId, dependencies),
    ),
  );

export const createDocumentUploadIntent = createServerFn({ method: "POST" })
  .validator(createIntentSchema)
  .handler(({ data }) =>
    withDefaultDocumentContext((actor, dependencies) =>
      createDocumentUploadIntentForActor(actor, data, dependencies),
    ),
  );

export const finalizeDocumentUpload = createServerFn({ method: "POST" })
  .validator(
    intentIdSchema.extend({ bodyBase64: z.string().min(1).max(MAX_UPLOAD_BASE64_LENGTH) }).strict(),
  )
  .handler(({ data }) =>
    withDefaultDocumentContext((actor, dependencies) =>
      finalizeDocumentUploadForActor(
        actor,
        data.intentId,
        bytesFromBase64(data.bodyBase64),
        dependencies,
      ),
    ),
  );

export const scanQuarantinedDocument = createServerFn({ method: "POST" })
  .validator(intentIdSchema)
  .handler(({ data }) =>
    withDefaultDocumentContext((actor, dependencies) =>
      scanQuarantinedDocumentForActor(actor, data.intentId, dependencies),
    ),
  );

export const downloadDocument = createServerFn({ method: "GET" })
  .validator(
    z
      .object({ documentId: z.string().uuid(), expectedVersionId: z.string().uuid().optional() })
      .strict(),
  )
  .handler(({ data }) =>
    withDefaultDocumentContext(async (actor, dependencies) => {
      const { document, body } = await downloadDocumentForActor(
        actor,
        data.documentId,
        dependencies,
        data.expectedVersionId,
      );
      return new Response(body, {
        headers: {
          "content-type": document.contentType,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
          "cache-control": "private, no-store",
        },
      });
    }),
  );

export const listDocuments = createServerFn({ method: "GET" })
  .validator(
    z
      .object({ companyId: z.string().uuid().optional(), caseId: z.string().uuid().optional() })
      .strict(),
  )
  .handler(({ data }) =>
    withDefaultDocumentContext((actor, dependencies) =>
      listDocumentsForActor(actor, data, dependencies),
    ),
  );

export const reviewDocument = createServerFn({ method: "POST" })
  .validator(
    documentIdSchema
      .extend({
        expectedVersionId: z.string().uuid(),
        decision: z.enum(["verified", "rejected"]),
        reason: z.string().trim().max(500).optional(),
      })
      .strict(),
  )
  .handler(({ data }) =>
    withDefaultDocumentContext(async (actor, dependencies) => {
      const staff = assertStaffAccess(actor);
      const document = await dependencies.repository.getDocument(data.documentId);
      if (!document) throw new Error("Document not found.");
      // Was `assertStaffAccess` plus a company check that, for staff, was the
      // same assertStaffAccess again: any active staff account could approve or
      // reject another team's evidence and be recorded as its reviewer.
      await authorizeDocumentById(actor, data.documentId, dependencies);
      // An approval is what later releases a file to a client and into a filing
      // package, so it requires genuine scan evidence. A verdict from the
      // deterministic test scanner is not evidence, however long ago it landed.
      if (!canApproveDocument(documentSafetyOf(document))) {
        throw new Error(
          "Document safety is unverified, so it cannot be approved or rejected until a genuine scan completes.",
        );
      }
      return dependencies.repository.reviewDocument({
        documentId: data.documentId,
        expectedVersionId: data.expectedVersionId,
        reviewerId: staff.userId!,
        reviewerAuthUserId: staff.authUserId,
        decision: data.decision,
        reason: data.reason,
      });
    }),
  );

export const cleanupExpiredUploads = createServerFn({ method: "POST" })
  .validator(z.object({ now: z.string().datetime() }).strict())
  .handler(({ data }) =>
    withDefaultDocumentContext(async (actor, dependencies) => {
      const staff = assertStaffAccess(actor);
      if (staff.role !== "Admin") throw new Error("Forbidden: Admin access is required.");
      const expired = await dependencies.repository.expireUploads(data.now);
      await Promise.all(
        expired.map((candidate) => dependencies.storage.delete(candidate.objectKey)),
      );
      return { expired: expired.length };
    }),
  );
