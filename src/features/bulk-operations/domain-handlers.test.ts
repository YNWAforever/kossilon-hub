import "dotenv/config";
import type postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createDocumentRepository } from "@/features/documents/repository";
import { createWorkItemRepository, ensureWorkItemForEvent } from "@/features/work-items/repository";
import { createBulkOperationRepository } from "./repository";
import type { AuthenticatedActor } from "@/features/auth/types";
import { applyPaymentItem, type PaymentBatchItem } from "./payment-handler";
import { applyPackageItem, applyReturnItem } from "./package-handler";
import { evidenceActionAvailability } from "./evidence-handler";
import { bulkPreviewInputSchema } from "./types";

const actor: AuthenticatedActor = {
  authUserId: "auth-reviewer",
  userId: "11111111-1111-4111-8111-111111111111",
  role: "Manager",
  teamId: "22222222-2222-4222-8222-222222222222",
  active: true,
};
const caseId = "33333333-3333-4333-8333-333333333333";
const observationId = "44444444-4444-4444-8444-444444444444";
const proofVersionId = "55555555-5555-4555-8555-555555555555";
const payment: PaymentBatchItem = {
  observationId,
  caseId,
  expectedRevision: 3,
  decision: "match",
  proofVersionId,
  confirmation: { invoiceRef: "INV-42", amountMinor: 12000, currency: "HKD" },
};

describe("T05 selected-policy durable backfill", () => {
  it("t05_backfill_durable accepts a versioned preview for one selected policy", () => {
    const workItemId = "90000000-0000-4000-8000-000000000001";
    expect(
      bulkPreviewInputSchema.parse({
        action: "attachSlaPolicies",
        selection: { kind: "ids", ids: [workItemId] },
        parameters: {
          policyVersionId: "90000000-0000-4000-8000-000000000002",
          items: [
            {
              workItemId,
              expectedVersion: 1,
              startedAt: "2026-09-28T01:00:00.000Z",
              warningAt: "2026-09-28T02:00:00.000Z",
              dueAt: "2026-09-28T03:00:00.000Z",
              previewHash: "a".repeat(64),
            },
          ],
        },
      }).action,
    ).toBe("attachSlaPolicies");
  });
});

