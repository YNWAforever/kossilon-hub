import "dotenv/config";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createLiveDocumentScanner } from "./live-scanner";
import {
  createDocumentRepository,
  type DocumentRepository,
  type DocumentUploadIntent,
  type PrivateDocument,
} from "./repository";
import { downloadDocumentForActor, finalizeDocumentUploadForActor } from "./server-fns";
import type { DocumentStorage } from "./types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const PREFIX = "documents/t12-lifecycle/";
const body = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}
const actor: AuthenticatedActor = {
  authUserId: "t12-client",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};
const staff: AuthenticatedActor = {
  authUserId: "t12-staff",
  userId: "20000000-0000-4000-8000-000000000001",
  role: "Staff",
  teamId: "10000000-0000-4000-8000-000000000001",
  active: true,
};
function intent(checksum: string): DocumentUploadIntent {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    companyId: "10000000-0000-4000-8000-000000000001",
    caseId: null,
    documentId: null,
    checklistItemId: null,
    requestedByAuthUserId: actor.authUserId,
    category: "identity",
    fileName: "sample.pdf",
    contentType: "application/pdf",
    expectedSizeBytes: body.byteLength,
    checksum,
    objectKey: `${PREFIX}sample`,
    status: "created",
    scanProviderReference: null,
    scanErrorCode: null,
    scanVerdictSource: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    quarantineRetentionUntil: null,
  };
}
function document(checksum: string): PrivateDocument {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    companyId: "10000000-0000-4000-8000-000000000001",
    caseId: null,
    category: "identity",
    fileName: "sample.pdf",
    objectKey: `${PREFIX}sample`,
    contentType: "application/pdf",
    sizeBytes: body.byteLength,
    checksum,
    uploadStatus: "available",
    scanVerdictSource: "provider",
    reviewStatus: "pending",
    uploadedBy: null,
    uploadedAt: "2026-09-27T00:00:00.000Z",
    verifiedChecksum: checksum,
    verifiedByteSize: body.byteLength,
    currentVersionId: "60000000-0000-4000-8000-000000000001",
    versionNumber: 1,
  };
}
function deps(
  checksum: string,
  overrides: {
    storedBody?: Uint8Array;
    authorize?: (candidate: AuthenticatedActor) => Promise<void>;
    uploadIntent?: DocumentUploadIntent;
  } = {},
) {
  const selected = overrides.uploadIntent ?? intent(checksum);
  const selectedDocument = document(checksum);
  const storedBody = overrides.storedBody ?? body;
  const repository = {
    getUploadIntent: vi.fn(async () => selected),
    getDocument: vi.fn(async () => selectedDocument),
    getIntentAccessSubject: vi.fn(async () => ({
      companyId: selected.companyId,
      companyTeamId: staff.teamId,
      caseId: null,
      caseOwnerId: null,
      caseReviewerId: null,
    })),
    getDocumentAccessSubject: vi.fn(async () => ({
      companyId: selected.companyId,
      companyTeamId: staff.teamId,
      caseId: null,
      caseOwnerId: null,
      caseReviewerId: null,
    })),
    finalizeUploadIntent: vi.fn(async () => selectedDocument),
  } as unknown as DocumentRepository;
  const storage: DocumentStorage = {
    put: vi.fn(async () => ({
      objectKey: selected.objectKey,
      checksum,
      contentType: "application/pdf",
      sizeBytes: body.byteLength,
    })),
    get: vi.fn(async () => ({
      objectKey: selected.objectKey,
      checksum,
      contentType: "application/pdf",
      sizeBytes: body.byteLength,
      body: Uint8Array.from(storedBody).buffer,
    })),
    head: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
  return {
    repository,
    storage,
    createScanner: vi.fn(),
    authorizeDocument: vi.fn(overrides.authorize ?? (async () => undefined)),
  };
}

let sql: SqlClient | undefined;
function testSql(): SqlClient {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
  sql ??= createSqlClient(databaseUrl, { max: 2 });
  return sql;
}
afterEach(async () => {
  if (!sql) return;
  const owned = await sql<
    { document_id: string }[]
  >`select document_id from document_upload_intents where object_key like ${PREFIX + "%"} and document_id is not null`;
  await sql`delete from document_analysis_jobs where document_version_id in (select id from document_versions where intent_id in (select id from document_upload_intents where object_key like ${PREFIX + "%"}))`;
  await sql`delete from document_versions where intent_id in (select id from document_upload_intents where object_key like ${PREFIX + "%"})`;
  await sql`delete from document_scan_jobs where intent_id in (select id from document_upload_intents where object_key like ${PREFIX + "%"})`;
  await sql`delete from document_upload_intents where object_key like ${PREFIX + "%"}`;
  if (owned.length)
    await sql`delete from documents where id = any(${owned.map((row) => row.document_id)}::uuid[])`;
});
afterAll(async () => {
  if (sql) await sql.end();
});

describe("T12 document lifecycle", () => {
  it("t12_scenario_1 rejects fake PDF bytes before a scanner can declare them clean", async () => {
    const fake = new TextEncoder().encode("plain text masquerading as a PDF");
    const checksum = await digest(fake);
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ verdict: "clean", reference: "fixture" }), { status: 200 }),
    );
    const scanner = createLiveDocumentScanner({
      config: { endpoint: "https://scanner.example.test/scan", apiKey: "test" },
      storage: {
        ...deps(checksum).storage,
        get: vi.fn(async () => ({
          objectKey: `${PREFIX}fake`,
          checksum,
          contentType: "application/pdf",
          sizeBytes: fake.byteLength,
          body: fake.buffer,
        })),
      },
      fetchImpl,
    });
    await expect(
      scanner.scan({
        objectKey: `${PREFIX}fake`,
        checksum,
        contentType: "application/pdf",
        fileName: "fake.pdf",
      }),
    ).resolves.toEqual({ status: "failed", retryable: false, errorCode: "content-mime-mismatch" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("t12_scenario_1 leaves an upload intent unfinalized when stored bytes differ from the supplied body", async () => {
    const checksum = await digest(body);
    const dependencies = deps(checksum, { storedBody: new Uint8Array(body.byteLength).fill(65) });
    await expect(
      finalizeDocumentUploadForActor(actor, intent(checksum).id, body, dependencies),
    ).rejects.toThrow(/Stored upload bytes/);
    expect(dependencies.repository.finalizeUploadIntent).not.toHaveBeenCalled();
  });

  it.skipIf(!databaseUrl)(
    "t12_scenario_1 keeps a provider clean verdict without stored-byte identity quarantined",
    async () => {
      const db = testSql();
      const company = await db<
        { id: string }[]
      >`select id from companies order by created_at limit 1`;
      const repository = createDocumentRepository({ sql: db });
      const upload = await repository.createUploadIntent({
        companyId: company[0].id,
        requestedByAuthUserId: "t12-fixture",
        category: "identity",
        fileName: "sample.pdf",
        contentType: "application/pdf",
        expectedSizeBytes: body.byteLength,
        checksum: await digest(body),
        objectKey: `${PREFIX}${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      });
      await repository.finalizeUploadIntent({
        intentId: upload.id,
        uploadedBy: null,
        source: "client",
      });
      await expect(
        repository.recordScanResult(
          upload.id,
          { status: "clean", providerReference: "missing-identity" },
          { verdictSource: "provider", expectedChecksum: upload.checksum },
        ),
      ).rejects.toThrow(/verified.*identity|checksum/i);
      expect((await repository.getUploadIntent(upload.id))?.status).toBe("quarantined");
    },
  );

  it.skipIf(!databaseUrl)(
    "t12_scenario_2 refuses a stale version and never inherits an earlier approval",
    async () => {
      const db = testSql();
      const company = await db<
        { id: string }[]
      >`select id from companies order by created_at limit 1`;
      const user = await db<{ id: string }[]>`select id from users order by created_at limit 1`;
      const repository = createDocumentRepository({ sql: db });
      const checksum = await digest(body);
      const input = {
        companyId: company[0].id,
        requestedByAuthUserId: "t12-fixture",
        category: "identity" as const,
        fileName: "sample.pdf",
        contentType: "application/pdf",
        expectedSizeBytes: body.byteLength,
        checksum,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      };
      const first = await repository.createUploadIntent({
        ...input,
        objectKey: `${PREFIX}${crypto.randomUUID()}`,
      });
      const firstDocument = await repository.finalizeUploadIntent({
        intentId: first.id,
        uploadedBy: null,
        source: "client",
      });
      await repository.recordScanResult(
        first.id,
        {
          status: "clean",
          providerReference: "fixture-provider",
          verifiedChecksum: checksum,
          verifiedByteSize: body.byteLength,
        },
        { verdictSource: "provider", expectedChecksum: checksum },
      );
      await expect(
        repository.reviewDocument({
          documentId: firstDocument.id,
          reviewerId: user[0].id,
          decision: "verified",
          expectedVersion: 2,
        }),
      ).rejects.toThrow(/version/i);
      expect((await repository.getDocument(firstDocument.id))?.reviewStatus).toBe("pending");
      await repository.reviewDocument({
        documentId: firstDocument.id,
        reviewerId: user[0].id,
        decision: "verified",
        expectedVersion: 1,
      });
      const second = await repository.createUploadIntent({
        ...input,
        objectKey: `${PREFIX}${crypto.randomUUID()}`,
      });
      const secondDocument = await repository.finalizeUploadIntent({
        intentId: second.id,
        uploadedBy: null,
        source: "client",
      });
      expect(secondDocument.id).not.toBe(firstDocument.id);
      expect((await repository.getDocument(firstDocument.id))?.reviewStatus).toBe("verified");
      expect((await repository.getDocument(secondDocument.id))?.reviewStatus).toBe("pending");
    },
  );

  it("t12_scenario_3 denies another client's file, expired uploads and altered download bytes", async () => {
    const checksum = await digest(body);
    const otherClient = deps(checksum, {
      authorize: async () => {
        throw new Error("Forbidden: wrong company");
      },
    });
    await expect(
      downloadDocumentForActor(actor, document(checksum).id, otherClient),
    ).rejects.toThrow(/Forbidden/);
    expect(otherClient.storage.get).not.toHaveBeenCalled();

    const expired = deps(checksum, {
      uploadIntent: { ...intent(checksum), expiresAt: "2020-01-01T00:00:00.000Z" },
    });
    await expect(
      finalizeDocumentUploadForActor(actor, intent(checksum).id, body, expired),
    ).rejects.toThrow(/expired/);
    expect(expired.storage.put).not.toHaveBeenCalled();

    const tampered = deps(checksum, { storedBody: new Uint8Array(body.byteLength).fill(65) });
    await expect(downloadDocumentForActor(staff, document(checksum).id, tampered)).rejects.toThrow(
      /stored.*(checksum|bytes)/i,
    );

    const valid = deps(checksum);
    await expect(
      downloadDocumentForActor(staff, document(checksum).id, valid),
    ).resolves.toMatchObject({ document: expect.objectContaining({ id: document(checksum).id }) });
  });
});
