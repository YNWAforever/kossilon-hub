import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { R2BucketLike } from "@/server/runtime-env";
import type { DocumentRepository, DocumentUploadIntent, PrivateDocument } from "./repository";
import type { DocumentScanner, DocumentStorage } from "./types";
import {
  createDocumentStorageForProviderMode,
  createDocumentUploadIntentForActor,
  documentFiltersForActor,
  downloadDocumentForActor,
  finalizeDocumentUploadForActor,
  listDocumentsForActor,
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
const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: "20000000-0000-0000-0000-000000000002",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};
const managerActor: AuthenticatedActor = {
  ...staffActor,
  authUserId: "manager-auth",
  userId: "20000000-0000-0000-0000-000000000003",
  role: "Manager",
};
const adminActor: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "20000000-0000-0000-0000-000000000004",
  role: "Admin",
  teamId: null,
  active: true,
};
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
  it("uses the singleton local bucket without touching live bindings in local mode", async () => {
    const liveBucket = {
      put: vi.fn(),
      get: vi.fn(),
      head: vi.fn(),
      delete: vi.fn(),
    } as unknown as R2BucketLike;
    const storage = createDocumentStorageForProviderMode("local", liveBucket);

    await storage.put({
      objectKey: "documents/local-provider-selection",
      body: new Uint8Array([1, 2, 3]),
      checksum: "c".repeat(64),
      contentType: "application/pdf",
      sizeBytes: 3,
    });

    expect(await storage.head("documents/local-provider-selection")).toEqual(
      expect.objectContaining({ checksum: "c".repeat(64) }),
    );
    expect(liveBucket.put).not.toHaveBeenCalled();
  });

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

describe("documentFiltersForActor", () => {
  it("does not restrict an admin", () => {
    expect(documentFiltersForActor(adminActor)).toEqual({});
  });

  it("scopes a manager to their team", () => {
    expect(documentFiltersForActor(managerActor)).toEqual({ teamId: managerActor.teamId });
  });

  it("scopes staff to their team", () => {
    expect(documentFiltersForActor(staffActor)).toEqual({ teamId: staffActor.teamId });
  });

  it("refuses an inactive actor", () => {
    expect(() => documentFiltersForActor({ ...staffActor, active: false })).toThrow(
      "Forbidden: inactive users cannot list documents.",
    );
  });

  it("refuses a client", () => {
    expect(() => documentFiltersForActor(actor)).toThrow("Forbidden: staff access is required.");
  });

  it("refuses a staff actor with no assigned team", () => {
    expect(() => documentFiltersForActor({ ...staffActor, teamId: null })).toThrow(
      "Forbidden: staff actor has no assigned team.",
    );
  });
});

describe("listDocumentsForActor", () => {
  it("narrows a staff actor's list to their own team", async () => {
    const deps = dependencies();

    await listDocumentsForActor(staffActor, {}, deps);

    expect(deps.repository.listDocuments).toHaveBeenCalledWith({ teamId: staffActor.teamId });
  });

  it("does not let a client-supplied filter widen a staff actor's scope", async () => {
    const deps = dependencies();

    await listDocumentsForActor(
      staffActor,
      { companyId: "10000000-0000-0000-0000-000000000099" },
      deps,
    );

    expect(deps.repository.listDocuments).toHaveBeenCalledWith({
      companyId: "10000000-0000-0000-0000-000000000099",
      teamId: staffActor.teamId,
    });
  });

  it("does not narrow an admin", async () => {
    const deps = dependencies();

    await listDocumentsForActor(adminActor, {}, deps);

    expect(deps.repository.listDocuments).toHaveBeenCalledWith({});
  });

  it("still requires a company ID and authorization for a client", async () => {
    const deps = dependencies();

    await expect(listDocumentsForActor(actor, {}, deps)).rejects.toThrow(
      "Client document lists require a company ID.",
    );

    await listDocumentsForActor(actor, { companyId }, deps);
    expect(deps.authorizeCompany).toHaveBeenCalledWith(actor, companyId);
    expect(deps.repository.listDocuments).toHaveBeenCalledWith({ companyId });
  });
});

/**
 * The intent caps the declared size at 10MB, but the upload body was only
 * `z.string().min(1)`. bytesFromBase64 decoded the whole string before
 * finalizeDocumentUploadForActor compared byteLength against the intent, so any
 * caller holding a valid intent could hand the Worker a several-hundred-megabyte
 * payload and exhaust its 128MB memory limit before the size check ever ran.
 */
describe("upload body size is bounded at the validator", () => {
  const source = readFileSync(new URL("./server-fns.ts", import.meta.url), "utf8");

  it("caps the encoded body length", () => {
    expect(source).toContain("MAX_UPLOAD_BASE64_LENGTH");
    expect(source).toContain("z.string().min(1).max(MAX_UPLOAD_BASE64_LENGTH)");
  });

  it("derives the cap from the same limit the intent enforces", () => {
    expect(source).toContain("const MAX_UPLOAD_BYTES = 10 * 1024 * 1024");
    expect(source).toContain("Math.ceil(MAX_UPLOAD_BYTES / 3) * 4");
    expect(source).toContain("sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES)");
  });

  it("rejects before decoding rather than after", () => {
    const validatorAt = source.indexOf("z.string().min(1).max(MAX_UPLOAD_BASE64_LENGTH)");
    const decodeAt = source.indexOf("bytesFromBase64(data.bodyBase64)");

    expect(validatorAt).toBeGreaterThan(-1);
    expect(decodeAt).toBeGreaterThan(validatorAt);
  });
});
