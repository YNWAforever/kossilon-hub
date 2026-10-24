import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { SqlClient } from "@/server/db/client";
import {
  createDocumentRepository,
  type DocumentRepository,
  type DocumentUploadIntent,
  type PrivateDocument,
} from "./repository";
import {
  createDocumentUploadIntentForActor,
  finalizeDocumentUploadForActor,
  type DocumentOperationDependencies,
} from "./server-fns";

const actor: AuthenticatedActor = {
  authUserId: "UC150-client-A",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};
const companyId = "98d2f4c9-0150-4150-8150-000000000001";
const caseId = "98d2f4c9-0150-4150-8150-000000000002";
const checklistItemId = "98d2f4c9-0150-4150-8150-000000000003";
const versionId = "98d2f4c9-0150-4150-8150-000000000004";
const request = {
  companyId,
  caseId,
  checklistItemId,
  uploadRequestId: "98d2f4c9-0150-4150-8150-000000000005",
  category: "identity" as const,
  fileName: "UC150.pdf",
  contentType: "application/pdf",
  sizeBytes: 4,
  checksum: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
};
const bytes = new Uint8Array([1, 2, 3, 4]);
const intent: DocumentUploadIntent = {
  id: "98d2f4c9-0150-4150-8150-000000000006",
  companyId,
  caseId,
  checklistItemId,
  requestedByAuthUserId: actor.authUserId,
  category: request.category,
  fileName: request.fileName,
  contentType: request.contentType,
  expectedSizeBytes: 4,
  checksum: request.checksum,
  objectKey: "documents/UC150-opaque",
  status: "quarantined",
  documentId: "98d2f4c9-0150-4150-8150-000000000007",
  currentVersionId: versionId,
  scanProviderReference: null,
  scanErrorCode: null,
  scanVerdictSource: null,
  expiresAt: "2000-01-01T00:00:00Z",
  quarantineRetentionUntil: "2099-01-01T00:00:00Z",
};
const document: PrivateDocument = {
  id: intent.documentId!,
  companyId,
  caseId,
  currentVersionId: versionId,
  category: request.category,
  fileName: request.fileName,
  objectKey: intent.objectKey,
  contentType: request.contentType,
  sizeBytes: 4,
  checksum: request.checksum,
  uploadStatus: "quarantined",
  scanVerdictSource: null,
  reviewStatus: "pending",
  uploadedBy: null,
  uploadedAt: "2026-10-24T00:00:00Z",
};
const subject = { companyId, caseId, companyTeamId: null, caseOwnerId: null, caseReviewerId: null };
function dependencies(current: DocumentUploadIntent = { ...intent }) {
  return {
    repository: {
      createUploadIntent: vi.fn(async () => current),
      getUploadIntent: vi.fn(async () => current),
      getDocument: vi.fn(async () => ({ ...document, uploadStatus: current.status })),
      getCompanyAccessSubject: vi.fn(async () => subject),
      getIntentAccessSubject: vi.fn(async () => subject),
      finalizeUploadIntent: vi.fn(async () => document),
    } as unknown as DocumentRepository,
    storage: {
      put: vi.fn(async () => ({
        objectKey: intent.objectKey,
        checksum: request.checksum,
        contentType: request.contentType,
        sizeBytes: 4,
      })),
      get: vi.fn(),
      head: vi.fn(),
      delete: vi.fn(),
    },
    authorizeDocument: vi.fn(async () => undefined),
    createScanner: vi.fn(() => {
      throw Error("UC150 must not invoke a scanner");
    }),
  } satisfies DocumentOperationDependencies;
}