describe("T24 domain batch boundaries", () => {
  it("t24_scenario_1: every enabled item delegates exact proof, revision and actor checks to its single-item service", async () => {
    const paymentService = vi
      .fn()
      .mockRejectedValue(new Error("Payment proof is not ready: proof-unverified."));
    await expect(
      applyPaymentItem(actor, payment, { reconcilePayment: paymentService }),
    ).rejects.toThrow("proof-unverified");
    expect(paymentService).toHaveBeenCalledExactlyOnceWith(actor, payment);

    const packageService = vi.fn().mockRejectedValue(new Error("Package evidence is not ready."));
    await expect(
      applyPackageItem(actor, { caseId, expectedRevision: 2 }, { preparePackage: packageService }),
    ).rejects.toThrow("not ready");
    expect(packageService).toHaveBeenCalledExactlyOnceWith(actor, {
      caseId,
      expectedRevision: 2,
    });

    const returnService = vi
      .fn()
      .mockRejectedValue(new Error("Forbidden: case outside actor scope."));
    const intake = {
      caseId,
      externalReference: "NAR-42",
      manifestHash: null,
      outcome: "accepted" as const,
      source: { kind: "manual" as const, proofVersionId },
    };
    await expect(applyReturnItem(actor, intake, { ingestReturn: returnService })).rejects.toThrow(
      "Forbidden",
    );
    expect(returnService).toHaveBeenCalledExactlyOnceWith(actor, intake);
    expect(evidenceActionAvailability("classifyDocuments")).toMatchObject({ enabled: false });
    expect(evidenceActionAvailability("assignReview")).toMatchObject({ enabled: false });
    expect(evidenceActionAvailability("retryAnalysis")).toMatchObject({ enabled: false });
    for (const action of ["classifyDocuments", "assignReview", "retryAnalysis"]) {
      expect(() =>
        bulkPreviewInputSchema.parse({
          action,
          selection: { kind: "ids", ids: [proofVersionId] },
          parameters: { items: [] },
        }),
      ).toThrow();
    }
  });

  it("t24_scenario_2: partial payment, stale package and duplicate return keep their own explainable outcomes", async () => {
    const paymentService = vi.fn().mockResolvedValue({
      observationId,
      status: "exception",
      revision: 4,
      paymentStatus: "Payment pending",
      auditEventId: "66666666-6666-4666-8666-666666666666",
      reasonCode: "partial-payment",
    });
    const paymentResult = await applyPaymentItem(actor, payment, {
      reconcilePayment: paymentService,
    });
    expect(paymentResult).toMatchObject({ state: "conflict", reasonCode: "partial-payment" });

    const packageService = vi
      .fn()
      .mockRejectedValue(new Error("Package revision changed; reload."));
    await expect(
      applyPackageItem(actor, { caseId, expectedRevision: 2 }, { preparePackage: packageService }),
    ).rejects.toThrow("revision changed");

    const duplicateReturn = vi.fn().mockResolvedValue({
      id: "77777777-7777-4777-8777-777777777777",
      revision: 1,
      matchState: "candidate",
      duplicate: true,
      candidateHandoffIds: ["88888888-8888-4888-8888-888888888888"],
    });
    const returnResult = await applyReturnItem(
      actor,
      {
        caseId,
        externalReference: "NAR-42",
        manifestHash: null,
        outcome: "accepted",
        source: { kind: "manual", proofVersionId },
      },
      { ingestReturn: duplicateReturn },
    );
    expect(returnResult).toMatchObject({ state: "skipped", reasonCode: "RETURN_ALREADY_INGESTED" });
    expect(paymentService).toHaveBeenCalledTimes(1);
    expect(packageService).toHaveBeenCalledTimes(1);
    expect(duplicateReturn).toHaveBeenCalledTimes(1);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
let database: SqlClient | undefined;
function db(): SqlClient {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL required.");
  database ??= createSqlClient(databaseUrl, { max: 2 });
  return database;
}
afterAll(async () => {
  await database?.end();
});
const fixtureRollback = new Error("t24-fixture-rollback");
async function withFixture(work: (tx: postgres.TransactionSql) => Promise<void>) {
  try {
    await db().begin(async (tx) => {
      await work(tx);
      throw fixtureRollback;
    });
  } catch (error) {
    if (error !== fixtureRollback) throw error;
  }
}
async function paymentFixture(tx: postgres.TransactionSql) {
  const [admin] = await tx<{ auth_user_id: string; user_id: string; team_id: string | null }[]>`
    select sp.auth_user_id,sp.user_id,sp.team_id from staff_profiles sp
    join users u on u.id=sp.user_id and u.active where sp.role='Admin' and sp.active limit 1`;
  const [team] = await tx<{ id: string }[]>`select id from teams limit 1`;
  if (!admin || !team) throw new Error("Disposable fixture needs seeded staff and team.");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const [company] = await tx<{ id: string }[]>`
    insert into companies (company_name,cr_number,br_number,incorporation_date,
      annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,
      assigned_team_id,data_origin)
    values ('T24 Fixture Limited',${"CR-T24-" + nonce},${"BR-T24-" + nonce},
      '2020-06-15','2020-06-15','Fixture office','Fixture secretary',
      ${admin.user_id},${team.id},'fixture') returning id`;
  const [annualCase] = await tx<{ id: string }[]>`
    insert into annual_return_cases
      (company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
    values (${company.id},2026,'2026-06-15','2026-08-10','Payment pending',${admin.user_id})
    returning id`;
  const invoiceRef = "T24-" + nonce;
  await tx`insert into payments
    (company_id,case_id,invoice_number,amount,currency,status,due_date)
    values (${company.id},${annualCase.id},${invoiceRef},1800,'HKD','Payment pending','2026-08-10')`;
  const [batch] = await tx<{ id: string }[]>`
    insert into nar_import_batches
      (source_file_name,source_sha256,source_size_bytes,sheet_name,parser_version,return_year,created_by)
    values (${"t24-" + nonce + ".xlsx"},${nonce.repeat(2)},256,'Fixture','t24-fixture',2026,${admin.user_id})
    returning id`;
  const observations: string[] = [];
  for (const rowNumber of [2, 3]) {
    const [row] = await tx<{ id: string }[]>`
      insert into nar_import_rows
        (batch_id,row_number,external_client_id,company_name,raw,parsed,disposition,matched_company_id)
      values (${batch.id},${rowNumber},${"T24-" + nonce + "-" + rowNumber},
        'T24 Fixture Limited',${tx.json({})},${tx.json({})},'unchanged',${company.id})
      returning id`;
    const [observation] = await tx<{ id: string }[]>`
      insert into nar_import_payment_observations
        (source_row_id,case_id,company_id,observed_date,raw_value,created_by)
      values (${row.id},${annualCase.id},${company.id},'2026-08-01','1/8/2026',${admin.user_id})
      returning id`;
    observations.push(observation.id);
  }
  const bytes = new TextEncoder().encode("%PDF-1.7\n");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const documents = createDocumentRepository({ sql: tx });
  const intent = await documents.createUploadIntent({
    companyId: company.id,
    caseId: annualCase.id,
    requestedByAuthUserId: admin.auth_user_id,
    category: "payment",
    fileName: "proof.pdf",
    contentType: "application/pdf",
    expectedSizeBytes: bytes.byteLength,
    checksum: hash,
    objectKey: "documents/t24/" + nonce,
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
    select id from document_versions where document_id=${document.id}
      and superseded_by_version_id is null`;
  return {
    actor: {
      authUserId: admin.auth_user_id,
      userId: admin.user_id,
      role: "Admin" as const,
      teamId: admin.team_id,
      active: true,
    },
    caseId: annualCase.id,
    observations,
    proofVersionId: version.id,
    invoiceRef,
  };
}

describe.skipIf(!databaseUrl)(
  "T05 selected-policy durable backfill against disposable Postgres",
  () => {
    it("t05_backfill_durable applies only matching reviewed items and resumes one rolled-back item without duplicate audit", async () => {
      await withFixture(async (tx) => {
        const [fixture] = await tx<
          {
            case_id: string;
            company_id: string;
            admin_id: string;
            auth_user_id: string;
            team_id: string | null;
            calendar_id: string;
          }[]
        >`
        select arc.id case_id,arc.company_id,sp.user_id admin_id,
          sp.auth_user_id,sp.team_id,p.business_calendar_id calendar_id
        from annual_return_cases arc
        cross join staff_profiles sp
        cross join sla_policies p
        join users u on u.id=sp.user_id and u.active
        where sp.role='Admin' and sp.active and p.active limit 1`;
        if (!fixture) throw new Error("T05 batch fixture needs an Admin, case and calendar.");
        const actor: AuthenticatedActor = {
          authUserId: fixture.auth_user_id,
          userId: fixture.admin_id,
          role: "Admin",
          teamId: fixture.team_id,
          active: true,
        };
        const workType = `t05_batch_${crypto.randomUUID()}`;
        const matching = await ensureWorkItemForEvent(tx, {
          companyId: fixture.company_id,
          caseType: "annual_return",
          annualReturnCaseId: fixture.case_id,
          sourceEventKey: `t05-batch-match:${crypto.randomUUID()}`,
          sourceEventType: "policy_configuration_required",
          workType,
          title: "Backfill selected SLA",
        });
        const other = await ensureWorkItemForEvent(tx, {
          companyId: fixture.company_id,
          caseType: "annual_return",
          annualReturnCaseId: fixture.case_id,
          sourceEventKey: `t05-batch-other:${crypto.randomUUID()}`,
          sourceEventType: "policy_configuration_required",
          workType: `t05_other_${crypto.randomUUID()}`,
          title: "Different work type",
        });
        const roleChanged = await ensureWorkItemForEvent(tx, {
          companyId: fixture.company_id,
          caseType: "annual_return",
          annualReturnCaseId: fixture.case_id,
          sourceEventKey: `t05-batch-role:${crypto.randomUUID()}`,
          sourceEventType: "policy_configuration_required",
          workType,
          title: "Role changed before apply",
        });
        const policyChanged = await ensureWorkItemForEvent(tx, {
          companyId: fixture.company_id,
          caseType: "annual_return",
          annualReturnCaseId: fixture.case_id,
          sourceEventKey: `t05-batch-policy:${crypto.randomUUID()}`,
          sourceEventType: "policy_configuration_required",
          workType,
          title: "Policy deactivated before apply",
        });
        const [policy] = await tx<{ id: string }[]>`
        insert into sla_policies
          (policy_key,version,name,work_type,business_calendar_id,
           warning_minutes,due_minutes,effective_from,active,created_by)
        values (${workType},1,'T05 durable selected policy',${workType},${fixture.calendar_id},
          60,120,'2026-01-01T00:00:00.000Z',true,${fixture.admin_id}) returning id`;
        const work = createWorkItemRepository({ sql: tx });
        const selected = await work.previewPolicyBackfill({
          actorId: fixture.admin_id,
          policyVersionId: policy.id,
          items: [
            { workItemId: matching.id, expectedVersion: matching.version },
            { workItemId: other.id, expectedVersion: other.version },
          ],
        });
        expect(selected.map((item) => item.state)).toEqual(["eligible", "conflict"]);
        const items = selected.map((item) => ({
          workItemId: item.workItemId,
          expectedVersion: item.workItemId === matching.id ? matching.version : other.version,
          startedAt: item.preview?.startedAt ?? selected[0].preview!.startedAt,
          warningAt: item.preview?.warningAt ?? selected[0].preview!.warningAt,
          dueAt: item.preview?.dueAt ?? selected[0].preview!.dueAt,
          previewHash: item.preview?.previewHash ?? selected[0].preview!.previewHash,
        }));
        const bulk = createBulkOperationRepository({ sql: tx });
        const tampered = await bulk.preview(actor, {
          action: "attachSlaPolicies",
          selection: { kind: "ids", ids: [matching.id, other.id] },
          parameters: {
            policyVersionId: policy.id,
            items: items.map((item) =>
              item.workItemId === matching.id ? { ...item, previewHash: "0".repeat(64) } : item,
            ),
          },
        });
        expect(tampered).toMatchObject({ eligibleCount: 0, conflictCount: 2 });
        expect(tampered.itemsPreview).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ resourceId: matching.id, reasonCode: "PREVIEW_CHANGED" }),
          ]),
        );
        expect(
          await tx<{ work_item_id: string }[]>`
          select work_item_id from work_item_sla_attachments where work_item_id=${matching.id}`,
        ).toHaveLength(0);
        const preview = await bulk.preview(actor, {
          action: "attachSlaPolicies",
          selection: { kind: "ids", ids: [matching.id, other.id] },
          parameters: { policyVersionId: policy.id, items },
        });
        expect(preview).toMatchObject({ eligibleCount: 1, conflictCount: 1 });
        expect(preview.itemsPreview).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              resourceId: other.id,
              reasonCode: "POLICY_WORK_TYPE_MISMATCH",
            }),
          ]),
        );
        const operation = await bulk.commit(actor, {
          previewId: preview.id,
          previewHash: preview.previewHash,
          idempotencyKey: crypto.randomUUID(),
        });
        expect(
          (
            await bulk.commit(actor, {
              previewId: preview.id,
              previewHash: preview.previewHash,
              idempotencyKey: crypto.randomUUID(),
            })
          ).id,
        ).toBe(operation.id);
        await bulk.runBatch(operation.id, {
          limit: 1,
          afterDomainWrite: () => {
            throw new Error("simulated post-write crash");
          },
        });
        expect(
          await tx<{ work_item_id: string }[]>`
        select work_item_id from work_item_sla_attachments where work_item_id=${matching.id}`,
        ).toHaveLength(0);
        const resumed = await bulk.runBatch(operation.id, { limit: 2 });
        expect(resumed.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              resourceId: matching.id,
              state: "succeeded",
              auditRef: matching.id,
              revisionAfter: matching.version + 1,
            }),
            expect.objectContaining({ resourceId: other.id, state: "conflict" }),
          ]),
        );
        expect(
          await tx<{ work_item_id: string }[]>`
        select work_item_id from work_item_sla_attachments where work_item_id=${matching.id}`,
        ).toHaveLength(1);
        expect(
          await tx<{ work_item_id: string }[]>`
        select work_item_id from work_item_sla_attachments where work_item_id=${other.id}`,
        ).toHaveLength(0);
        const previewFor = async (workItemId: string, expectedVersion: number) => {
          const [decision] = await work.previewPolicyBackfill({
            actorId: fixture.admin_id,
            policyVersionId: policy.id,
            items: [{ workItemId, expectedVersion }],
          });
          if (!decision.preview) throw new Error("T05 fixture preview is unavailable.");
          const selected = decision.preview;
          const currentPreview = await bulk.preview(actor, {
            action: "attachSlaPolicies",
            selection: { kind: "ids", ids: [workItemId] },
            parameters: {
              policyVersionId: policy.id,
              items: [
                {
                  workItemId,
                  expectedVersion,
                  startedAt: selected.startedAt,
                  warningAt: selected.warningAt,
                  dueAt: selected.dueAt,
                  previewHash: selected.previewHash,
                },
              ],
            },
          });
          return bulk.commit(actor, {
            previewId: currentPreview.id,
            previewHash: currentPreview.previewHash,
            idempotencyKey: crypto.randomUUID(),
          });
        };
        const roleOperation = await previewFor(roleChanged.id, roleChanged.version);
        await tx`update staff_profiles set role='Staff' where user_id=${fixture.admin_id}`;
        const denied = await bulk.runBatch(roleOperation.id, { limit: 1 });
        expect(denied.items[0]).toMatchObject({ state: "forbidden", reasonCode: "ACTOR_INACTIVE" });
        expect(
          await tx<{ work_item_id: string }[]>`
          select work_item_id from work_item_sla_attachments where work_item_id=${roleChanged.id}`,
        ).toHaveLength(0);
        await tx`update staff_profiles set role='Admin' where user_id=${fixture.admin_id}`;
        const policyOperation = await previewFor(policyChanged.id, policyChanged.version);
        await tx`update sla_policies set active=false where id=${policy.id}`;
        const conflicted = await bulk.runBatch(policyOperation.id, { limit: 1 });
        expect(conflicted.items[0]).toMatchObject({
          state: "conflict",
          reasonCode: "POLICY_OR_ITEM_CHANGED",
        });
        expect(
          await tx<{ work_item_id: string }[]>`
          select work_item_id from work_item_sla_attachments where work_item_id=${policyChanged.id}`,
        ).toHaveLength(0);
      });
    });
  },
);

describe.skipIf(!databaseUrl)("T24 durable domain batch against disposable Postgres", () => {
  it("t24_scenario_2: a partial payment exception does not block another explicit decision", async () => {
    await withFixture(async (tx) => {
      const fx = await paymentFixture(tx);
      const repo = createBulkOperationRepository({ sql: tx });
      const items = [
        {
          observationId: fx.observations[0],
          caseId: fx.caseId,
          expectedRevision: 1,
          decision: "match" as const,
          proofVersionId: fx.proofVersionId,
          confirmation: { invoiceRef: fx.invoiceRef, amountMinor: 179900, currency: "HKD" },
        },
        {
          observationId: fx.observations[1],
          caseId: fx.caseId,
          expectedRevision: 1,
          decision: "reject" as const,
          reason: "Source date alone is not payment proof.",
        },
      ];
      const preview = await repo.preview(fx.actor, {
        action: "reconcilePayments",
        selection: { kind: "ids", ids: fx.observations },
        parameters: { items },
      });
      expect(preview.eligibleCount).toBe(2);
      const operation = await repo.commit(fx.actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const result = await repo.runBatch(operation.id, { limit: 2 });
      expect(result.items.map((item) => [item.state, item.reasonCode]).sort()).toEqual(
        [
          ["conflict", "partial-payment"],
          ["succeeded", null],
        ].sort(),
      );
      expect(result.items.every((item) => Boolean(item.auditRef))).toBe(true);
      const manualQueue = await repo.listManualReviewQueue(fx.actor);
      expect(manualQueue).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationId: operation.id,
            action: "reconcilePayments",
            resourceId: fx.observations[0],
            state: "conflict",
            reasonCode: "partial-payment",
            auditRef: expect.any(String),
          }),
        ]),
      );
      const [payment] = await tx<{ status: string }[]>`
        select status from payments where case_id=${fx.caseId}`;
      expect(payment.status).toBe("Payment pending");
      const [allocation] = await tx<{ count: number }[]>`
        select count(*)::int count from payment_proof_allocations
        where observation_id=any(${fx.observations}::uuid[])`;
      expect(allocation.count).toBe(0);
      const [audits] = await tx<{ count: number }[]>`
        select count(*)::int count from payment_reconciliation_events
        where observation_id=any(${fx.observations}::uuid[])`;
      expect(audits.count).toBe(2);
    });
  });

  it("t24_scenario_1: stale revision and a post-write crash cannot bypass single-item checks or duplicate an audit", async () => {
    await withFixture(async (tx) => {
      const fx = await paymentFixture(tx);
      const repo = createBulkOperationRepository({ sql: tx });
      const item = {
        observationId: fx.observations[0],
        caseId: fx.caseId,
        expectedRevision: 1,
        decision: "reject" as const,
        reason: "No verified payment proof.",
      };
      const missingProof = await repo.preview(fx.actor, {
        action: "reconcilePayments",
        selection: { kind: "ids", ids: [item.observationId] },
        parameters: {
          items: [
            {
              ...item,
              decision: "match",
              proofVersionId: crypto.randomUUID(),
              confirmation: { invoiceRef: fx.invoiceRef, amountMinor: 180000, currency: "HKD" },
            },
          ],
        },
      });
      expect(missingProof.itemsPreview[0]).toMatchObject({
        state: "conflict",
        reasonCode: "PAYMENT_PROOF_NOT_READY",
      });
      const stale = await repo.preview(fx.actor, {
        action: "reconcilePayments",
        selection: { kind: "ids", ids: [item.observationId] },
        parameters: { items: [{ ...item, expectedRevision: 2 }] },
      });
      expect(stale.itemsPreview[0]).toMatchObject({
        state: "conflict",
        reasonCode: "REVISION_CHANGED",
      });
      const preview = await repo.preview(fx.actor, {
        action: "reconcilePayments",
        selection: { kind: "ids", ids: [item.observationId] },
        parameters: { items: [item] },
      });
      const operation = await repo.commit(fx.actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      let first = true;
      await repo.runBatch(operation.id, {
        limit: 1,
        afterDomainWrite: () => {
          if (first) {
            first = false;
            throw new Error("simulated post-write crash");
          }
        },
      });
      expect((await repo.get(fx.actor, operation.id)).items[0].state).toBe("failed");
      const resumed = await repo.runBatch(operation.id, { limit: 1 });
      expect(resumed.items[0]).toMatchObject({ state: "succeeded", revisionAfter: 2 });
      const [audits] = await tx<{ count: number }[]>`
        select count(*)::int count from payment_reconciliation_events
        where observation_id=${item.observationId}`;
      expect(audits.count).toBe(1);
    });
  });
});
