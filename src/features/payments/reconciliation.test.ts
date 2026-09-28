import "dotenv/config";
import type postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AnnualReturnCase } from "@/features/annual-return/types";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnEvidenceService } from "@/features/annual-return/evidence-service";
import type { AnnualReturnRepository } from "@/features/annual-return/repository";
import type { DocumentRepository, PrivateDocument } from "@/features/documents/repository";
import { classifyPaymentMatch, reconcilePaymentForActor } from "./reconciliation";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createDocumentRepository } from "@/features/documents/repository";

const caseId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const proofId = "44444444-4444-4444-8444-444444444444";
const checksum = "a".repeat(64);
const caseItem: AnnualReturnCase = {
  id: caseId,
  companyId,
  companyTeamId: "77777777-7777-4777-8777-777777777777",
  companyName: "Fixture Limited",
  returnYear: 2026,
  madeUpDate: "2026-06-30",
  filingDueDate: "2026-08-12",
  currentStatus: "Documents pending",
  riskLevel: "green",
  ownerId: actorId,
  ownerName: "Reviewer",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 0,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [],
  payment: {
    id: "55555555-5555-4555-8555-555555555555",
    caseId,
    invoiceNumber: "INV-2026-001",
    amount: 1800,
    currency: "HKD",
    status: "Payment pending",
    dueDate: "2026-08-01",
    paidAt: null,
    paymentProofDocumentId: null,
  },
};
const proof: PrivateDocument = {
  id: proofId,
  companyId,
  caseId,
  category: "payment",
  fileName: "proof.pdf",
  objectKey: "documents/private-proof",
  contentType: "application/pdf",
  sizeBytes: 12,
  checksum,
  uploadStatus: "available",
  scanVerdictSource: "provider",
  verifiedChecksum: checksum,
  verifiedByteSize: 12,
  currentVersionId: "66666666-6666-4666-8666-666666666666",
  versionNumber: 1,
  reviewStatus: "pending",
  uploadedBy: null,
  uploadedAt: "2026-09-27T00:00:00.000Z",
};

const matchInput = {
  observation: { companyId, caseId },
  invoice: { companyId, caseId, invoiceRef: "INV-2026-001", amountMinor: 180000, currency: "HKD" },
  proof: { companyId, caseId, verifiedScan: true, reviewed: true },
  confirmation: { invoiceRef: "INV-2026-001", amountMinor: 180000, currency: "HKD" },
  duplicateInvoiceRef: false,
  proofAlreadyAllocated: false,
  paymentAlreadyAllocated: false,
};