describe("UC150 upload retry orchestration (pure unit, no native providers)", () => {
  it("binds a stable opaque request key to the server actor, and keeps legacy requests additive", async () => {
    const d = dependencies();
    await createDocumentUploadIntentForActor(actor, request, d);
    await createDocumentUploadIntentForActor(actor, { ...request, fileName: "changed.pdf" }, d);
    await createDocumentUploadIntentForActor(
      { ...actor, authUserId: "UC150-client-B" },
      request,
      d,
    );
    const calls = vi.mocked(d.repository.createUploadIntent).mock.calls;
    expect(calls[0][0].objectKey).toBe(calls[1][0].objectKey);
    expect(calls[0][0].objectKey).not.toBe(calls[2][0].objectKey);
    expect(calls[0][0].objectKey).not.toContain(actor.authUserId);
    expect(calls[0][0].objectKey).not.toContain(request.uploadRequestId);
    const { uploadRequestId: _, ...legacy } = request;
    await createDocumentUploadIntentForActor(actor, legacy, d);
    await createDocumentUploadIntentForActor(actor, legacy, d);
    expect(calls[3][0].objectKey).not.toBe(calls[4][0].objectKey);
  });
  it("rejects malformed request IDs and combining recovery with a retry ID before writing", async () => {
    const d = dependencies();
    await expect(
      createDocumentUploadIntentForActor(actor, { ...request, uploadRequestId: "bad" }, d),
    ).rejects.toThrow();
    await expect(
      createDocumentUploadIntentForActor(
        { ...actor, role: "Admin", userId: versionId },
        {
          ...request,
          recovery: { documentId: document.id, expectedToken: "a".repeat(32), reason: "recovery" },
        },
        d,
      ),
    ).rejects.toThrow(/recovery|request/i);
    expect(d.repository.createUploadIntent).not.toHaveBeenCalled();
  });
  it.each(["quarantined", "available", "rejected", "failed", "uploaded"] as const)(
    "reads the committed %s receipt after intent expiry without any side effects",
    async (status) => {
      const d = dependencies({ ...intent, status });
      vi.mocked(d.repository.getDocument).mockResolvedValue({
        ...document,
        uploadStatus: status,
        reviewStatus: "rejected",
        reviewedVersionId: versionId,
      });
      const result = await finalizeDocumentUploadForActor(actor, intent.id, bytes, d);
      expect(result).toMatchObject({
        id: document.id,
        currentVersionId: versionId,
        uploadStatus: status,
        reviewStatus: "rejected",
      });
      expect(d.repository.getDocument).toHaveBeenCalledWith(document.id);
      expect(d.authorizeDocument).toHaveBeenCalled();
      expect(d.storage.put).not.toHaveBeenCalled();
      expect(d.repository.finalizeUploadIntent).not.toHaveBeenCalled();
      expect(d.createScanner).not.toHaveBeenCalled();
    },
  );
  it("revalidates bytes, current membership, inactive and other actor even on an already committed receipt", async () => {
    for (const body of [new Uint8Array([1]), new Uint8Array([4, 3, 2, 1])]) {
      const d = dependencies();
      await expect(finalizeDocumentUploadForActor(actor, intent.id, body, d)).rejects.toThrow(
        /size|checksum/i,
      );
      expect(d.storage.put).not.toHaveBeenCalled();
    }
    const revoked = dependencies();
    revoked.authorizeDocument.mockRejectedValue(Error("Forbidden: revoked membership"));
    await expect(finalizeDocumentUploadForActor(actor, intent.id, bytes, revoked)).rejects.toThrow(
      /revoked/,
    );
    for (const candidate of [
      { ...actor, active: false },
      { ...actor, authUserId: "another" },
      { ...actor, role: "Staff" as const, userId: versionId, authUserId: "staff-other" },
    ]) {
      const d = dependencies();
      await expect(finalizeDocumentUploadForActor(candidate, intent.id, bytes, d)).rejects.toThrow(
        /Forbidden/,
      );
      expect(d.repository.getDocument).not.toHaveBeenCalled();
      expect(d.storage.put).not.toHaveBeenCalled();
    }
  });
  it.each([
    { id: versionId },
    { companyId: versionId },
    { caseId: null },
    { category: "other" as const },
    { fileName: "other.pdf" },
    { contentType: "image/png" },
    { sizeBytes: 5 },
    { checksum: "a".repeat(64) },
    { objectKey: "another" },
    { currentVersionId: null },
    { currentVersionId: request.uploadRequestId },
    { uploadStatus: "available" as const },
  ])("refuses a conflicting committed document chain %j", async (override) => {
    const d = dependencies();
    vi.mocked(d.repository.getDocument).mockResolvedValue({ ...document, ...override });
    await expect(finalizeDocumentUploadForActor(actor, intent.id, bytes, d)).rejects.toThrow(
      /lineage|match|chain/i,
    );
    expect(d.storage.put).not.toHaveBeenCalled();
  });
  it("refuses missing receipt metadata and expired uncommitted attempts", async () => {
    const d = dependencies();
    vi.mocked(d.repository.getDocument).mockResolvedValue(null);
    await expect(finalizeDocumentUploadForActor(actor, intent.id, bytes, d)).rejects.toThrow(
      /lineage|missing|chain/i,
    );
    for (const current of [
      { ...intent, documentId: null },
      { ...intent, status: "created" as const, documentId: null },
    ]) {
      const absent = dependencies(current);
      await expect(
        finalizeDocumentUploadForActor(actor, intent.id, bytes, absent),
      ).rejects.toThrow();
      expect(absent.storage.put).not.toHaveBeenCalled();
    }
  });
  it("refuses a membership revoked during committed readback and never rewrites the receipt", async () => {
    const d = dependencies();
    d.authorizeDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Error("Forbidden: membership revoked during readback"));
    await expect(finalizeDocumentUploadForActor(actor, intent.id, bytes, d)).rejects.toThrow(
      /revoked during readback/,
    );
    expect(d.repository.getDocument).toHaveBeenCalledOnce();
    expect(d.storage.put).not.toHaveBeenCalled();
    expect(d.repository.finalizeUploadIntent).not.toHaveBeenCalled();
  });
  it("keeps first-finalize bytes in quarantine and does not eagerly scan", async () => {
    const d = dependencies({
      ...intent,
      status: "created",
      documentId: null,
      currentVersionId: null,
      expiresAt: "2099-01-01T00:00:00Z",
    });
    expect(await finalizeDocumentUploadForActor(actor, intent.id, bytes, d)).toEqual(document);
    expect(d.storage.put).toHaveBeenCalledOnce();
    expect(d.repository.finalizeUploadIntent).toHaveBeenCalledExactlyOnceWith({
      intentId: intent.id,
      uploadedBy: null,
      source: "client",
    });
    expect(d.createScanner).not.toHaveBeenCalled();
  });
  it("refuses metadata commit when authority is revoked while storage is pending", async () => {
    const d = dependencies({
      ...intent,
      status: "created",
      documentId: null,
      currentVersionId: null,
      expiresAt: "2099-01-01T00:00:00Z",
    });
    d.authorizeDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Error("Forbidden: membership revoked during storage"));
    await expect(finalizeDocumentUploadForActor(actor, intent.id, bytes, d)).rejects.toThrow(
      /revoked during storage/,
    );
    expect(d.storage.put).toHaveBeenCalledOnce();
    expect(d.repository.finalizeUploadIntent).not.toHaveBeenCalled();
  });
});

