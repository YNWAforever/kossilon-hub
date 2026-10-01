import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createDocumentRepository } from "@/features/documents/repository";
import { createAnnualReturnRepository } from "./repository";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 2 }) : null;
afterAll(async () => {
  await sql?.end();
});
const rollback = new Error("readiness fixture rollback");

describe.skipIf(!url)("actual Postgres current readiness gates", () => {
  it.each(["none", "payment", "evidence"] as const)(
    "rechecks current source inside preparation transaction: %s",
    async (change) => {
      await expect(
        sql!.begin(async (tx) => {
          const [base] = await tx<
            { assigned_owner_id: string; assigned_team_id: string }[]
          >`select assigned_owner_id,assigned_team_id from companies order by id limit 1`;
          const companyId = crypto.randomUUID(),
            caseId = crypto.randomUUID(),
            itemId = crypto.randomUUID();
          await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id)
        values(${companyId},'Readiness synthetic fixture',${companyId},${companyId},'2020-01-01','2026-01-01','Test','Test','active',${base.assigned_owner_id},${base.assigned_team_id})`;
          await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id)
        values(${caseId},${companyId},2026,'2026-01-01','2026-02-12','Payment received','green',${base.assigned_owner_id})`;
          const documents = createDocumentRepository({ sql: tx });
          await tx`insert into case_parties(case_id,party_type,display_name,confirmed_by,confirmed_at) values(${caseId},'company','Confirmed synthetic company applicability',${base.assigned_owner_id},now())`;
          const received: string[] = [];
          for (const category of ["registry", "payment"] as const) {
            const intent = await documents.createUploadIntent({
              companyId,
              caseId,
              category,
              requestedByAuthUserId: "synthetic-local",
              fileName: "fixture.pdf",
              contentType: "application/pdf",
              expectedSizeBytes: 4,
              checksum: "a".repeat(64),
              objectKey: `readiness-local/${crypto.randomUUID()}`,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            });
            const document = await documents.finalizeUploadIntent({
              intentId: intent.id,
              uploadedBy: base.assigned_owner_id,
              source: "staff",
            });
            // Injected local contract, not a genuine scanner/R2 roundtrip.
            await documents.recordScanResult(
              intent.id,
              {
                status: "clean",
                providerReference: "synthetic-local",
                verifiedChecksum: "a".repeat(64),
                verifiedByteSize: 4,
              },
              { verdictSource: "provider" },
            );
            await documents.reviewDocument({
              documentId: document.id,
              decision: "verified",
              reviewerId: base.assigned_owner_id,
            });
            received.push(document.id);
          }
          await tx`insert into annual_return_checklist_items(id,case_id,item_label,required,status,due_date,document_id,received_at,verified_at)
        values(${itemId},${caseId},'CDD',true,'Verified','2026-02-01',${received[0]},now(),now())`;
          const [requirement] = await tx<
            { id: string }[]
          >`insert into case_requirement_instances(case_id,checklist_item_id,requirement_key,template_version) values(${caseId},${itemId},'cdd','annual-return-2026-09') returning id`;
          await tx`insert into requirement_evidence_links(requirement_instance_id,document_id,linked_by) values(${requirement.id},${received[0]},${base.assigned_owner_id})`;
          await tx`insert into payments(company_id,case_id,invoice_number,amount,currency,status,due_date,paid_at,payment_proof_document_id) values(${companyId},${caseId},${caseId},1800,'HKD','Payment received','2026-02-01',now(),${received[1]})`;
          const repository = createAnnualReturnRepository({ sql: tx });
          const preview = await repository.getCase(caseId);
          expect(preview?.readiness?.readyToPrepare).toBe(true);
          expect(preview?.readiness?.readyToTransmit).toBe(false);
          if (change === "payment")
            await tx`update payments set status='Payment pending',paid_at=null where case_id=${caseId}`;
          if (change === "evidence")
            await tx`update document_upload_intents set status='quarantined' where document_id=${received[0]}`;
          if (change === "none") {
            const updated = await repository.updateStatus(
              caseId,
              "NAR1 prepared",
              base.assigned_owner_id,
              preview!.readiness!.sourceVersion!,
            );
            expect(updated.currentStatus).toBe("NAR1 prepared");
          } else {
            await expect(
              repository.updateStatus(
                caseId,
                "NAR1 prepared",
                base.assigned_owner_id,
                preview!.readiness!.sourceVersion!,
              ),
            ).rejects.toMatchObject({ statusCode: 409 });
            const [actual] = await tx<
              { current_status: string }[]
            >`select current_status from annual_return_cases where id=${caseId}`;
            expect(actual.current_status).toBe("Payment received");
            expect((await repository.getCase(caseId))?.readiness?.readyToPrepare).toBe(false);
          }
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
  );
});
