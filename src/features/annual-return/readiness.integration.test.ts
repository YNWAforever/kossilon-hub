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
  it.each([
    "none",
    "payment",
    "evidence",
    "shared-finding",
    "paid-at",
    "review-version",
    "stub-scan",
    "unconfirmed-party",
    "missing-instance",
    "waived",
    "requirement-finding",
  ] as const)("rechecks current source inside preparation transaction: %s", async (change) => {
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
            expectedVersionId: document.currentVersionId!,
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
        await tx`insert into payment_evidence_entries(payment_id,case_id,document_id,proof_version_id,proof_sha256,amount,received_on,status,recorded_by,reviewed_by,reviewed_at) select p.id,p.case_id,v.document_id,v.id,v.verified_checksum_sha256,1800,'2026-02-01','verified',${base.assigned_owner_id},${base.assigned_owner_id},now() from payments p join document_versions v on v.document_id=p.payment_proof_document_id and v.superseded_by_version_id is null where p.case_id=${caseId}`;
        const repository = createAnnualReturnRepository({ sql: tx });
        const preview = await repository.getCase(caseId);
        const sqlPage = await repository.listWorkView({
          view: "readyToFile",
          scope: { caseIds: [caseId] },
          viewerUserId: base.assigned_owner_id,
        });
        expect(sqlPage.rows.map((row) => row.caseId)).toEqual(
          preview?.readiness?.readyForApproval ? [caseId] : [],
        );
        expect(preview?.readiness?.readyToPrepare).toBe(true);
        expect(preview?.readiness?.readyToTransmit).toBe(false);
        if (change === "shared-finding") {
          await tx`update documents set case_id=null where id=${received[0]}`;
          await tx`update document_upload_intents set case_id=null where document_id=${received[0]}`;
          const beforeFinding = await repository.getCase(caseId);
          const [version] = await tx<
            { id: string }[]
          >`select id from document_versions where document_id=${received[0]} and superseded_by_version_id is null`;
          await tx`insert into document_findings(document_version_id,tier,rule_key,rule_version,outcome,severity,detail) values(${version.id},'cross-check','synthetic-shared-critical','1','issue','critical','Shared company evidence conflict')`;
          const afterFinding = await repository.getCase(caseId);
          expect(afterFinding?.readiness?.readyForApproval).toBe(false);
          expect(
            (
              await repository.listWorkView({
                view: "readyToFile",
                scope: { caseIds: [caseId] },
                viewerUserId: base.assigned_owner_id,
              })
            ).rows,
          ).toEqual([]);
          expect(afterFinding?.readiness?.sourceVersion).not.toBe(
            beforeFinding?.readiness?.sourceVersion,
          );
          throw rollback;
        }
        if (change === "payment")
          await tx`update payments set status='Payment pending',paid_at=null where case_id=${caseId}`;
        if (change === "evidence")
          await tx`update document_upload_intents set status='quarantined' where document_id=${received[0]}`;
        if (change === "paid-at")
          await tx`update payments set paid_at=null where case_id=${caseId}`;
        if (change === "review-version")
          await tx`update documents set reviewed_document_version_id=null where id=${received[0]}`;
        if (change === "stub-scan")
          await tx`update document_upload_intents set scan_verdict_source='deterministic' where document_id=${received[0]}`;
        if (change === "unconfirmed-party")
          await tx`update case_parties set confirmed_by=null,confirmed_at=null where case_id=${caseId}`;
        if (change === "missing-instance")
          await tx`update case_requirement_instances set requirement_key='wrong-key' where id=${requirement.id}`;
        if (change === "requirement-finding")
          await tx`insert into document_findings(requirement_instance_id,tier,rule_key,rule_version,outcome,severity,detail) values(${requirement.id},'cross-check','local-requirement-critical','1','issue','critical','Owned parity contract')`;
        if (change === "waived") {
          await tx`update case_requirement_instances set applicability='not_applicable',applicability_reason='Owned explicit decision',authorized_by=${base.assigned_owner_id},updated_at=now() where id=${requirement.id}`;
          await tx`delete from requirement_evidence_links where requirement_instance_id=${requirement.id}`;
          await tx`update annual_return_checklist_items set status='Missing',document_id=null,received_at=null,verified_at=null where id=${itemId}`;
        }
        const after = await repository.getCase(caseId);
        expect(
          (
            await repository.listWorkView({
              view: "readyToFile",
              scope: { caseIds: [caseId] },
              viewerUserId: base.assigned_owner_id,
            })
          ).rows.map((r) => r.caseId),
        ).toEqual(after?.readiness?.readyForApproval ? [caseId] : []);
        if (change === "waived") {
          expect(after?.readiness?.readyForApproval).toBe(true);
          throw rollback;
        }
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
          expect((await repository.getCase(caseId))?.readiness?.readyForApproval).toBe(false);
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