const row = {
  id: intent.id,
  company_id: companyId,
  case_id: caseId,
  checklist_item_id: checklistItemId,
  requested_by_auth_user_id: actor.authUserId,
  category: request.category,
  file_name: request.fileName,
  content_type: request.contentType,
  expected_size_bytes: 4,
  checksum_sha256: request.checksum,
  object_key: intent.objectKey,
  expires_at: intent.expiresAt,
  document_id: null as string | null,
  status: "created",
  scan_provider_reference: null,
  scan_error_code: null,
  scan_verdict_source: null,
  quarantine_retention_until: null,
  current_version_id: null as string | null,
};
const repoInput = {
  ...request,
  requestedByAuthUserId: actor.authUserId,
  expectedSizeBytes: 4,
  objectKey: intent.objectKey,
  expiresAt: "2099-01-01T00:00:00Z",
};
function memorySql(existing: object | null = null, savedDocument: object | null = null) {
  let saved = existing ? { ...row, ...existing } : null;
  const calls: string[] = [];
  const tag = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const q = parts.join("?").replace(/\s+/g, " ").trim();
    calls.push(q);
    if (q.startsWith("select company_id from annual_return_cases"))
      return [{ company_id: companyId }];
    if (q.startsWith("select case_id from annual_return_checklist_items"))
      return [{ case_id: caseId }];
    if (q.startsWith("insert into document_upload_intents")) {
      if (saved) {
        if (q.includes("on conflict")) return [];
        throw Error(
          "duplicate key value violates unique constraint document_upload_intents_object_key_key",
        );
      }
      saved = { ...row, expires_at: String(values[10]) };
      return [saved];
    }
    if (q.includes("from page d")) return savedDocument ? [savedDocument] : [];
    if (q.includes("from document_upload_intents")) return saved ? [saved] : [];
    throw Error(`Unexpected query (no unapproved writes in fake): ${q}`);
  });
  const sql = Object.assign(tag, { begin: async <T>(fn: (tx: unknown) => Promise<T>) => fn(sql) });
  return { repository: createDocumentRepository({ sql: sql as unknown as SqlClient }), calls };
}
describe("UC150 repository receipt policy with inert SQL fake", () => {
  it("returns the exact original expired-created intent after a duplicate request, without extending expiry", async () => {
    const { repository } = memorySql();
    const first = await repository.createUploadIntent({
      ...repoInput,
      expiresAt: intent.expiresAt,
    });
    const retry = await repository.createUploadIntent(repoInput);
    expect(retry).toEqual(first);
    expect(retry.expiresAt).toBe(new Date(intent.expiresAt).toISOString());
  });
  it.each([
    { requested_by_auth_user_id: "another" },
    { company_id: versionId },
    { case_id: null },
    { checklist_item_id: null },
    { category: "other" },
    { file_name: "other.pdf" },
    { content_type: "image/png" },
    { expected_size_bytes: 5 },
    { checksum_sha256: "a".repeat(64) },
    { is_recovery: true },
  ])("refuses a request key collision with different payload/recovery %j", async (override) => {
    const { repository } = memorySql(override);
    await expect(repository.createUploadIntent(repoInput)).rejects.toThrow(
      /match|recovery|request/i,
    );
  });
  it("returns committed metadata inside the case/intent lock without enqueueing or touching the receipt", async () => {
    const savedDocument = {
      id: document.id,
      company_id: companyId,
      case_id: caseId,
      file_type: request.category,
      file_name: request.fileName,
      storage_url: intent.objectKey,
      content_type: request.contentType,
      expected_size_bytes: 4,
      checksum_sha256: request.checksum,
      upload_status: "rejected",
      verification_status: "rejected",
      scan_verdict_source: "provider",
      current_version_id: versionId,
      reviewed_document_version_id: versionId,
      intent_id: intent.id,
      uploaded_by: null,
      uploaded_at: document.uploadedAt,
    };
    const { repository, calls } = memorySql(
      { document_id: document.id, status: "rejected", current_version_id: versionId },
      savedDocument,
    );
    expect(
      await repository.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: null,
        source: "client",
      }),
    ).toMatchObject({ id: document.id, reviewStatus: "rejected", currentVersionId: versionId });
    expect(
      calls.filter((q) => /\b(insert|update|delete)\s+(into|document|annual_return)/i.test(q)),
    ).toEqual([]);
    expect(calls.findIndex((q) => q.includes("annual_return_cases"))).toBeLessThan(
      calls.findIndex((q) => q.includes("for update of i")),
    );
  });
});
