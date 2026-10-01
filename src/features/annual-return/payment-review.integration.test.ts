import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createDocumentRepository } from "@/features/documents/repository";
import { createAnnualReturnRepository } from "./repository";
import { createPaymentEvidenceService } from "./payment-evidence";
const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 3 }) : null;
afterAll(async () => {
  await sql?.end();
});
const rollback = new Error("payment fixture rollback");
describe.skipIf(!url)("attributable current-version payment receipts", () => {
  it("serializes two reviewers on independent connections and credits the proof only once", async () => {
    const firstConnection = createSqlClient(url!, { max: 1 }),
      secondConnection = createSqlClient(url!, { max: 1 });
    const companyId = crypto.randomUUID(),
      caseId = crypto.randomUUID(),
      paymentId = crypto.randomUUID();
    const actorId = "20000000-0000-0000-0000-000000000001",
      otherActor = "20000000-0000-0000-0000-000000000002",
      teamId = "10000000-0000-0000-0000-000000000001";
    let competitor: Promise<unknown> | undefined;
    try {
      await sql!`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id) values(${companyId},'Concurrent payment synthetic fixture',${companyId},${companyId},'2020-01-01','2026-09-01','Test','Test','active',${actorId},${teamId})`;
      await sql!`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id,reviewer_id) values(${caseId},${companyId},2026,'2026-09-01','2026-10-13','Payment pending','green',${actorId},${otherActor})`;
      await sql!`insert into payments(id,company_id,case_id,invoice_number,amount,due_date) values(${paymentId},${companyId},${caseId},${caseId},1800,'2026-10-13')`;
      const docs = createDocumentRepository({ sql: sql! }),
        repository = createAnnualReturnRepository({ sql: sql! });
      const checksum = crypto.randomUUID().replaceAll("-", "").repeat(2);
      const intent = await docs.createUploadIntent({
        companyId,
        caseId,
        requestedByAuthUserId: "synthetic-auth",
        category: "payment",
        fileName: "concurrency.pdf",
        contentType: "application/pdf",
        expectedSizeBytes: 4,
        checksum,
        objectKey: `synthetic/${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      const document = await docs.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: actorId,
        source: "staff",
      });
      // Synthetic local provider contract. It does not establish scanner/R2 runtime health.
      await docs.recordScanResult(
        intent.id,
        {
          status: "clean",
          providerReference: "synthetic-local",
          verifiedChecksum: checksum,
          verifiedByteSize: 4,
        },
        { verdictSource: "provider" },
      );
      const proofVersionId = (await docs.getDocument(document.id))!.currentVersionId!;
      const base = { caseId, paymentId, documentId: document.id, proofVersionId };
      await createPaymentEvidenceService({ sql: sql! }).record({
        ...base,
        expectedVersion: (await repository.getCase(caseId))!.readiness!.sourceVersion!,
        amount: "1800",
        receivedOn: "2026-10-01",
        actorId,
      });
      const input = {
        ...base,
        expectedVersion: (await repository.getCase(caseId))!.readiness!.sourceVersion!,
        decision: "verified" as const,
      };
      const [{ pid: firstPid }] = await firstConnection<
        { pid: number }[]
      >`select pg_backend_pid() pid`;
      const [{ pid: secondPid }] = await secondConnection<
        { pid: number }[]
      >`select pg_backend_pid() pid`;
      expect(firstPid).not.toBe(secondPid);
      const winner = await firstConnection.begin(async (tx) => {
        await tx`select id from annual_return_cases where id=${caseId} for update`;
        competitor = secondConnection
          .begin(async (secondTx) => {
            await secondTx`set local lock_timeout='4s'`;
            return createPaymentEvidenceService({ sql: secondTx }).review({
              ...input,
              actorId: otherActor,
            });
          })
          .then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const [activity] = await sql!<
            { blocked: boolean }[]
          >`select wait_event_type='Lock' blocked from pg_stat_activity where pid=${secondPid}`;
          if (activity?.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        return createPaymentEvidenceService({ sql: tx }).review({ ...input, actorId });
      });
      expect(winner.payment).toMatchObject({
        receivedAmount: 1800,
        balance: 0,
        status: "Payment received",
      });
      expect(await competitor).toMatchObject({ error: { statusCode: 409 } });
      const [entry] = await sql!<
        { count: number }[]
      >`select count(*)::int count from payment_evidence_entries where payment_id=${paymentId} and status='verified'`;
      expect(entry.count).toBe(1);
      const [audit] = await sql!<
        { count: number }[]
      >`select count(*)::int count from annual_return_audit_events where case_id=${caseId} and metadata->>'command'='review'`;
      expect(audit.count).toBe(1);
    } finally {
      await competitor;
      await sql!.begin(async (tx) => {
        await tx`delete from notification_outbox where work_item_id in(select id from work_items where annual_return_case_id=${caseId})`;
        await tx`delete from assignment_events where work_item_id in(select id from work_items where annual_return_case_id=${caseId})`;
        await tx`delete from escalation_events where work_item_id in(select id from work_items where annual_return_case_id=${caseId})`;
        await tx`delete from work_items where annual_return_case_id=${caseId}`;
        await tx`delete from payment_evidence_entries where case_id=${caseId}`;
        await tx`update payments set payment_proof_document_id=null where case_id=${caseId}`;
        await tx`delete from document_versions where document_id in(select id from documents where case_id=${caseId})`;
        await tx`delete from document_scan_jobs where intent_id in(select id from document_upload_intents where case_id=${caseId})`;
        await tx`delete from document_upload_intents where case_id=${caseId}`;
        await tx`delete from documents where case_id=${caseId}`;
        await tx`delete from annual_return_audit_events where case_id=${caseId}`;
        await tx`delete from timeline_events where case_id=${caseId}`;
        await tx`delete from payments where case_id=${caseId}`;
        await tx`delete from annual_return_cases where id=${caseId}`;
        await tx`delete from companies where id=${companyId}`;
      });
      await Promise.all([firstConnection.end(), secondConnection.end()]);
    }
  });
  it.each(["unreadable", "already-verified"] as const)(
    "records partial amounts, prevents duplicate proof credit, returns with reason and accepts only a current version: %s",
    async (scenario) => {
      await expect(
        sql!.begin(async (tx) => {
          const companyId = crypto.randomUUID(),
            caseId = crypto.randomUUID(),
            paymentId = crypto.randomUUID();
          const actorId = "20000000-0000-0000-0000-000000000001",
            teamId = "10000000-0000-0000-0000-000000000001";
          await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id) values(${companyId},'Payment synthetic fixture',${companyId},${companyId},'2020-01-01','2026-09-01','Test','Test','active',${actorId},${teamId})`;
          await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id) values(${caseId},${companyId},2026,'2026-09-01','2026-10-13','Payment pending','green',${actorId})`;
          await tx`insert into payments(id,company_id,case_id,invoice_number,amount,due_date) values(${paymentId},${companyId},${caseId},${caseId},1800,'2026-10-13')`;
          const documents = createDocumentRepository({ sql: tx }),
            repository = createAnnualReturnRepository({ sql: tx }),
            service = createPaymentEvidenceService({ sql: tx });
          const proof = async (checksum: string, replacementDocumentId?: string) => {
            const intent = await documents.createUploadIntent({
              companyId,
              caseId,
              replacementDocumentId,
              requestedByAuthUserId: "synthetic-auth",
              category: "payment",
              fileName: "proof.pdf",
              contentType: "application/pdf",
              expectedSizeBytes: 4,
              checksum,
              objectKey: `synthetic/${crypto.randomUUID()}`,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            });
            const document = await documents.finalizeUploadIntent({
              intentId: intent.id,
              uploadedBy: actorId,
              source: "staff",
            });
            // Injected local provider contract, never evidence of a genuine scanner/R2 roundtrip.
            await documents.recordScanResult(
              intent.id,
              {
                status: "clean",
                providerReference: "synthetic-local",
                verifiedChecksum: checksum,
                verifiedByteSize: 4,
              },
              { verdictSource: "provider" },
            );
            const [version] = await tx<
              { id: string }[]
            >`select id from document_versions where document_id=${document.id} and superseded_by_version_id is null`;
            return { documentId: document.id, proofVersionId: version.id };
          };
          const current = async () => (await repository.getCase(caseId))!.readiness!.sourceVersion!;
          if (scenario === "unreadable") {
            const unreadable = await proof("8".repeat(64));
            const returned = await service.review({
              caseId,
              paymentId,
              ...unreadable,
              expectedVersion: await current(),
              decision: "rejected",
              reasonCode: "unreadable",
              reasonText: "Amount and receipt date are not readable",
              actorId,
            });
            expect(returned.payment?.evidenceEntries).toHaveLength(0);
            expect(returned.payment?.proofReturns).toEqual([
              expect.objectContaining({
                documentId: unreadable.documentId,
                reasonText: "Amount and receipt date are not readable",
              }),
            ]);
          }
          const first = await proof("b".repeat(64));
          let recorded = await service.record({
            caseId,
            paymentId,
            ...first,
            expectedVersion: await current(),
            amount: "600.00",
            receivedOn: "2026-09-30",
            reference: "synthetic transfer A",
            actorId,
          });
          const version = await current();
          let reviewed = await service.review({
            caseId,
            paymentId,
            ...first,
            expectedVersion: version,
            decision: "verified",
            actorId,
          });
          expect(reviewed.payment).toMatchObject({
            status: "Payment pending",
            receivedAmount: 600,
            balance: 1200,
            paidAt: null,
          });
          await expect(
            repository.updatePayment({
              caseId,
              status: "Payment received",
              paymentProofDocumentId: first.documentId,
              actorId,
            }),
          ).rejects.toThrow(/full invoice/i);
          await expect(
            service.review({
              caseId,
              paymentId,
              ...first,
              expectedVersion: version,
              decision: "verified",
              actorId,
            }),
          ).rejects.toMatchObject({ statusCode: 409 });
          expect(recorded.payment?.evidenceEntries).toHaveLength(1);
          const duplicate = await proof("b".repeat(64));
          await expect(
            service.record({
              caseId,
              paymentId,
              ...duplicate,
              expectedVersion: await current(),
              amount: "600",
              receivedOn: "2026-09-30",
              actorId,
            }),
          ).rejects.toThrow(/duplicate/i);
          const duplicateReturned = await service.review({
            caseId,
            paymentId,
            ...duplicate,
            expectedVersion: await current(),
            decision: "rejected",
            reasonCode: "duplicate_proof",
            reasonText: "Same transfer already credited by another proof",
            actorId,
          });
          expect(duplicateReturned.payment?.evidenceEntries).toHaveLength(1);
          expect(duplicateReturned.payment?.receivedAmount).toBe(600);
          expect(duplicateReturned.payment?.proofReturns).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                documentId: duplicate.documentId,
                reasonCode: "duplicate_proof",
              }),
            ]),
          );
          const second = await proof("c".repeat(64));
          if (scenario === "already-verified")
            await documents.reviewDocument({
              documentId: second.documentId,
              reviewerId: actorId,
              decision: "verified",
            });
          recorded = await service.record({
            caseId,
            paymentId,
            ...second,
            expectedVersion: await current(),
            amount: "1200",
            receivedOn: "2026-10-01",
            actorId,
          });
          await expect(
            service.review({
              caseId,
              paymentId,
              ...second,
              expectedVersion: await current(),
              decision: "rejected",
              reasonCode: "unreadable",
              reasonText: " ",
              actorId,
            }),
          ).rejects.toThrow(/reason/i);
          reviewed = await service.review({
            caseId,
            paymentId,
            ...second,
            expectedVersion: await current(),
            decision: "rejected",
            reasonCode: "unreadable",
            reasonText: "Cannot read bank transaction identifier",
            actorId,
          });
          expect(reviewed.payment).toMatchObject({
            receivedAmount: 600,
            balance: 1200,
            status: "Payment pending",
          });
          expect((await documents.getDocument(second.documentId))?.reviewStatus).toBe(
            scenario === "already-verified" ? "verified" : "rejected",
          );
          const replacement = await proof("d".repeat(64), second.documentId);
          await service.record({
            caseId,
            paymentId,
            ...replacement,
            expectedVersion: await current(),
            amount: "1200",
            receivedOn: "2026-10-01",
            actorId,
          });
          const preview = await current();
          const recovery = await documents.getDocumentRecoveryPreview(replacement.documentId);
          const changed = await documents.createUploadIntent({
            companyId,
            caseId,
            requestedByAuthUserId: "synthetic-auth",
            category: "payment",
            fileName: "proof-v2.pdf",
            contentType: "application/pdf",
            expectedSizeBytes: 4,
            checksum: "e".repeat(64),
            objectKey: `synthetic/${crypto.randomUUID()}`,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            recovery: {
              documentId: replacement.documentId,
              expectedToken: recovery!.versionToken,
              reason: "Synthetic missing-object race fixture",
            },
            recoveryApprovedBy: actorId,
            recoveryObjectState: "missing",
            recoveryObjectObservedAt: new Date().toISOString(),
          });
          await documents.finalizeUploadIntent({
            intentId: changed.id,
            uploadedBy: actorId,
            source: "staff",
          });
          await expect(
            service.review({
              caseId,
              paymentId,
              ...replacement,
              expectedVersion: preview,
              decision: "verified",
              actorId,
            }),
          ).rejects.toMatchObject({ statusCode: 409 });
          const final = await proof("f".repeat(64));
          await service.record({
            caseId,
            paymentId,
            ...final,
            expectedVersion: await current(),
            amount: "1200",
            receivedOn: "2026-10-01",
            actorId,
          });
          reviewed = await service.review({
            caseId,
            paymentId,
            ...final,
            expectedVersion: await current(),
            decision: "verified",
            actorId,
          });
          expect(reviewed.payment).toMatchObject({
            status: "Payment received",
            amount: 1800,
            receivedAmount: 1800,
            balance: 0,
            paymentProofDocumentId: final.documentId,
          });
          expect(reviewed.payment?.paidAt?.slice(0, 10)).toBe("2026-10-01");
          const audits = await tx<
            { count: number }[]
          >`select count(*)::int from annual_return_audit_events where case_id=${caseId} and action='update_payment'`;
          expect(audits[0].count).toBe(scenario === "unreadable" ? 14 : 12);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
  );
});
