import "dotenv/config";
import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentStorage } from "@/features/documents/types";
import { createDocumentRepository } from "@/features/documents/repository";
import { reconcilePaymentForActor } from "@/features/payments/reconciliation";
import { packageSha256 } from "./package-download";
import {
  getManualSubmissionForActor,
  listManualSubmissionProofsForActor,
  recordManualSubmissionForActor,
} from "./submission-service";
import {
  approvePackageForActor,
  downloadApprovedPackageForActor,
  preparePackageForActor,
} from "./package-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
let db: SqlClient | undefined;
function sqlForTests(): SqlClient {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL required.");
  db ??= createSqlClient(databaseUrl, { max: 2 });
  return db;
}
afterAll(async () => {
  if (db) await db.end();
});
const rollback = new Error("t14-fixture-rollback");
async function inRollbackFixture(
  work: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<void> {
  try {
    await sqlForTests().begin(async (tx) => {
      await work(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
function memoryStorage(): DocumentStorage {
  const objects = new Map<
    string,
    { body: ArrayBuffer; checksum: string; sizeBytes: number; contentType: string }
  >();
  return {
    async put(input) {
      const body = new Uint8Array(input.body).slice().buffer;
      objects.set(input.objectKey, {
        body,
        checksum: input.checksum,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
      });
      return {
        objectKey: input.objectKey,
        checksum: input.checksum,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
      };
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { ...object, objectKey: key } : null;
    },
    async head(key) {
      const object = objects.get(key);
      return object
        ? {
            objectKey: key,
            checksum: object.checksum,
            sizeBytes: object.sizeBytes,
            contentType: object.contentType,
          }
        : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
type Fixture = {
  actor: AuthenticatedActor;
  caseId: string;
  requirementId: string;
  observationId: string;
  proofVersionId: string;
  storage: DocumentStorage;
  createSubmissionProof: () => Promise<string>;
};
async function dbFixture(tx: postgres.TransactionSql): Promise<Fixture> {
  const [admin] = await tx<{ auth_user_id: string; user_id: string; team_id: string | null }[]>`
    select sp.auth_user_id,sp.user_id,sp.team_id from staff_profiles sp
    join users u on u.id=sp.user_id and u.active
    where sp.role='Admin' and sp.active limit 1`;
  const [team] = await tx<{ id: string }[]>`select id from teams limit 1`;
  if (!admin || !team) throw new Error("T14 fixture needs a seeded Admin and team.");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const actor: AuthenticatedActor = {
    authUserId: admin.auth_user_id,
    userId: admin.user_id,
    role: "Admin",
    teamId: admin.team_id,
    active: true,
  };
  const [company] = await tx<{ id: string }[]>`
    insert into companies (company_name,cr_number,br_number,incorporation_date,
      annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,
      assigned_team_id,data_origin)
    values ('T14 Fixture Limited',${"CR-T14-" + nonce},${"BR-T14-" + nonce},
      '2020-06-15','2020-06-15','Fixture office','Fixture secretary',
      ${admin.user_id},${team.id},'fixture') returning id`;
  const [annualCase] = await tx<{ id: string }[]>`
    insert into annual_return_cases
      (company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
    values (${company.id},2026,'2026-06-15','2026-08-10','Payment pending',${admin.user_id})
    returning id`;
  const invoiceRef = "T14-" + nonce;
  await tx`insert into payments
    (company_id,case_id,invoice_number,amount,currency,status,due_date)
    values (${company.id},${annualCase.id},${invoiceRef},1800,'HKD','Payment pending','2026-08-10')`;
  const [batch] = await tx<{ id: string }[]>`
    insert into nar_import_batches
      (source_file_name,source_sha256,source_size_bytes,sheet_name,parser_version,return_year,created_by)
    values (${"t14-" + nonce + ".xlsx"},${nonce.repeat(2)},256,'Fixture','t14-fixture',2026,${admin.user_id})
    returning id`;
  const [row] = await tx<{ id: string }[]>`
    insert into nar_import_rows
      (batch_id,row_number,external_client_id,company_name,raw,parsed,disposition,matched_company_id)
    values (${batch.id},2,${"T14-" + nonce},'T14 Fixture Limited',${tx.json({})},
      ${tx.json({})},'unchanged',${company.id}) returning id`;
  const [observation] = await tx<{ id: string }[]>`
    insert into nar_import_payment_observations
      (source_row_id,case_id,company_id,observed_date,raw_value,created_by)
    values (${row.id},${annualCase.id},${company.id},'2026-08-01','1/8/2026',${admin.user_id})
    returning id`;
  const storage = memoryStorage();
  const documents = createDocumentRepository({ sql: tx });
  async function reviewedDocument(category: "payment" | "registry" | "submission", suffix: string) {
    const bytes = new TextEncoder().encode("%PDF-1.7\n" + suffix);
    const checksum = await packageSha256(bytes);
    const objectKey = "documents/t14-fixture/" + nonce + "/" + suffix;
    await storage.put({
      objectKey,
      body: bytes,
      checksum,
      sizeBytes: bytes.byteLength,
      contentType: "application/pdf",
    });
    const intent = await documents.createUploadIntent({
      companyId: company.id,
      caseId: annualCase.id,
      requestedByAuthUserId: admin.auth_user_id,
      category,
      fileName: suffix + ".pdf",
      contentType: "application/pdf",
      expectedSizeBytes: bytes.byteLength,
      checksum,
      objectKey,
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
        providerReference: "t14-fixture-provider",
        verifiedChecksum: checksum,
        verifiedByteSize: bytes.byteLength,
      },
      { verdictSource: "provider", expectedChecksum: checksum },
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
    return { documentId: document.id, versionId: version.id };
  }
  const proof = await reviewedDocument("payment", "payment-proof");
  const reconciliation = await reconcilePaymentForActor(
    actor,
    {
      observationId: observation.id,
      caseId: annualCase.id,
      proofVersionId: proof.versionId,
      expectedRevision: 1,
      decision: "match",
      confirmation: { invoiceRef, amountMinor: 180000, currency: "HKD" },
    },
    tx,
  );
  if (reconciliation.status !== "matched")
    throw new Error("T14 payment fixture was not reconciled.");
  const nar1 = await reviewedDocument("registry", "nar1");
  const [checklist] = await tx<{ id: string }[]>`
    insert into annual_return_checklist_items
      (case_id,item_label,required,status,due_date,document_id,verified_at)
    values (${annualCase.id},'Signed NAR1',true,'Verified','2026-08-10',
      ${nar1.documentId},now()) returning id`;
  const [requirement] = await tx<{ id: string }[]>`
    insert into case_requirement_instances
      (case_id,checklist_item_id,requirement_key,template_version,applicability)
    values (${annualCase.id},${checklist.id},'Signed NAR1','t14-v1','required')
    returning id`;
  await tx`insert into requirement_evidence_links
    (requirement_instance_id,document_id,page_from,page_to,linked_by)
    values (${requirement.id},${nar1.documentId},1,1,${admin.user_id})`;
  return {
    actor,
    caseId: annualCase.id,
    requirementId: requirement.id,
    observationId: observation.id,
    proofVersionId: proof.versionId,
    storage,
    createSubmissionProof: async () =>
      (await reviewedDocument("submission", "submission-proof")).versionId,
  };
}
describe.skipIf(!databaseUrl)("T14 package approval against disposable Postgres", () => {
  it("prepares one immutable revision, audits human approval, and returns the same verified bytes twice", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const dependencies = { sql: tx, storage: fixture.storage };
      const draft = await preparePackageForActor(
        fixture.actor,
        {
          caseId: fixture.caseId,
          expectedRevision: 0,
        },
        dependencies,
      );
      expect(draft).toMatchObject({ state: "draft", revision: 1 });
      const again = await preparePackageForActor(
        fixture.actor,
        {
          caseId: fixture.caseId,
          expectedRevision: 1,
        },
        dependencies,
      );
      expect(again.id).toBe(draft.id);
      const approval = await approvePackageForActor(
        fixture.actor,
        {
          packageId: draft.id,
          manifestHash: draft.manifestHash,
          expectedRevision: 1,
        },
        dependencies,
      );
      expect(approval).toMatchObject({ id: draft.id, state: "approved" });
      const first = await downloadApprovedPackageForActor(fixture.actor, draft.id, dependencies);
      const second = await downloadApprovedPackageForActor(fixture.actor, draft.id, dependencies);
      expect(new Uint8Array(first.body)).toEqual(new Uint8Array(second.body));
      expect(first.checksum).toBe(draft.artifactSha256);
      const events = await tx<{ action: string }[]>`
        select action from annual_return_audit_events
        where case_id=${fixture.caseId} and action in ('prepare_package','approve_package')
        order by created_at,id`;
      expect(events.map((event) => event.action).sort()).toEqual([
        "approve_package",
        "prepare_package",
      ]);
      await expect(
        approvePackageForActor(
          fixture.actor,
          {
            packageId: draft.id,
            manifestHash: draft.manifestHash,
            expectedRevision: 1,
          },
          dependencies,
        ),
      ).rejects.toThrow(/stale|already/i);
      await tx`update case_requirement_instances
        set requirement_key='Changed NAR1',updated_at=now() where id=${fixture.requirementId}`;
      await expect(
        downloadApprovedPackageForActor(fixture.actor, draft.id, dependencies),
      ).rejects.toThrow(/stale/i);
    });
  });

  it("invalidates an approved package when the reconciled payment observation is revoked", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const dependencies = { sql: tx, storage: fixture.storage };
      const draft = await preparePackageForActor(
        fixture.actor,
        {
          caseId: fixture.caseId,
          expectedRevision: 0,
        },
        dependencies,
      );
      await approvePackageForActor(
        fixture.actor,
        {
          packageId: draft.id,
          manifestHash: draft.manifestHash,
          expectedRevision: 1,
        },
        dependencies,
      );
      await tx`update nar_import_payment_observations
        set status='rejected',revision=revision+1 where id=${fixture.observationId}`;
      await expect(
        downloadApprovedPackageForActor(fixture.actor, draft.id, dependencies),
      ).rejects.toThrow(/payment/i);
    });
  });
});

function asHongKongDateTime(value: Date): string {
  return new Date(value.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 19) + "+08:00";
}

describe.skipIf(!databaseUrl)("T15 manual submission against disposable Postgres", () => {
  it("records exactly one external submission, preserving evidence and leaving case unfiled", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const dependencies = { sql: tx, storage: fixture.storage };
      const draft = await preparePackageForActor(
        fixture.actor,
        { caseId: fixture.caseId, expectedRevision: 0 },
        dependencies,
      );
      await approvePackageForActor(
        fixture.actor,
        { packageId: draft.id, manifestHash: draft.manifestHash, expectedRevision: 1 },
        dependencies,
      );
      await downloadApprovedPackageForActor(fixture.actor, draft.id, dependencies);
      const [before] = await tx<{ count: number }[]>`
        select count(*)::int as count from package_handoffs where case_id = ${fixture.caseId}`;
      expect(before.count).toBe(0);
      expect(
        await getManualSubmissionForActor(fixture.actor, fixture.caseId, dependencies),
      ).toBeNull();
      const proofVersionId = await fixture.createSubmissionProof();
      expect(
        await listManualSubmissionProofsForActor(fixture.actor, fixture.caseId, dependencies),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ versionId: proofVersionId, category: "submission" }),
        ]),
      );
      const input = {
        packageId: draft.id,
        manifestHash: draft.manifestHash,
        expectedRevision: draft.revision,
        submittedAt: asHongKongDateTime(new Date(Date.now() + 2_000)),
        destinationLabel: "Companies Registry portal",
        externalReference: "NAR1-" + crypto.randomUUID(),
        proofVersionId,
      };
      const first = await recordManualSubmissionForActor(fixture.actor, input, dependencies);
      const replay = await recordManualSubmissionForActor(fixture.actor, input, dependencies);
      expect(replay.id).toBe(first.id);
      expect(
        await getManualSubmissionForActor(fixture.actor, fixture.caseId, dependencies),
      ).toMatchObject({ id: first.id });
      expect(first).toMatchObject({
        packageId: draft.id,
        manifestHash: draft.manifestHash,
        proofVersionId,
        status: "recorded_submission",
      });
      expect(first.submittedAtUtc).toBe(new Date(input.submittedAt).toISOString());
      const [state] = await tx<{ status: string; transmitted_at: Date | null; count: number }[]>`
        select arc.current_status as status, ph.transmitted_at,
          (select count(*)::int from package_handoffs where case_id = ${fixture.caseId}) as count
        from annual_return_cases arc join package_handoffs ph on ph.case_id=arc.id
        where arc.id = ${fixture.caseId}`;
      expect(state).toMatchObject({ status: "Payment pending", transmitted_at: null, count: 1 });
      const events = await tx<{ action: string }[]>`
        select action from annual_return_audit_events
        where case_id = ${fixture.caseId} and action = 'record_submission'`;
      expect(events).toHaveLength(1);
      await expect(
        recordManualSubmissionForActor(
          fixture.actor,
          { ...input, externalReference: "different-reference" },
          dependencies,
        ),
      ).rejects.toThrow(/already|live/i);
    });
  });

  it("refuses old approval, wrong proof category, unauthorized actor and preapproval time", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const dependencies = { sql: tx, storage: fixture.storage };
      const draft = await preparePackageForActor(
        fixture.actor,
        { caseId: fixture.caseId, expectedRevision: 0 },
        dependencies,
      );
      await approvePackageForActor(
        fixture.actor,
        { packageId: draft.id, manifestHash: draft.manifestHash, expectedRevision: 1 },
        dependencies,
      );
      const proofVersionId = await fixture.createSubmissionProof();
      const input = {
        packageId: draft.id,
        manifestHash: draft.manifestHash,
        expectedRevision: 1,
        submittedAt: asHongKongDateTime(new Date(Date.now() + 2_000)),
        destinationLabel: "Companies Registry portal",
        externalReference: "NAR1-" + crypto.randomUUID(),
        proofVersionId,
      };
      await expect(
        recordManualSubmissionForActor(
          fixture.actor,
          { ...input, proofVersionId: fixture.proofVersionId },
          dependencies,
        ),
      ).rejects.toThrow(/submission or receipt/i);
      await expect(
        recordManualSubmissionForActor(
          fixture.actor,
          { ...input, expectedRevision: 2 },
          dependencies,
        ),
      ).rejects.toThrow(/exact approved/i);
      await expect(
        recordManualSubmissionForActor(
          fixture.actor,
          { ...input, submittedAt: "2020-01-01T12:00:00+08:00" },
          dependencies,
        ),
      ).rejects.toThrow(/precede/i);
      await expect(
        recordManualSubmissionForActor(
          { ...fixture.actor, role: "Client" } as AuthenticatedActor,
          input,
          dependencies,
        ),
      ).rejects.toThrow(/staff/i);
      const [unassigned] = await tx<
        {
          auth_user_id: string;
          user_id: string;
          team_id: string | null;
        }[]
      >`
        select auth_user_id,user_id,team_id from staff_profiles
        where role = 'Staff' and active and user_id <> ${fixture.actor.userId}
        limit 1`;
      expect(unassigned).toBeTruthy();
      await expect(
        recordManualSubmissionForActor(
          {
            authUserId: unassigned.auth_user_id,
            userId: unassigned.user_id,
            role: "Staff",
            teamId: unassigned.team_id,
            active: true,
          },
          input,
          dependencies,
        ),
      ).rejects.toThrow(/record external submissions/i);
      await tx`
        update case_requirement_instances
        set requirement_key = 'Changed after approval',updated_at=now()
        where id = ${fixture.requirementId}`;
      await expect(
        recordManualSubmissionForActor(fixture.actor, input, dependencies),
      ).rejects.toThrow(/stale/i);
      const newer = await preparePackageForActor(
        fixture.actor,
        { caseId: fixture.caseId, expectedRevision: 1 },
        dependencies,
      );
      expect(newer.revision).toBe(2);
      await approvePackageForActor(
        fixture.actor,
        { packageId: newer.id, manifestHash: newer.manifestHash, expectedRevision: 2 },
        dependencies,
      );
      await expect(
        recordManualSubmissionForActor(fixture.actor, input, dependencies),
      ).rejects.toThrow(/newer package/i);
    });
  });
});
