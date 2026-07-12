import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentRepository } from "./repository";
import { DOCUMENT_CATEGORIES, type DocumentScanner, type DocumentStorage } from "./types";
import { createOpaqueDocumentKey } from "./storage";

export type DocumentOperationDependencies = {
  repository: DocumentRepository;
  storage: DocumentStorage;
  scanner: DocumentScanner;
  authorizeCompany(actor: AuthenticatedActor, companyId: string): Promise<void>;
};

const loadDefaultDocumentContext = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { requireActor, requireClientCompanyAccess },
    { createDocumentRepository },
    { createDocumentStorage },
    { createDeterministicDocumentScanner },
    { getFirmRuntimeEnv },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
    import("./storage"),
    import("./scanner"),
    import("@/server/runtime-env"),
  ]);
  const request = getRequest();
  const actor = await requireActor(request);
  const repository = createDocumentRepository();
  const storage = createDocumentStorage(getFirmRuntimeEnv().documentsBucket);
  return {
    actor,
    dependencies: {
      repository,
      storage,
      scanner: createDeterministicDocumentScanner(),
      authorizeCompany: async (candidate: AuthenticatedActor, companyId: string) => {
        if (candidate.role === "Client") {
          await requireClientCompanyAccess(request, companyId);
          return;
        }
        assertStaffAccess(candidate);
      },
    } satisfies DocumentOperationDependencies,
  };
});

async function withDefaultDocumentContext<T>(
  handler: (actor: AuthenticatedActor, dependencies: DocumentOperationDependencies) => Promise<T>,
): Promise<T> {
  const { actor, dependencies } = await loadDefaultDocumentContext();
  try {
    return await handler(actor, dependencies);
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
    replacementDocumentId?: string;
    category: (typeof DOCUMENT_CATEGORIES)[number];
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
  },
  dependencies: DocumentOperationDependencies,
) {
  await dependencies.authorizeCompany(actor, input.companyId);
  return dependencies.repository.createUploadIntent({
    companyId: input.companyId,
    caseId: input.caseId,
    replacementDocumentId: input.replacementDocumentId,
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
  await dependencies.authorizeCompany(actor, intent.companyId);
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
  assertStaffAccess(actor);
  const intent = await dependencies.repository.getUploadIntent(intentId);
  if (!intent) throw new Error("Upload intent not found.");
  if (intent.status !== "quarantined") throw new Error("Document is not quarantined.");
  const stored = await dependencies.storage.head(intent.objectKey);
  if (
    !stored ||
    stored.checksum !== intent.checksum ||
    stored.sizeBytes !== intent.expectedSizeBytes ||
    stored.contentType !== intent.contentType
  ) {
    throw new Error("Stored object metadata does not match the upload intent.");
  }
  const result = await dependencies.scanner.scan({
    objectKey: intent.objectKey,
    checksum: intent.checksum,
    contentType: intent.contentType,
  });
  if (result.status === "rejected") await dependencies.storage.delete(intent.objectKey);
  return dependencies.repository.recordScanResult(intent.id, result);
}

export async function downloadDocumentForActor(
  actor: AuthenticatedActor,
  documentId: string,
  dependencies: DocumentOperationDependencies,
) {
  const document = await dependencies.repository.getDocument(documentId);
  if (!document) throw new Error("Document not found.");
  await dependencies.authorizeCompany(actor, document.companyId);
  if (document.uploadStatus !== "available") {
    throw new Error("Document is quarantined or otherwise unavailable.");
  }
  const stored = await dependencies.storage.get(document.objectKey);
  if (!stored) throw new Error("Authorized document object was not found.");
  if (stored.checksum !== document.checksum || stored.sizeBytes !== document.sizeBytes) {
    throw new Error("Stored object metadata does not match document metadata.");
  }
  return { document, body: stored.body };
}

const createIntentSchema = z
  .object({
    companyId: z.string().uuid(),
    caseId: z.string().uuid().optional(),
    replacementDocumentId: z.string().uuid().optional(),
    category: z.enum(DOCUMENT_CATEGORIES),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(120),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const intentIdSchema = z.object({ intentId: z.string().uuid() }).strict();
const documentIdSchema = z.object({ documentId: z.string().uuid() }).strict();

export const createDocumentUploadIntent = createServerFn({ method: "POST" })
  .validator(createIntentSchema)
  .handler(({ data }) =>
    withDefaultDocumentContext((actor, dependencies) =>
      createDocumentUploadIntentForActor(actor, data, dependencies),
    ),
  );

export const finalizeDocumentUpload = createServerFn({ method: "POST" })
  .validator(intentIdSchema.extend({ bodyBase64: z.string().min(1) }).strict())
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
  .validator(documentIdSchema)
  .handler(({ data }) =>
    withDefaultDocumentContext(async (actor, dependencies) => {
      const { document, body } = await downloadDocumentForActor(
        actor,
        data.documentId,
        dependencies,
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
    withDefaultDocumentContext(async (actor, dependencies) => {
      if (actor.role === "Client") {
        if (!data.companyId) throw new Error("Client document lists require a company ID.");
        await dependencies.authorizeCompany(actor, data.companyId);
      } else {
        assertStaffAccess(actor);
      }
      return dependencies.repository.listDocuments(data);
    }),
  );

export const reviewDocument = createServerFn({ method: "POST" })
  .validator(
    documentIdSchema
      .extend({
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
      await dependencies.authorizeCompany(actor, document.companyId);
      return dependencies.repository.reviewDocument({
        documentId: data.documentId,
        reviewerId: staff.userId!,
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
