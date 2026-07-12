import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentRepository, DocumentUploadIntent, PrivateDocument } from "./repository";
import type { DocumentScanner, DocumentStorage } from "./types";
import {
  createDocumentUploadIntentForActor,
  downloadDocumentForActor,
  finalizeDocumentUploadForActor,
  scanQuarantinedDocumentForActor,
} from "./server-fns";

const actor: AuthenticatedActor = {
  authUserId: "client-auth",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};
const companyId = "10000000-0000-0000-0000-000000000001";
const intent: DocumentUploadIntent = {
  id: "30000000-0000-0000-0000-000000000001",
  companyId,
  caseId: "40000000-0000-0000-0000-000000000001",
  documentId: null,
  requestedByAuthUserId: actor.authUserId,
  category: "identity",
  fileName: "passport.pdf",
  contentType: "application/pdf",
  expectedSizeBytes: 4,
  checksum: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
  objectKey: "documents/opaque",
  status: "created",
  scanProviderReference: null,
  scanErrorCode: null,
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const document: PrivateDocument = {
  id: "50000000-0000-0000-0000-000000000001",
  companyId,
  caseId: intent.caseId,
  category: intent.category,
  fileName: intent.fileName,
  objectKey: intent.objectKey,
  contentType: intent.contentType,
  sizeBytes: intent.expectedSizeBytes,
  checksum: intent.checksum,
  uploadStatus: "quarantined",
  reviewStatus: "pending",
  uploadedBy: null,
  uploadedAt: "2026-07-12T00:00:00.000Z",
};

function dependencies(
  overrides: Partial<{
    repository: DocumentRepository;
    storage: DocumentStorage;
    scanner: DocumentScanner;
    authorizeCompany: (actor: AuthenticatedActor, companyId: string) => Promise<void>;
  }> = {},
) {
  return {
    repository: {
      createUploadIntent: vi.fn(async () => intent),
      getUploadIntent: vi.fn(async () => intent),
      finalizeUploadIntent: vi.fn(async () => document),
      getDocument: vi.fn(async () => document),
      listDocuments: vi.fn(async () => [document]),
      recordScanResult: vi.fn(async (_id, result) => ({
        ...intent,
        status:
          result.status === "clean"
            ? "available"
            : result.status === "rejected"
              ? "rejected"
              : "quarantined",
      })),
      reviewDocument: vi.fn(async () => document),
      expireUploads: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
    } as unknown as DocumentRepository,
    storage: {
      put: vi.fn(async () => ({
        objectKey: intent.objectKey,
        checksum: intent.checksum,
        contentType: intent.contentType,
        sizeBytes: 4,
      })),
      get: vi.fn(async () => ({ ...document, body: new Uint8Array([1, 2, 3, 4]).buffer })),
      head: vi.fn(async () => ({
        objectKey: intent.objectKey,
        checksum: intent.checksum,
        contentType: intent.contentType,
        sizeBytes: 4,
      })),
      delete: vi.fn(async () => undefined),
    } as DocumentStorage,
    scanner: {
      scan: vi.fn(async () => ({ status: "clean", providerReference: "clean-1" })),
    } as DocumentScanner,
    authorizeCompany: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("document server orchestration", () => {
  it("authorizes the target company before creating an opaque upload intent", async () => {
    const deps = dependencies();
    await createDocumentUploadIntentForActor(
      actor,
      {
        companyId,
        caseId: intent.caseId!,
        category: "identity",
        fileName: "passport.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
        checksum: intent.checksum,
      },
      deps,
    );

    expect(deps.authorizeCompany).toHaveBeenCalledWith(actor, companyId);
    expect(deps.repository.createUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: expect.stringMatching(/^documents\/[0-9a-f-]{36}$/) }),
    );
  });

  it("does not advance metadata when R2 upload fails", async () => {
    const deps = dependencies({
      storage: {
        ...dependencies().storage,
        put: vi.fn(async () => {
          throw new Error("R2 unavailable");
        }),
      },
    });

    await expect(
      finalizeDocumentUploadForActor(actor, intent.id, new Uint8Array([1, 2, 3, 4]), deps),
    ).rejects.toThrow("R2 unavailable");
    expect(deps.repository.finalizeUploadIntent).not.toHaveBeenCalled();
  });

  it("keeps quarantined documents unreadable", async () => {
    const deps = dependencies();
    await expect(downloadDocumentForActor(actor, document.id, deps)).rejects.toThrow(
      /quarantined|available/i,
    );
    expect(deps.storage.get).not.toHaveBeenCalled();
  });

  it("releases clean scans and deletes rejected objects before recording rejection", async () => {
    const cleanDeps = dependencies();
    vi.mocked(cleanDeps.repository.getUploadIntent).mockResolvedValue({
      ...intent,
      status: "quarantined",
    });
    await scanQuarantinedDocumentForActor(
      { ...actor, role: "Staff", userId: "20000000-0000-0000-0000-000000000001" },
      intent.id,
      cleanDeps,
    );
    expect(cleanDeps.repository.recordScanResult).toHaveBeenCalledWith(
      intent.id,
      expect.objectContaining({ status: "clean" }),
    );

    const rejectedDeps = dependencies({
      scanner: {
        scan: vi.fn(async () => ({
          status: "rejected" as const,
          reason: "infected",
          providerReference: "reject-1",
        })),
      },
    });
    vi.mocked(rejectedDeps.repository.getUploadIntent).mockResolvedValue({
      ...intent,
      status: "quarantined",
    });
    await scanQuarantinedDocumentForActor(
      { ...actor, role: "Staff", userId: "20000000-0000-0000-0000-000000000001" },
      intent.id,
      rejectedDeps,
    );
    expect(rejectedDeps.storage.delete).toHaveBeenCalledWith(intent.objectKey);
    expect(rejectedDeps.repository.recordScanResult).toHaveBeenCalledWith(
      intent.id,
      expect.objectContaining({ status: "rejected" }),
    );
  });
});