describe("T13 payment reconciliation", () => {
  it("t13_scenario_1 keeps a monthly received date pending without a proof and rejects foreign-company proof", () => {
    expect(classifyPaymentMatch({ ...matchInput, proof: null, confirmation: null })).toEqual({
      kind: "pending",
      reasonCode: "proof-missing",
    });
    expect(
      classifyPaymentMatch({
        ...matchInput,
        proof: { ...matchInput.proof, companyId: "99999999-9999-4999-8999-999999999999" },
      }),
    ).toEqual({ kind: "exception", reasonCode: "proof-scope-mismatch" });
  });

  it("t13_scenario_2 treats duplicate references, repeat allocation, partial, overpayment and other currencies as exceptions", () => {
    expect(classifyPaymentMatch({ ...matchInput, duplicateInvoiceRef: true })).toEqual({
      kind: "exception",
      reasonCode: "duplicate-invoice-reference",
    });
    expect(classifyPaymentMatch({ ...matchInput, proofAlreadyAllocated: true })).toEqual({
      kind: "exception",
      reasonCode: "proof-already-allocated",
    });
    expect(classifyPaymentMatch({ ...matchInput, paymentAlreadyAllocated: true })).toEqual({
      kind: "exception",
      reasonCode: "payment-already-allocated",
    });
    expect(
      classifyPaymentMatch({
        ...matchInput,
        confirmation: { ...matchInput.confirmation, amountMinor: 179900 },
      }),
    ).toEqual({ kind: "exception", reasonCode: "partial-payment" });
    expect(
      classifyPaymentMatch({
        ...matchInput,
        confirmation: { ...matchInput.confirmation, amountMinor: 180100 },
      }),
    ).toEqual({ kind: "exception", reasonCode: "overpayment" });
    expect(
      classifyPaymentMatch({
        ...matchInput,
        confirmation: { ...matchInput.confirmation, currency: "USD" },
      }),
    ).toEqual({ kind: "exception", reasonCode: "currency-mismatch" });
    expect(classifyPaymentMatch(matchInput)).toEqual({ kind: "matched" });
  });

  it("t13_scenario_1 leaves canonical payment pending after proof review until a separate amount and invoice reconciliation", async () => {
    const updatePayment = vi.fn(async () => caseItem);
    const documents = {
      getDocument: vi.fn(async () => proof),
      reviewDocument: vi.fn(async () => ({ ...proof, reviewStatus: "verified" as const })),
      close: vi.fn(async () => undefined),
    } as unknown as DocumentRepository;
    const annualReturns = {
      getCase: vi.fn(async () => caseItem),
      assertCanMutateCase: vi.fn(async () => undefined),
      updatePayment,
      close: vi.fn(async () => undefined),
    } as unknown as AnnualReturnRepository;
    const service = createAnnualReturnEvidenceService({
      sql: { begin: async (callback: (tx: unknown) => Promise<unknown>) => callback({}) } as never,
      documentRepositoryFactory: () => documents,
      annualReturnRepositoryFactory: () => annualReturns,
    });

    const result = await service.reviewEvidence({
      caseId,
      documentId: proofId,
      decision: "verified",
      actorId,
      expectedVersion: 1,
    });
    expect(result.document.reviewStatus).toBe("verified");
    expect(updatePayment).not.toHaveBeenCalled();
    expect(result.caseItem.payment?.status).toBe("Payment pending");
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
let db: SqlClient | undefined;
function sqlForTests(): SqlClient {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for T13 integration tests.");
  db ??= createSqlClient(databaseUrl, { max: 2 });
  return db;
}
afterAll(async () => {
  if (db) await db.end();
});
const rollback = new Error("t13-fixture-rollback");
async function inRollbackFixture(
  test: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<void> {
  try {
    await sqlForTests().begin(async (tx) => {
      await test(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

type DbFixture = {
  actor: AuthenticatedActor & { userId: string };
  caseId: string;
  observationId: string;
  proofVersionId: string;
  amountMinor: number;
  invoiceRef: string;
};
async function dbFixture(tx: postgres.TransactionSql): Promise<DbFixture> {
  const [admin] = await tx<{ auth_user_id: string; user_id: string; team_id: string | null }[]>`
    select sp.auth_user_id,sp.user_id,sp.team_id from staff_profiles sp
    join users u on u.id=sp.user_id and u.active
    where sp.role='Admin' and sp.active limit 1`;
  const [team] = await tx<{ id: string }[]>`select id from teams limit 1`;
  if (!admin || !team) throw new Error("T13 fixture needs seeded Admin and team.");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const [company] = await tx<{ id: string }[]>`
    insert into companies (company_name,cr_number,br_number,incorporation_date,
      annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,
      assigned_team_id,data_origin)
    values ('T13 Fixture Limited',${`CR-T13-${nonce}`},${`BR-T13-${nonce}`},
      '2020-06-15','2020-06-15','Fixture office','Fixture secretary',
      ${admin.user_id},${team.id},'fixture') returning id`;
  const [annualCase] = await tx<{ id: string }[]>`
    insert into annual_return_cases
      (company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
    values (${company.id},2026,'2026-06-15','2026-08-10','Payment pending',${admin.user_id})
    returning id`;
  const invoiceRef = `T13-${nonce}`;
  await tx`insert into payments
    (company_id,case_id,invoice_number,amount,currency,status,due_date)
    values (${company.id},${annualCase.id},${invoiceRef},1800,'HKD','Payment pending','2026-08-10')`;
  const [batch] = await tx<{ id: string }[]>`
    insert into nar_import_batches
      (source_file_name,source_sha256,source_size_bytes,sheet_name,parser_version,return_year,created_by)
    values (${`t13-${nonce}.xlsx`},${nonce.repeat(2)},256,'Fixture','t13-fixture',2026,${admin.user_id})
    returning id`;
  const [row] = await tx<{ id: string }[]>`
    insert into nar_import_rows
      (batch_id,row_number,external_client_id,company_name,raw,parsed,disposition,matched_company_id)
    values (${batch.id},2,${`T13-${nonce}`},'T13 Fixture Limited',${tx.json({})},
      ${tx.json({})},'unchanged',${company.id}) returning id`;
  const [observation] = await tx<{ id: string }[]>`
    insert into nar_import_payment_observations
      (source_row_id,case_id,company_id,observed_date,raw_value,created_by)
    values (${row.id},${annualCase.id},${company.id},'2026-08-01','1/8/2026',${admin.user_id})
    returning id`;
  const bytes = new TextEncoder().encode("%PDF-1.7\n");
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(hashBuffer), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const documents = createDocumentRepository({ sql: tx });
  const intent = await documents.createUploadIntent({
    companyId: company.id,
    caseId: annualCase.id,
    requestedByAuthUserId: admin.auth_user_id,
    category: "payment",
    fileName: "payment-proof.pdf",
    contentType: "application/pdf",
    expectedSizeBytes: bytes.byteLength,
    checksum: hash,
    objectKey: `documents/t13-fixture/${nonce}`,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  });
  const document = await documents.finalizeUploadIntent({
    intentId: intent.id,
    uploadedBy: admin.user_id,
    source: "staff",
  });
  await documents.recordScanResult(
    intent.id,
    {
      status: "clean",
      providerReference: "fixture-provider",
      verifiedChecksum: hash,
      verifiedByteSize: bytes.byteLength,
    },
    { verdictSource: "provider", expectedChecksum: hash },
  );
  await documents.reviewDocument({
    documentId: document.id,
    reviewerId: admin.user_id,
    decision: "verified",
    expectedVersion: 1,
  });
  const [version] = await tx<{ id: string }[]>`
    select id from document_versions where document_id=${document.id} and superseded_by_version_id is null`;
  return {
    actor: {
      authUserId: admin.auth_user_id,
      userId: admin.user_id,
      role: "Admin",
      teamId: admin.team_id,
      active: true,
    },
    caseId: annualCase.id,
    observationId: observation.id,
    proofVersionId: version.id,
    amountMinor: 180000,
    invoiceRef,
  };
}

describe.skipIf(!databaseUrl)("T13 payment reconciliation against Postgres", () => {
  it("t13_scenario_1 keeps an import date pending until matched proof and exact invoice confirmation", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const before = await tx<
        { status: string }[]
      >`select status from payments where case_id=${fixture.caseId}`;
      expect(before[0].status).toBe("Payment pending");
      const result = await reconcilePaymentForActor(
        fixture.actor,
        {
          observationId: fixture.observationId,
          caseId: fixture.caseId,
          proofVersionId: fixture.proofVersionId,
          expectedRevision: 1,
          decision: "match",
          confirmation: {
            invoiceRef: fixture.invoiceRef,
            amountMinor: fixture.amountMinor,
            currency: "HKD",
          },
        },
        tx,
      );
      expect(result).toMatchObject({
        status: "matched",
        revision: 2,
        paymentStatus: "Payment received",
        auditEventId: expect.any(String),
      });
      const allocation = await tx<
        { id: string }[]
      >`select id from payment_proof_allocations where observation_id=${fixture.observationId}`;
      expect(allocation).toHaveLength(1);
      const events = await tx<
        {
          before_values: { paymentStatus: string };
          after_values: { paymentStatus: string; observation: { proofVersionId: string | null } };
        }[]
      >`
        select before_values,after_values from payment_reconciliation_events where observation_id=${fixture.observationId}`;
      expect(events[0].before_values.paymentStatus).toBe("Payment pending");
      expect(events[0].after_values.paymentStatus).toBe("Payment received");
      expect(events[0].after_values.observation.proofVersionId).toBe(fixture.proofVersionId);
    });
  });

  it("t13_scenario_2 records partial, overpayment and currency exceptions without changing the canonical payment", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const attempts = [
        { amountMinor: 179900, currency: "HKD", code: "partial-payment" },
        { amountMinor: 180100, currency: "HKD", code: "overpayment" },
        { amountMinor: 180000, currency: "USD", code: "currency-mismatch" },
      ];
      for (let index = 0; index < attempts.length; index += 1) {
        const item = attempts[index];
        const result = await reconcilePaymentForActor(
          fixture.actor,
          {
            observationId: fixture.observationId,
            caseId: fixture.caseId,
            proofVersionId: fixture.proofVersionId,
            expectedRevision: index + 1,
            decision: "match",
            confirmation: {
              invoiceRef: fixture.invoiceRef,
              amountMinor: item.amountMinor,
              currency: item.currency,
            },
          },
          tx,
        );
        expect(result).toMatchObject({
          status: "exception",
          revision: index + 2,
          paymentStatus: "Payment pending",
          reasonCode: item.code,
        });
      }
      const rows = await tx<
        { status: string }[]
      >`select status from payments where case_id=${fixture.caseId}`;
      expect(rows[0].status).toBe("Payment pending");
      const allocations = await tx<
        { id: string }[]
      >`select id from payment_proof_allocations where observation_id=${fixture.observationId}`;
      expect(allocations).toHaveLength(0);
      const audits = await tx<
        { id: string }[]
      >`select id from payment_reconciliation_events where observation_id=${fixture.observationId}`;
      expect(audits).toHaveLength(3);
    });
  });

  it("t13_scenario_3 refuses inactive actors and stale observation revisions", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const command = {
        observationId: fixture.observationId,
        caseId: fixture.caseId,
        proofVersionId: fixture.proofVersionId,
        expectedRevision: 1,
        decision: "match" as const,
        confirmation: {
          invoiceRef: fixture.invoiceRef,
          amountMinor: fixture.amountMinor,
          currency: "HKD",
        },
      };
      await expect(
        reconcilePaymentForActor({ ...fixture.actor, active: false }, command, tx),
      ).rejects.toThrow(/inactive|Forbidden/i);
      await tx`update users set active = false where id = ${fixture.actor.userId}`;
      await expect(reconcilePaymentForActor(fixture.actor, command, tx)).rejects.toThrow(
        /inactive|Forbidden|active staff/i,
      );
      await tx`update users set active = true where id = ${fixture.actor.userId}`;
      await reconcilePaymentForActor(fixture.actor, command, tx);
      await expect(reconcilePaymentForActor(fixture.actor, command, tx)).rejects.toThrow(
        /revision changed/i,
      );
      const allocation = await tx<
        { id: string }[]
      >`select id from payment_proof_allocations where observation_id=${fixture.observationId}`;
      expect(allocation).toHaveLength(1);
    });
  });
});
