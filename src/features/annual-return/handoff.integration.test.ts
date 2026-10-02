import { afterAll, describe, expect, it } from "vitest";
import { deriveWorkViews } from "./work-views";
import { createSqlClient } from "@/server/db/client";
import { createDocumentRepository } from "@/features/documents/repository";
import { createAnnualReturnRepository } from "./repository";
import { createHandoffRepository } from "./handoff-repository";
import type { AuthenticatedActor } from "@/features/auth/types";

const url = process.env.TEST_DATABASE_URL,
  sql = url ? createSqlClient(url, { max: 2 }) : null;
afterAll(async () => {
  await sql?.end();
});
const rollback = new Error("Synthetic local handoff contract rollback");
async function seedFixture(tx: import("postgres").TransactionSql) {
  const [base] = await tx<
    {
      user_id: string;
      auth_user_id: string;
      role: AuthenticatedActor["role"];
      team_id: string;
    }[]
  >`select u.id user_id,sp.auth_user_id,u.role,u.team_id from users u join staff_profiles sp on sp.user_id=u.id where u.active and sp.active and u.role='Admin' order by u.id limit 1`;
  const actor: AuthenticatedActor = {
    userId: base.user_id,
    authUserId: base.auth_user_id,
    role: base.role,
    teamId: base.team_id,
    active: true,
  };
  const companyId = crypto.randomUUID(),
    caseId = crypto.randomUUID(),
    itemId = crypto.randomUUID();
  await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id,data_origin) values(${companyId},'Synthetic local handoff',${companyId},${companyId},'2020-01-01','2026-10-01','Test','Test','active',${base.user_id},${base.team_id},'client')`;
  await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id) values(${caseId},${companyId},2026,'2026-10-01','2026-11-12','Payment received','green',${base.user_id})`;
  await tx`insert into case_parties(case_id,party_type,display_name,confirmed_by,confirmed_at) values(${caseId},'company','Synthetic confirmed party',${base.user_id},now())`;
  const docs = createDocumentRepository({ sql: tx }),
    received: string[] = [];
  for (const category of ["registry", "payment"] as const) {
    const intent = await docs.createUploadIntent({
      companyId,
      caseId,
      category,
      requestedByAuthUserId: base.auth_user_id,
      fileName: "Synthetic contract.pdf",
      contentType: "application/pdf",
      expectedSizeBytes: 4,
      checksum: "a".repeat(64),
      objectKey: "synthetic-local/" + crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    const doc = await docs.finalizeUploadIntent({
      intentId: intent.id,
      uploadedBy: base.user_id,
      source: "staff",
    });
    // Explicit injected contract verdict inside this rolled-back isolated test;
    // no actual scanner/R2/receipt/provider or production acceptance is claimed.
    await docs.recordScanResult(
      intent.id,
      {
        status: "clean",
        providerReference: "synthetic-local-only",
        verifiedChecksum: "a".repeat(64),
        verifiedByteSize: 4,
      },
      { verdictSource: "provider" },
    );
    await docs.reviewDocument({
      documentId: doc.id,
      expectedVersionId: doc.currentVersionId!,
      decision: "verified",
      reviewerId: base.user_id,
      reviewerAuthUserId: base.auth_user_id,
    });
    received.push(doc.id);
  }
  await tx`insert into annual_return_checklist_items(id,case_id,item_label,required,status,due_date,document_id,received_at,verified_at) values(${itemId},${caseId},'Synthetic CDD',true,'Verified','2026-11-01',${received[0]},now(),now())`;
  const [requirement] = await tx<
    { id: string }[]
  >`insert into case_requirement_instances(case_id,checklist_item_id,requirement_key,template_version) values(${caseId},${itemId},'cdd','synthetic-handoff-v1') returning id`;
  await tx`insert into requirement_evidence_links(requirement_instance_id,document_id,linked_by) values(${requirement.id},${received[0]},${base.user_id})`;
  await tx`insert into payments(company_id,case_id,invoice_number,amount,currency,status,due_date,paid_at,payment_proof_document_id) values(${companyId},${caseId},${caseId},1200,'HKD','Payment received','2026-11-01',now(),${received[1]})`;
  await tx`insert into payment_evidence_entries(payment_id,case_id,document_id,proof_version_id,proof_sha256,amount,received_on,status,recorded_by,reviewed_by,reviewed_at) select p.id,p.case_id,v.document_id,v.id,v.verified_checksum_sha256,1200,'2026-10-01','verified',${base.user_id},${base.user_id},now() from payments p join document_versions v on v.document_id=p.payment_proof_document_id and v.superseded_by_version_id is null where p.case_id=${caseId}`;
  return { actor, companyId, caseId, received };
}
describe.skipIf(!url)("actual Postgres approved manual handoff facts", () => {
  async function fixture(
    run: (
      tx: import("postgres").TransactionSql,
      f: Awaited<ReturnType<typeof seedFixture>>,
    ) => Promise<void>,
  ) {
    await expect(
      sql!.begin(async (tx) => {
        const f = await seedFixture(tx);
        await run(tx, f);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }
  async function submitted(
    tx: import("postgres").TransactionSql,
    f: Awaited<ReturnType<typeof seedFixture>>,
  ) {
    const repo = createHandoffRepository({ sql: tx });
    let p = await repo.preview(f.actor, f.caseId);
    const h = await repo.approve(f.actor, {
      caseId: f.caseId,
      expectedVersion: p.sourceVersion!,
      manifestSha256: p.manifestSha256!,
    });
    p = await repo.preview(f.actor, f.caseId);
    await repo.recordExport(f.actor, { handoffId: h.id, expectedVersion: p.sourceVersion! });
    p = await repo.preview(f.actor, f.caseId);
    await repo.recordManualSubmission(f.actor, {
      handoffId: h.id,
      expectedVersion: p.sourceVersion!,
      occurredAt: new Date().toISOString(),
      reference: "Synthetic submitted",
      note: "Synthetic local attestation only",
      evidenceDocumentId: null,
      evidenceVersionId: null,
    });
    return { repo, h };
  }
  it("withdrawn and returned attempts retain history while a new active approval replays only itself", async () =>
    fixture(async (tx, f) => {
      const repo = createHandoffRepository({ sql: tx });
      let p = await repo.preview(f.actor, f.caseId);
      const a = await repo.approve(f.actor, {
        caseId: f.caseId,
        expectedVersion: p.sourceVersion!,
        manifestSha256: p.manifestSha256!,
      });
      p = await repo.preview(f.actor, f.caseId);
      await repo.withdraw(f.actor, {
        handoffId: a.id,
        expectedVersion: p.sourceVersion!,
        note: "Human re-review required",
      });
      p = await repo.preview(f.actor, f.caseId);
      const command = {
        caseId: f.caseId,
        expectedVersion: p.sourceVersion!,
        manifestSha256: p.manifestSha256!,
      };
      const b = await repo.approve(f.actor, command);
      expect(b.id).not.toBe(a.id);
      expect(b.status).toBe("prepared");
      expect((await repo.approve(f.actor, command)).id).toBe(b.id);
      p = await repo.preview(f.actor, f.caseId);
      await repo.recordExport(f.actor, { handoffId: b.id, expectedVersion: p.sourceVersion! });
      p = await repo.preview(f.actor, f.caseId);
      await repo.recordManualSubmission(f.actor, {
        handoffId: b.id,
        expectedVersion: p.sourceVersion!,
        occurredAt: new Date().toISOString(),
        reference: "Synthetic second attempt",
        note: "No genuine provider receipt claimed",
        evidenceDocumentId: null,
        evidenceVersionId: null,
      });
      await repo.recordReturn(f.actor, {
        handoffId: b.id,
        idempotencyKey: crypto.randomUUID(),
        returnedManifestSha256: b.manifestSha256,
        outcome: "rejected",
        reference: "Synthetic return",
        detail: "Human must re-review",
        documentId: null,
        documentVersionId: null,
      });
      p = await repo.preview(f.actor, f.caseId);
      const c = await repo.approve(f.actor, {
        caseId: f.caseId,
        expectedVersion: p.sourceVersion!,
        manifestSha256: p.manifestSha256!,
      });
      expect(c.id).not.toBe(b.id);
      const rows =
        await tx`select id,status,manifest_sha256,manual_reference from package_handoffs where case_id=${f.caseId} order by created_at,id`;
      expect(rows).toHaveLength(3);
      expect(rows.find((x) => x.id === a.id)?.status).toBe("cancelled");
      expect(rows.find((x) => x.id === b.id)?.manual_reference).toBe("Synthetic second attempt");
      expect(rows.every((x) => x.manifest_sha256 === a.manifestSha256)).toBe(true);
    }));
  it("submitted immutable approval remains recognised by current filing readiness without provider acceptance", async () =>
    fixture(async (tx, f) => {
      const repository = createAnnualReturnRepository({ sql: tx });
      for (const status of ["NAR1 prepared", "Signature pending"] as const) {
        const before = (await repository.getCase(f.caseId))!;
        await repository.updateStatus(
          f.caseId,
          status,
          f.actor.userId!,
          before.readiness!.sourceVersion!,
        );
      }
      const { h } = await submitted(tx, f);
      const current = (await repository.getCase(f.caseId))!;
      expect(current.readiness!.blockers.some((x) => x.code === "package_not_approved")).toBe(
        false,
      );
      expect(current.readiness!.readyToTransmit).toBe(false);
      await repository.updateStatus(
        f.caseId,
        "Ready to file",
        f.actor.userId!,
        current.readiness!.sourceVersion!,
      );
      const [row] =
        await tx`select delivery_fact,destination_reference from package_handoffs where id=${h.id}`;
      expect(row.delivery_fact).toBe("manual_recorded");
      expect(row.destination_reference).toBeNull();
    }));
  it("legacy NULL outcome cannot be released or replayed as a new approval", async () =>
    fixture(async (tx, f) => {
      const repo = createHandoffRepository({ sql: tx });
      let p = await repo.preview(f.actor, f.caseId);
      const h = await repo.approve(f.actor, {
        caseId: f.caseId,
        expectedVersion: p.sourceVersion!,
        manifestSha256: p.manifestSha256!,
      });
      await tx`update package_handoffs set delivery_fact=null where id=${h.id}`;
      p = await repo.preview(f.actor, f.caseId);
      await expect(
        repo.recordExport(f.actor, { handoffId: h.id, expectedVersion: p.sourceVersion! }),
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        repo.approve(f.actor, {
          caseId: f.caseId,
          expectedVersion: p.sourceVersion!,
          manifestSha256: p.manifestSha256!,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      const [row] =
        await tx`select delivery_fact,exported_at,manual_recorded_at from package_handoffs where id=${h.id}`;
      expect(row.delivery_fact).toBeNull();
      expect(row.exported_at).toBeNull();
      expect(row.manual_recorded_at).toBeNull();
    }));
  it("cross-team case owner cannot attach a shared company document outside document scope; zero return writes", async () =>
    fixture(async (tx, f) => {
      const { repo, h } = await submitted(tx, f),
        docs = createDocumentRepository({ sql: tx });
      const intent = await docs.createUploadIntent({
        companyId: f.companyId,
        category: "receipt",
        requestedByAuthUserId: f.actor.authUserId,
        fileName: "Synthetic restricted shared.pdf",
        contentType: "application/pdf",
        expectedSizeBytes: 4,
        checksum: "d".repeat(64),
        objectKey: "synthetic-restricted-shared/" + crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      const doc = await docs.finalizeUploadIntent({
        intentId: intent.id,
        uploadedBy: f.actor.userId,
        source: "staff",
      });
      const [other] =
        await tx`select id from teams where id<>${f.actor.teamId!} order by id limit 1`;
      expect(other).toBeTruthy();
      await tx`update users set role='Staff' where id=${f.actor.userId!}`;
      await tx`update staff_profiles set role='Staff' where user_id=${f.actor.userId!}`;
      await tx`update companies set assigned_team_id=${other.id} where id=${f.companyId}`;
      const staff = { ...f.actor, role: "Staff" as const };
      await expect(
        repo.recordReturn(staff, {
          handoffId: h.id,
          idempotencyKey: crypto.randomUUID(),
          returnedManifestSha256: h.manifestSha256,
          outcome: "rejected",
          reference: "Synthetic shared-scope denial",
          detail: "Must not bypass document scope",
          documentId: doc.id,
          documentVersionId: doc.currentVersionId!,
        }),
      ).rejects.toThrow(/outside your scope/);
      const [count] =
        await tx`select count(*)::int n from handoff_returns where handoff_id=${h.id}`;
      expect(count.n).toBe(0);
    }));
  it("two concurrent transactions produce one immutable handoff with current authority", async () => {
    // Dedicated local-only synthetic fixture, removed by exact IDs in finally.
    const f = await sql!.begin(seedFixture);
    try {
      const repo = createHandoffRepository({ sql: sql! }),
        p = await repo.preview(f.actor, f.caseId),
        command = {
          caseId: f.caseId,
          expectedVersion: p.sourceVersion!,
          manifestSha256: p.manifestSha256!,
        };
      const [a, b] = await Promise.all([
        repo.approve(f.actor, command),
        repo.approve(f.actor, command),
      ]);
      expect(a.id).toBe(b.id);
      expect(typeof a.createdAt).toBe("string");
      expect(Number.isFinite(Date.parse(a.createdAt))).toBe(true);
      const [count] =
        await sql!`select count(*)::int n from package_handoffs where case_id=${f.caseId}`;
      expect(count.n).toBe(1);
      await expect(
        repo.approve({ ...f.actor, authUserId: "revoked-synthetic-session" }, command),
      ).rejects.toThrow(/authority|Forbidden/);
      await expect(
        sql!.begin(async (tx) => {
          await tx`update package_handoffs set manifest_payload='{}' where id=${a.id}`;
        }),
      ).rejects.toThrow(/immutable/);
      await expect(repo.list({ ...f.actor, role: "Staff" }, f.caseId)).rejects.toThrow(/authority/);
    } finally {
      await sql!.begin(async (tx) => {
        const [owned] =
          await tx`select id from companies where id=${f.companyId} and company_name='Synthetic local handoff' for update`;
        if (!owned) throw new Error("Synthetic cleanup guard failed");
        await tx`delete from handoff_returns where handoff_id in(select id from package_handoffs where case_id=${f.caseId})`;
        await tx`delete from package_handoffs where case_id=${f.caseId}`;
        await tx`delete from annual_return_audit_events where case_id=${f.caseId}`;
        await tx`delete from timeline_events where company_id=${f.companyId}`;
        await tx`delete from payment_evidence_entries where case_id=${f.caseId}`;
        await tx`delete from payments where case_id=${f.caseId}`;
        await tx`delete from requirement_evidence_links where requirement_instance_id in(select id from case_requirement_instances where case_id=${f.caseId})`;
        await tx`delete from case_requirement_instances where case_id=${f.caseId}`;
        await tx`delete from case_parties where case_id=${f.caseId}`;
        await tx`delete from annual_return_checklist_items where case_id=${f.caseId}`;
        await tx`delete from document_analysis_jobs where document_version_id in(select id from document_versions where document_id=any(${f.received}::uuid[]))`;
        await tx`delete from document_scan_jobs where intent_id in(select id from document_upload_intents where company_id=${f.companyId})`;
        await tx`update documents set reviewed_document_version_id=null where company_id=${f.companyId}`;
        await tx`update document_upload_intents set scan_document_version_id=null where company_id=${f.companyId}`;
        await tx`delete from document_versions where document_id=any(${f.received}::uuid[])`;
        await tx`delete from document_upload_intents where company_id=${f.companyId}`;
        await tx`delete from documents where company_id=${f.companyId}`;
        await tx`delete from annual_return_cases where id=${f.caseId}`;
        await tx`delete from companies where id=${f.companyId}`;
      });
    }
  });
  it("same approved manifest replays once; export/manual attestation do not claim provider acceptance; stale evidence refuses", async () => {
    await expect(
      sql!.begin(async (tx) => {
        const { actor, caseId, companyId, received } = await seedFixture(tx);
        const repo = createHandoffRepository({ sql: tx });
        const preview = await repo.preview(actor, caseId);
        expect(preview.readyForApproval).toBe(true);
        const command = {
          caseId,
          expectedVersion: preview.sourceVersion!,
          manifestSha256: preview.manifestSha256!,
        };
        const first = await repo.approve(actor, command),
          second = await repo.approve(actor, command);
        expect(second.id).toBe(first.id);
        const [count] =
          await tx`select count(*)::int n from package_handoffs where case_id=${caseId}`;
        expect(count.n).toBe(1);
        const current = await repo.preview(actor, caseId);
        const exported = await repo.recordExport(actor, {
          handoffId: first.id,
          expectedVersion: current.sourceVersion!,
        });
        expect(exported).toMatchObject({ deliveryFact: "exported", providerAccepted: false });
        const fresh = await repo.preview(actor, caseId);
        const manual = await repo.recordManualSubmission(actor, {
          handoffId: first.id,
          expectedVersion: fresh.sourceVersion!,
          occurredAt: new Date().toISOString(),
          reference: "Synthetic manual reference only",
          note: "Operator attests external upload; no provider receipt",
          evidenceDocumentId: null,
          evidenceVersionId: null,
        });
        expect(manual).toMatchObject({ deliveryFact: "manual_recorded", providerAccepted: false });
        const returnCommand = {
          handoffId: first.id,
          idempotencyKey: crypto.randomUUID(),
          returnedManifestSha256: first.manifestSha256,
          outcome: "rejected" as const,
          reference: "Synthetic return",
          detail: "Replacement requested",
          documentId: null,
          documentVersionId: null,
        };
        const returned = await repo.recordReturn(actor, returnCommand);
        expect((await repo.recordReturn(actor, returnCommand)).id).toBe(returned.id);
        await expect(
          repo.recordReturn(actor, { ...returnCommand, detail: "different replay" }),
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(returned).toMatchObject({
          outcome: "rejected",
          reconciledAt: null,
          source: "manual",
        });
        const reconciled = await repo.reconcile(actor, {
          returnId: returned.id,
          note: "Compared the original immutable manifest and manual reference",
        });
        expect(reconciled.reconciledAt).toBeTruthy();
        const docs = createDocumentRepository({ sql: tx });
        const intent = await docs.createUploadIntent({
          companyId,
          caseId,
          category: "receipt",
          requestedByAuthUserId: actor.authUserId,
          fileName: "Synthetic unsafe receipt.pdf",
          contentType: "application/pdf",
          expectedSizeBytes: 4,
          checksum: "c".repeat(64),
          objectKey: "synthetic-local-unsafe/" + crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
        const unsafe = await docs.finalizeUploadIntent({
          intentId: intent.id,
          uploadedBy: actor.userId,
          source: "staff",
        });
        const quarantined = await repo.recordReturn(actor, {
          ...returnCommand,
          idempotencyKey: crypto.randomUUID(),
          reference: "Synthetic quarantined return",
          documentId: unsafe.id,
          documentVersionId: unsafe.currentVersionId!,
        });
        await expect(
          repo.reconcile(actor, {
            returnId: quarantined.id,
            note: "Cannot promote unsafe attachment",
          }),
        ).rejects.toThrow(/quarantined/);
        await docs.recordScanResult(
          intent.id,
          {
            status: "rejected",
            reason: "synthetic-malware-only",
            providerReference: "synthetic-local-only",
          },
          { verdictSource: "provider" },
        );
        await expect(
          repo.reconcile(actor, { returnId: quarantined.id, note: "No admin bypass" }),
        ).rejects.toThrow(/rejected by malware/);
        expect((await docs.getDocument(unsafe.id))?.uploadStatus).toBe("rejected");
        const wrong = await repo.recordReturn(actor, {
          ...returnCommand,
          idempotencyKey: crypto.randomUUID(),
          returnedManifestSha256: "b".repeat(64),
        });
        expect(wrong.outcome).toBe("unmatched");
        await expect(
          repo.reconcile(actor, { returnId: wrong.id, note: "Mismatch must remain open" }),
        ).rejects.toMatchObject({ statusCode: 409 });
        const actualCase = (await createAnnualReturnRepository({ sql: tx }).getCase(caseId))!;
        expect(actualCase.handoffExceptions).toMatchObject({
          unreconciled: 2,
          rejected: 3,
          unknown: 0,
        });
        expect(
          deriveWorkViews([actualCase], "2026-10-01", { userId: actor.userId }).find(
            (v) => v.definition.key === "returnsAndExceptions",
          )?.rows,
        ).toHaveLength(1);
        const beforeChange = await repo.preview(actor, caseId);
        await tx`update documents set verification_status='pending',reviewed_document_version_id=null where id=${received[0]}`;
        await expect(
          repo.recordExport(actor, {
            handoffId: first.id,
            expectedVersion: beforeChange.sourceVersion!,
          }),
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(
          (await createAnnualReturnRepository({ sql: tx }).getCase(caseId))?.currentStatus,
        ).toBe("Payment received");
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
