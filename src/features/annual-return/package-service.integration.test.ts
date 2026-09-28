import "dotenv/config";
import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentStorage } from "@/features/documents/types";
import { createDocumentRepository } from "@/features/documents/repository";
import { createBulkOperationRepository } from "@/features/bulk-operations/repository";
import { createAnnualReturnRepository } from "./repository";
import { reconcilePaymentForActor } from "@/features/payments/reconciliation";
import { packageSha256 } from "./package-download";
import { ingestReturnForActor, reconcileReturnForActor } from "./return-service";
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
  createReturnProof: (suffix: string) => Promise<string>;
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
  async function reviewedDocument(
    category: "payment" | "registry" | "submission" | "receipt",
    suffix: string,
  ) {
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
      (case_id,item_label,required,status,due_date,document_id,received_at,verified_at)
    values (${annualCase.id},'Signed NAR1',true,'Verified','2026-08-10',
      ${nar1.documentId},now(),now()) returning id`;
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
    createReturnProof: async (suffix) => (await reviewedDocument("receipt", suffix)).versionId,
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

describe.skipIf(!databaseUrl)("T16 return intake against disposable Postgres", () => {
  it("keeps download and recorded submission distinct, deduplicates return proof, and reconciles accepted only by a human", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const deps = { sql: tx, storage: fixture.storage };
      const draft = await preparePackageForActor(
        fixture.actor,
        { caseId: fixture.caseId, expectedRevision: 0 },
        deps,
      );
      await approvePackageForActor(
        fixture.actor,
        { packageId: draft.id, manifestHash: draft.manifestHash, expectedRevision: 1 },
        deps,
      );
      const submissionProof = await fixture.createSubmissionProof();
      const submitted = await recordManualSubmissionForActor(
        fixture.actor,
        {
          packageId: draft.id,
          manifestHash: draft.manifestHash,
          expectedRevision: 1,
          submittedAt: asHongKongDateTime(new Date(Date.now() + 2_000)),
          destinationLabel: "Companies Registry portal",
          externalReference: "NAR1-" + crypto.randomUUID(),
          proofVersionId: submissionProof,
        },
        deps,
      );
      const proofVersionId = await fixture.createReturnProof("accepted-return");
      const input = {
        caseId: fixture.caseId,
        externalReference: submitted.externalReference,
        manifestHash: draft.manifestHash,
        outcome: "accepted" as const,
        source: { kind: "manual" as const, proofVersionId },
      };
      const received = await ingestReturnForActor(fixture.actor, input, deps);
      expect(received).toMatchObject({
        matchState: "candidate",
        candidateHandoffIds: [submitted.id],
        open: true,
        duplicate: false,
      });
      expect(await ingestReturnForActor(fixture.actor, input, deps)).toMatchObject({
        id: received.id,
        duplicate: true,
      });
      await expect(
        ingestReturnForActor(fixture.actor, { ...input, outcome: "rejected" }, deps),
      ).rejects.toThrow(/conflicting claims/i);
      await expect(
        ingestReturnForActor(
          fixture.actor,
          {
            ...input,
            source: { kind: "manual", proofVersionId: submissionProof },
          },
          deps,
        ),
      ).rejects.toThrow(/receipt|category/i);
      await expect(
        reconcileReturnForActor(
          fixture.actor,
          {
            returnId: received.id,
            submissionId: submitted.id,
            expectedRevision: 2,
            decision: "confirm",
            reason: "",
          },
          deps,
        ),
      ).rejects.toThrow(/revision/i);
      const [counts] = await tx<{ returns: number; source_cursors: number }[]>`
        select (select count(*)::int from handoff_returns
          where case_id = ${fixture.caseId}) as returns,
          (select count(*)::int from filing_return_source_cursors) as source_cursors`;
      expect(counts).toMatchObject({ returns: 1, source_cursors: 0 });
      const decision = await reconcileReturnForActor(
        fixture.actor,
        {
          returnId: received.id,
          submissionId: submitted.id,
          expectedRevision: 1,
          decision: "confirm",
          reason: "",
        },
        deps,
      );
      expect(decision).toMatchObject({
        matchState: "reconciled",
        outcome: "accepted",
        open: false,
        revision: 2,
      });
      expect(
        await reconcileReturnForActor(
          fixture.actor,
          {
            returnId: received.id,
            submissionId: submitted.id,
            expectedRevision: 1,
            decision: "confirm",
            reason: "",
          },
          deps,
        ),
      ).toMatchObject({ id: received.id, duplicate: true, revision: 2 });
      const [caseRow] = await tx<{ current_status: string }[]>`
        select current_status from annual_return_cases where id = ${fixture.caseId}`;
      expect(caseRow.current_status).toBe("Payment pending");
      const [audit] = await tx<{ intakes: number; reviews: number }[]>`
        select count(*) filter (where action='record_return_intake')::int as intakes,
          count(*) filter (where action='reconcile_return')::int as reviews
        from annual_return_audit_events where case_id = ${fixture.caseId}`;
      expect(audit).toMatchObject({ intakes: 1, reviews: 1 });
    });
  });

  it("keeps partial and unmatched returns open and requires a reason when the manifest hash is absent", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const deps = { sql: tx, storage: fixture.storage };
      const draft = await preparePackageForActor(
        fixture.actor,
        { caseId: fixture.caseId, expectedRevision: 0 },
        deps,
      );
      await approvePackageForActor(
        fixture.actor,
        {
          packageId: draft.id,
          manifestHash: draft.manifestHash,
          expectedRevision: 1,
        },
        deps,
      );
      const submitted = await recordManualSubmissionForActor(
        fixture.actor,
        {
          packageId: draft.id,
          manifestHash: draft.manifestHash,
          expectedRevision: 1,
          submittedAt: asHongKongDateTime(new Date(Date.now() + 2_000)),
          destinationLabel: "Companies Registry portal",
          externalReference: "NAR1-" + crypto.randomUUID(),
          proofVersionId: await fixture.createSubmissionProof(),
        },
        deps,
      );
      const partial = await ingestReturnForActor(
        fixture.actor,
        {
          caseId: fixture.caseId,
          externalReference: submitted.externalReference,
          manifestHash: null,
          outcome: "partial",
          source: {
            kind: "manual",
            proofVersionId: await fixture.createReturnProof("partial-return"),
          },
        },
        deps,
      );
      await expect(
        reconcileReturnForActor(
          fixture.actor,
          {
            returnId: partial.id,
            submissionId: submitted.id,
            expectedRevision: 1,
            decision: "confirm",
            reason: "",
          },
          deps,
        ),
      ).rejects.toThrow(/reason/i);
      const matchedPartial = await reconcileReturnForActor(
        fixture.actor,
        {
          returnId: partial.id,
          submissionId: submitted.id,
          expectedRevision: 1,
          decision: "confirm",
          reason: "Checked external reference and reviewed receipt",
        },
        deps,
      );
      expect(matchedPartial).toMatchObject({ outcome: "partial", open: true });
      const unmatched = await ingestReturnForActor(
        fixture.actor,
        {
          caseId: fixture.caseId,
          externalReference: "UNKNOWN-" + crypto.randomUUID(),
          manifestHash: null,
          outcome: "rejected",
          source: {
            kind: "manual",
            proofVersionId: await fixture.createReturnProof("unmatched-return"),
          },
        },
        deps,
      );
      expect(unmatched).toMatchObject({
        matchState: "unmatched",
        candidateHandoffIds: [],
        open: true,
      });
      const reviewedUnmatched = await reconcileReturnForActor(
        fixture.actor,
        {
          returnId: unmatched.id,
          submissionId: null,
          expectedRevision: 1,
          decision: "mark-unmatched",
          reason: "No matching external submission reference",
        },
        deps,
      );
      expect(reviewedUnmatched).toMatchObject({
        matchState: "unmatched",
        outcome: "rejected",
        open: true,
      });
    });
  });
});

describe.skipIf(!databaseUrl)("T24 package, submission and return batch service reuse", () => {
  it("keeps package draft, manual proof and return candidate as separate per-item approvals", async () => {
    await inRollbackFixture(async (tx) => {
      const fx = await dbFixture(tx);
      const repo = createBulkOperationRepository({ sql: tx, storage: fx.storage });
      const prepare = await repo.preview(fx.actor, {
        action: "preparePackages",
        selection: { kind: "ids", ids: [fx.caseId] },
        parameters: { items: [{ caseId: fx.caseId, expectedRevision: 0 }] },
      });
      expect(prepare.eligibleCount).toBe(1);
      const prepareOperation = await repo.commit(fx.actor, {
        previewId: prepare.id,
        previewHash: prepare.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const prepared = await repo.runBatch(prepareOperation.id, { limit: 1 });
      expect(prepared.items[0].state).toBe("succeeded");
      const [draft] = await tx<
        { id: string; state: string; revision: number; manifest_sha256: string }[]
      >`
        select id,state,revision,manifest_sha256 from filing_packages where case_id=${fx.caseId}`;
      expect(draft).toMatchObject({ state: "draft", revision: 1 });
      const stale = await repo.preview(fx.actor, {
        action: "preparePackages",
        selection: { kind: "ids", ids: [fx.caseId] },
        parameters: { items: [{ caseId: fx.caseId, expectedRevision: 0 }] },
      });
      expect(stale.itemsPreview[0]).toMatchObject({
        state: "conflict",
        reasonCode: "REVISION_CHANGED",
      });
      await approvePackageForActor(
        fx.actor,
        {
          packageId: draft.id,
          manifestHash: draft.manifest_sha256,
          expectedRevision: 1,
        },
        { sql: tx, storage: fx.storage },
      );
      const submissionProof = await fx.createSubmissionProof();
      const reference = "T24-PORTAL-" + crypto.randomUUID();
      const submissionInput = {
        caseId: fx.caseId,
        packageId: draft.id,
        manifestHash: draft.manifest_sha256,
        expectedRevision: 1,
        submittedAt: asHongKongDateTime(new Date(Date.now() + 2_000)),
        destinationLabel: "Companies Registry portal",
        externalReference: reference,
        proofVersionId: submissionProof,
      };
      const badProof = await repo.preview(fx.actor, {
        action: "recordSubmissions",
        selection: { kind: "ids", ids: [draft.id] },
        parameters: { items: [{ ...submissionInput, proofVersionId: crypto.randomUUID() }] },
      });
      expect(badProof.itemsPreview[0]).toMatchObject({
        state: "conflict",
        reasonCode: "SUBMISSION_PROOF_NOT_READY",
      });
      const submission = await repo.preview(fx.actor, {
        action: "recordSubmissions",
        selection: { kind: "ids", ids: [draft.id] },
        parameters: { items: [submissionInput] },
      });
      expect(submission.eligibleCount).toBe(1);
      const submissionOperation = await repo.commit(fx.actor, {
        previewId: submission.id,
        previewHash: submission.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const recorded = await repo.runBatch(submissionOperation.id, { limit: 1 });
      expect(recorded.items[0]).toMatchObject({ state: "succeeded", auditRef: expect.any(String) });
      const [handoff] = await tx<{ id: string; status: string; destination_reference: string }[]>`
        select id,status,destination_reference from package_handoffs where case_id=${fx.caseId}`;
      expect(handoff).toMatchObject({
        status: "recorded_submission",
        destination_reference: reference,
      });
      const receiptProof = await fx.createReturnProof("t24-receipt");
      const intake = {
        caseId: fx.caseId,
        externalReference: reference,
        manifestHash: draft.manifest_sha256,
        outcome: "accepted" as const,
        source: { kind: "manual" as const, proofVersionId: receiptProof },
      };
      const returnPreview = await repo.preview(fx.actor, {
        action: "matchReturns",
        selection: { kind: "ids", ids: [receiptProof] },
        parameters: { items: [intake] },
      });
      expect(returnPreview.eligibleCount).toBe(1);
      const returnOperation = await repo.commit(fx.actor, {
        previewId: returnPreview.id,
        previewHash: returnPreview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const matched = await repo.runBatch(returnOperation.id, { limit: 1 });
      expect(matched.items[0]).toMatchObject({
        state: "succeeded",
        reasonCode: "RETURN_CANDIDATE_ONLY",
      });
      const [returnRow] = await tx<{ match_state: string; reconciled_at: Date | null }[]>`
        select match_state,reconciled_at from handoff_returns where document_version_id=${receiptProof}`;
      expect(returnRow).toMatchObject({ match_state: "candidate", reconciled_at: null });
      const replayPreview = await repo.preview(fx.actor, {
        action: "matchReturns",
        selection: { kind: "ids", ids: [receiptProof] },
        parameters: { items: [{ ...intake, detail: "Duplicate source reread" }] },
      });
      const replayOperation = await repo.commit(fx.actor, {
        previewId: replayPreview.id,
        previewHash: replayPreview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const replayed = await repo.runBatch(replayOperation.id, { limit: 1 });
      expect(replayed.items[0]).toMatchObject({
        state: "skipped",
        reasonCode: "RETURN_ALREADY_INGESTED",
      });
      const [count] = await tx<{ count: number }[]>`
        select count(*)::int count from handoff_returns where document_version_id=${receiptProof}`;
      expect(count.count).toBe(1);
      const [caseRow] = await tx<{ current_status: string }[]>`
        select current_status from annual_return_cases where id=${fx.caseId}`;
      expect(caseRow.current_status).not.toBe("Filed");
    });
  });
});

describe.skipIf(!databaseUrl)("T29 local filing journey", () => {
  it("t29_scenario_2 requires approved bytes, external submission proof and accepted return before completion", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const deps = { sql: tx, storage: fixture.storage };
      const cases = createAnnualReturnRepository({ sql: tx });
      await expect(
        cases.updateStatus(fixture.caseId, "Completed", fixture.actor.userId!),
      ).rejects.toThrow(/Cannot complete/i);

      const draft = await preparePackageForActor(
        fixture.actor,
        { caseId: fixture.caseId, expectedRevision: 0 },
        deps,
      );
      await approvePackageForActor(
        fixture.actor,
        { packageId: draft.id, manifestHash: draft.manifestHash, expectedRevision: 1 },
        deps,
      );
      const downloaded = await downloadApprovedPackageForActor(fixture.actor, draft.id, deps);
      expect(downloaded.checksum).toBe(draft.artifactSha256);
      await expect(
        cases.updateStatus(fixture.caseId, "Completed", fixture.actor.userId!),
      ).rejects.toThrow(/recorded submission proof and reconciled accepted return/i);

      expect((await cases.getCase(fixture.caseId))?.currentStatus).toBe("Payment pending");

      const submitted = await recordManualSubmissionForActor(
        fixture.actor,
        {
          packageId: draft.id,
          manifestHash: draft.manifestHash,
          expectedRevision: 1,
          submittedAt: asHongKongDateTime(new Date(Date.now() + 2_000)),
          destinationLabel: "Companies Registry portal",
          externalReference: "NAR1-" + crypto.randomUUID(),
          proofVersionId: await fixture.createSubmissionProof(),
        },
        deps,
      );
      expect(submitted.status).toBe("recorded_submission");
      await expect(
        cases.updateStatus(fixture.caseId, "Completed", fixture.actor.userId!),
      ).rejects.toThrow(/recorded submission proof and reconciled accepted return/i);

      expect((await cases.getCase(fixture.caseId))?.currentStatus).toBe("Payment pending");

      const received = await ingestReturnForActor(
        fixture.actor,
        {
          caseId: fixture.caseId,
          externalReference: submitted.externalReference,
          manifestHash: draft.manifestHash,
          outcome: "accepted",
          source: {
            kind: "manual",
            proofVersionId: await fixture.createReturnProof("t29-accepted"),
          },
        },
        deps,
      );
      expect(received.matchState).toBe("candidate");
      await expect(
        cases.updateStatus(fixture.caseId, "Completed", fixture.actor.userId!),
      ).rejects.toThrow(/recorded submission proof and reconciled accepted return/i);

      const reviewed = await reconcileReturnForActor(
        fixture.actor,
        {
          returnId: received.id,
          submissionId: submitted.id,
          expectedRevision: 1,
          decision: "confirm",
          reason: "",
        },
        deps,
      );
      expect(reviewed).toMatchObject({ matchState: "reconciled", outcome: "accepted" });
      expect((await cases.getCase(fixture.caseId))?.currentStatus).toBe("Payment pending");

      const completed = await cases.updateStatus(
        fixture.caseId,
        "Completed",
        fixture.actor.userId!,
      );
      expect(completed).toMatchObject({ currentStatus: "Completed" });
    });
  });
  it("t29_review blocks a new case with legacy filing fields but no approved package or return", async () => {
    await inRollbackFixture(async (tx) => {
      const fixture = await dbFixture(tx);
      const proofVersionId = await fixture.createSubmissionProof();
      const [proof] = await tx<{ document_id: string }[]>`
        select document_id from document_versions where id = ${proofVersionId}
      `;
      await tx`
        update annual_return_cases
        set filing_reference = 'LEGACY-T29-REVIEW',
            confirmation_document_id = ${proof.document_id}
        where id = ${fixture.caseId}
      `;
      const cases = createAnnualReturnRepository({ sql: tx });
      await expect(
        cases.updateStatus(fixture.caseId, "Completed", fixture.actor.userId!),
      ).rejects.toThrow(/approved package.*submission proof.*accepted return/i);
      expect((await cases.getCase(fixture.caseId))?.currentStatus).toBe("Payment pending");
    });
  });
});
