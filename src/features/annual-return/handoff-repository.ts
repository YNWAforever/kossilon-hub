import type postgres from "postgres";
import { createHash } from "node:crypto";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createDocumentRepository } from "@/features/documents/repository";
import { assertDocumentServable, documentSafetyOf } from "@/features/documents/safety";
import { createAnnualReturnRepository } from "./repository";
import { assertAnnualReturnActionAllowed, assertAnnualReturnCaseVisible } from "./permissions";
import type { HandoffDeliveryFact, HandoffStatus, ReturnOutcome } from "./handoff";
import type { AnnualReturnCase } from "./types";

type Query = SqlClient | postgres.TransactionSql;
type HandoffRow = {
  id: string;
  case_id: string;
  manifest_sha256: string;
  manifest_payload: string;
  status: HandoffStatus;
  delivery_fact: HandoffDeliveryFact | null;
  approved_by: string;
  created_at: string;
  exported_at: string | null;
  manual_recorded_at: string | null;
  manual_recorded_by: string | null;
  manual_occurred_at: string | null;
  manual_reference: string | null;
  manual_note: string | null;
  manual_evidence_document_id: string | null;
  manual_evidence_version_id: string | null;
};
type ReturnRow = {
  id: string;
  handoff_id: string;
  outcome: ReturnOutcome;
  reported_outcome: ReturnOutcome | null;
  source: "manual" | "provider" | null;
  returned_manifest_sha256: string | null;
  external_reference: string | null;
  detail: string | null;
  document_id: string | null;
  document_version_id: string | null;
  reconciled_at: string | null;
  reconciliation_note: string | null;
  received_at: string;
  payload_sha256: string | null;
};
export type ApproveHandoffInput = {
  caseId: string;
  expectedVersion: string;
  manifestSha256: string;
};
export type ExportHandoffInput = { handoffId: string; expectedVersion: string };
export type ManualSubmissionInput = ExportHandoffInput & {
  occurredAt: string;
  reference: string;
  note: string;
  evidenceDocumentId: string | null;
  evidenceVersionId: string | null;
};
export type ManualReturnInput = {
  handoffId: string;
  idempotencyKey: string;
  returnedManifestSha256: string;
  outcome: ReturnOutcome;
  reference: string;
  detail: string;
  documentId: string | null;
  documentVersionId: string | null;
};
const sha = (payload: string) => createHash("sha256").update(payload).digest("hex");
function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}
function text(value: string, max: number) {
  if (!value.trim() || value.length > max)
    throw new Error("A bounded non-empty explanation is required.");
  return value.trim();
}
function mapHandoff(row: HandoffRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    manifestSha256: row.manifest_sha256,
    status: row.status,
    deliveryFact: row.delivery_fact,
    providerAccepted: row.delivery_fact === "provider_accepted",
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    exportedAt: row.exported_at,
    manualRecordedAt: row.manual_recorded_at,
    manualRecordedBy: row.manual_recorded_by,
    manualOccurredAt: row.manual_occurred_at,
    manualReference: row.manual_reference,
    manualNote: row.manual_note,
    evidenceDocumentId: row.manual_evidence_document_id,
    evidenceVersionId: row.manual_evidence_version_id,
  };
}
function mapReturn(row: ReturnRow) {
  return {
    id: row.id,
    handoffId: row.handoff_id,
    outcome: row.outcome,
    reportedOutcome: row.reported_outcome,
    source: row.source,
    returnedManifestSha256: row.returned_manifest_sha256,
    reference: row.external_reference,
    detail: row.detail,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    reconciledAt: row.reconciled_at,
    reconciliationNote: row.reconciliation_note,
    receivedAt: row.received_at,
  };
}

/** Manual operations only. There is deliberately no implicit destination dispatch. */
export function createHandoffRepository(options: { sql?: Query } = {}) {
  const db = options.sql ?? getSqlClient();
  const transaction = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    "begin" in db ? (db.begin(fn) as Promise<T>) : fn(db);
  async function authority(tx: Query, identity: AuthenticatedActor, lock = false) {
    if (!identity.active || !identity.userId || identity.role === "Client")
      throw new Error("Forbidden: active staff identity required.");
    const [row] = await tx<{ role: AuthenticatedActor["role"]; team_id: string | null }[]>`
      select u.role,u.team_id from users u join staff_profiles s on s.user_id=u.id
      where u.id=${identity.userId} and s.auth_user_id=${identity.authUserId} and u.active and s.active
      and u.role=s.role and u.team_id is not distinct from s.team_id ${lock ? tx`for share of u,s` : tx``}`;
    if (
      !row ||
      row.role === "Client" ||
      row.role !== identity.role ||
      row.team_id !== identity.teamId
    )
      throw new Error("Forbidden: staff authority changed; reload the session.");
    return { ...identity, role: row.role, teamId: row.team_id };
  }
  async function caseFor(tx: Query, identity: AuthenticatedActor, caseId: string, write = false) {
    if (write) {
      const [subject] = await tx<
        { company_id: string }[]
      >`select company_id from annual_return_cases where id=${caseId}`;
      if (!subject) throw new Error("Case not found.");
      await tx`select id from companies where id=${subject.company_id} for update`;
      await tx`select id from annual_return_cases where id=${caseId} for update`;
    }
    const actor = await authority(tx, identity, write);
    const caseItem = await createAnnualReturnRepository({ sql: tx }).getCase(caseId);
    if (!caseItem) throw new Error("Case not found.");
    const actionActor = {
      id: actor.userId!,
      role: actor.role as "Admin" | "Manager" | "Staff",
      teamId: actor.teamId,
      active: actor.active,
    };
    assertAnnualReturnCaseVisible(actionActor, caseItem);
    if (write) {
      assertAnnualReturnActionAllowed(actionActor, caseItem, "change_status");
      if (
        caseItem.dataOrigin !== "client" ||
        caseItem.lockedAt ||
        caseItem.completedAt ||
        ["Filed", "Completed"].includes(caseItem.currentStatus)
      )
        conflict("Closed, historical or fixture cases cannot release packages.");
    }
    return { actor, caseItem };
  }
  async function lockEvidence(tx: postgres.TransactionSql, caseItem: AnnualReturnCase) {
    const id = caseItem.id,
      company = caseItem.companyId;
    await tx`select id from annual_return_checklist_items where case_id=${id} order by id for update`;
    await tx`select id from payments where case_id=${id} order by id for update`;
    await tx`select id from payment_evidence_entries where case_id=${id} order by id for update`;
    await tx`select id from documents where company_id=${company} and (case_id=${id} or case_id is null) order by id for update`;
    await tx`select id from document_upload_intents where company_id=${company} and (case_id=${id} or case_id is null) order by id for update`;
    await tx`select v.id from document_versions v join documents d on d.id=v.document_id where d.company_id=${company} and (d.case_id=${id} or d.case_id is null) order by v.id for update of v`;
    await tx`select id from case_parties where case_id=${id} order by id for update`;
    await tx`select id from officers where company_id=${company} order by id for update`;
    await tx`select id from case_requirement_instances where case_id=${id} order by id for update`;
    await tx`select l.id from requirement_evidence_links l join case_requirement_instances r on r.id=l.requirement_instance_id where r.case_id=${id} order by l.id for update of l`;
    await tx`select f.id from document_findings f where f.requirement_instance_id in(select id from case_requirement_instances where case_id=${id}) or f.document_version_id in(select v.id from document_versions v join documents d on d.id=v.document_id where d.company_id=${company} and (d.case_id=${id} or d.case_id is null)) order by f.id for update`;
    await tx`select id from package_handoffs where case_id=${id} order by id for update`;
  }
  async function locked(tx: postgres.TransactionSql, actor: AuthenticatedActor, caseId: string) {
    const context = await caseFor(tx, actor, caseId, true);
    await lockEvidence(tx, context.caseItem);
    // Re-read the canonical version only after all current evidence is fenced.
    context.caseItem = (await createAnnualReturnRepository({ sql: tx }).getCase(caseId))!;
    return context;
  }
  function candidate(caseItem: AnnualReturnCase) {
    const r = caseItem.readiness;
    return {
      readyForApproval: r?.readyForApproval ?? false,
      sourceVersion: r?.sourceVersion ?? null,
      manifestSha256: r?.manifestPayload ? sha(r.manifestPayload) : null,
      blockers: r?.blockers ?? [],
    };
  }
  async function preview(actor: AuthenticatedActor, caseId: string) {
    const { caseItem } = await caseFor(db, actor, caseId);
    return candidate(caseItem);
  }
  async function audit(
    tx: postgres.TransactionSql,
    actor: AuthenticatedActor,
    caseItem: AnnualReturnCase,
    command: string,
    id: string,
  ) {
    await tx`insert into annual_return_audit_events(case_id,company_id,actor_id,actor_role,action,result,summary,metadata)
      values(${caseItem.id},${caseItem.companyId},${actor.userId!},${actor.role},'change_status','succeeded',${command},${tx.json({ command, recordId: id, evidenceSource: "manual_workflow" })})`;
  }
  async function approve(actor: AuthenticatedActor, input: ApproveHandoffInput) {
    return transaction(async (tx) => {
      const c = await locked(tx, actor, input.caseId),
        p = candidate(c.caseItem);
      if (!p.readyForApproval || p.manifestSha256 !== input.manifestSha256)
        conflict("Package evidence changed or is not ready for approval.");
      const [same] = await tx<
        HandoffRow[]
      >`select * from package_handoffs where case_id=${input.caseId} and manifest_sha256=${input.manifestSha256}`;
      if (same) {
        if (sha(same.manifest_payload) !== same.manifest_sha256)
          conflict("Stored approval hash mismatch.");
        return mapHandoff(same);
      }
      if (p.sourceVersion !== input.expectedVersion)
        conflict("Approval version changed; refresh preview.");
      const [live] =
        await tx`select id from package_handoffs where case_id=${input.caseId} and (status in ('prepared','transmitted','acknowledged') or delivery_fact='unknown')`;
      if (live) conflict("An existing package is outstanding. Reconcile or withdraw it first.");
      const [row] = await tx<
        HandoffRow[]
      >`insert into package_handoffs(case_id,manifest_sha256,manifest_payload,approved_by,released_by,delivery_fact)
        values(${input.caseId},${p.manifestSha256!},${c.caseItem.readiness!.manifestPayload!},${c.actor.userId!},${c.actor.userId!},'prepared') returning *`;
      await audit(tx, c.actor, c.caseItem, "package_approved", row.id);
      return mapHandoff(row);
    });
  }
  async function resolveHandoff(tx: Query, id: string) {
    const [row] = await tx<HandoffRow[]>`select * from package_handoffs where id=${id}`;
    if (!row) throw new Error("Handoff not found.");
    return row;
  }
  function assertCurrent(caseItem: AnnualReturnCase, row: HandoffRow, expectedVersion: string) {
    const p = candidate(caseItem);
    if (
      !p.readyForApproval ||
      p.sourceVersion !== expectedVersion ||
      p.manifestSha256 !== row.manifest_sha256 ||
      sha(row.manifest_payload) !== row.manifest_sha256
    )
      conflict("Approved package is stale. Re-review current evidence and approve again.");
    if (row.delivery_fact === "unknown" || row.status === "cancelled" || row.status === "failed")
      conflict("Package needs human reconciliation before release.");
  }
  async function approvedExport(actor: AuthenticatedActor, input: ExportHandoffInput) {
    return transaction(async (tx) => {
      const initial = await resolveHandoff(tx, input.handoffId),
        c = await locked(tx, actor, initial.case_id);
      const row = await resolveHandoff(tx, input.handoffId);
      assertCurrent(c.caseItem, row, input.expectedVersion);
      return {
        id: row.id,
        caseId: row.case_id,
        manifestSha256: row.manifest_sha256,
        manifestPayload: row.manifest_payload,
      };
    });
  }
  // Called after safe bytes and archive construction. Not exposed as a client RPC.
  async function recordExport(actor: AuthenticatedActor, input: ExportHandoffInput) {
    return transaction(async (tx) => {
      const initial = await resolveHandoff(tx, input.handoffId),
        c = await locked(tx, actor, initial.case_id),
        row = await resolveHandoff(tx, input.handoffId);
      assertCurrent(c.caseItem, row, input.expectedVersion);
      const [updated] = await tx<
        HandoffRow[]
      >`update package_handoffs set exported_at=coalesce(exported_at,now()),exported_by=coalesce(exported_by,${c.actor.userId!}),delivery_fact=case when delivery_fact='prepared' then 'exported' else delivery_fact end,updated_at=now() where id=${row.id} returning *`;
      await audit(tx, c.actor, c.caseItem, "package_exported_not_submitted", row.id);
      return mapHandoff(updated);
    });
  }
  async function attachment(
    tx: Query,
    caseItem: AnnualReturnCase,
    documentId: string | null,
    versionId: string | null,
    safe: boolean,
    actor: AuthenticatedActor,
  ) {
    if (!documentId && !versionId) return;
    if (!documentId || !versionId)
      throw new Error("Document and current version must be supplied together.");
    const repo = createDocumentRepository({ sql: tx }),
      doc = await repo.getDocument(documentId);
    if (
      !doc ||
      doc.companyId !== caseItem.companyId ||
      (doc.caseId !== caseItem.id && doc.caseId !== null) ||
      doc.currentVersionId !== versionId
    )
      conflict("Attachment scope or current version changed.");
    if (safe) {
      assertDocumentServable(actor, documentSafetyOf(doc));
      if (doc.reviewStatus !== "verified" || doc.reviewedVersionId !== versionId)
        conflict("Attachment needs current-version human review.");
    }
    // Intake never promotes quarantine, scan status or review state.
  }
  async function recordManualSubmission(actor: AuthenticatedActor, input: ManualSubmissionInput) {
    return transaction(async (tx) => {
      const initial = await resolveHandoff(tx, input.handoffId),
        c = await locked(tx, actor, initial.case_id),
        row = await resolveHandoff(tx, input.handoffId);
      assertCurrent(c.caseItem, row, input.expectedVersion);
      const reference = text(input.reference, 200),
        note = text(input.note, 1000),
        occurred = Date.parse(input.occurredAt);
      if (
        !Number.isFinite(occurred) ||
        occurred > Date.now() + 60000 ||
        occurred < Date.parse(row.created_at)
      )
        throw new Error("Manual submission time must follow approval and cannot be in the future.");
      await attachment(
        tx,
        c.caseItem,
        input.evidenceDocumentId,
        input.evidenceVersionId,
        true,
        c.actor,
      );
      if (row.delivery_fact === "manual_recorded") {
        if (
          row.manual_reference !== reference ||
          row.manual_note !== note ||
          Date.parse(row.manual_occurred_at!) !== occurred ||
          row.manual_evidence_document_id !== input.evidenceDocumentId ||
          row.manual_evidence_version_id !== input.evidenceVersionId
        )
          conflict("Manual submission is already recorded with different facts.");
        return mapHandoff(row);
      }
      if (!row.exported_at || row.status !== "prepared")
        conflict("Export the approved package before recording manual submission.");
      const [updated] = await tx<
        HandoffRow[]
      >`update package_handoffs set delivery_fact='manual_recorded',status='transmitted',transmitted_at=${new Date(occurred).toISOString()},released_by=${c.actor.userId!},manual_recorded_at=now(),manual_recorded_by=${c.actor.userId!},manual_occurred_at=${new Date(occurred).toISOString()},manual_reference=${reference},manual_note=${note},manual_evidence_document_id=${input.evidenceDocumentId},manual_evidence_version_id=${input.evidenceVersionId},updated_at=now() where id=${row.id} returning *`;
      await audit(
        tx,
        c.actor,
        c.caseItem,
        "manual_submission_attested_no_provider_receipt",
        row.id,
      );
      return mapHandoff(updated);
    });
  }
  async function recordReturn(actor: AuthenticatedActor, input: ManualReturnInput) {
    return transaction(async (tx) => {
      const initial = await resolveHandoff(tx, input.handoffId),
        c = await locked(tx, actor, initial.case_id),
        row = await resolveHandoff(tx, input.handoffId);
      if (!row.manual_recorded_at && row.delivery_fact !== "provider_accepted")
        conflict("No attested submission to reconcile a return against.");
      const data = {
          ...input,
          reference: text(input.reference, 200),
          detail: text(input.detail, 2000),
        },
        payloadHash = sha(JSON.stringify(data));
      const [same] = await tx<
        ReturnRow[]
      >`select * from handoff_returns where handoff_id=${row.id} and idempotency_key=${input.idempotencyKey}`;
      if (same) {
        if (same.payload_sha256 !== payloadHash)
          conflict("Return idempotency key was reused with different facts.");
        return mapReturn(same);
      }
      await attachment(tx, c.caseItem, input.documentId, input.documentVersionId, false, c.actor);
      const outcome =
        row.manifest_sha256 === input.returnedManifestSha256 ? input.outcome : "unmatched";
      const [returned] = await tx<
        ReturnRow[]
      >`insert into handoff_returns(handoff_id,document_id,document_version_id,outcome,reported_outcome,detail,source,recorded_by,external_reference,returned_manifest_sha256,idempotency_key,payload_sha256)
        values(${row.id},${input.documentId},${input.documentVersionId},${outcome},${input.outcome},${data.detail},'manual',${c.actor.userId!},${data.reference},${input.returnedManifestSha256},${input.idempotencyKey},${payloadHash}) returning *`;
      await tx`update package_handoffs set status='returned',updated_at=now() where id=${row.id}`;
      await audit(tx, c.actor, c.caseItem, "manual_return_recorded_not_reconciled", returned.id);
      return mapReturn(returned);
    });
  }
  async function reconcile(actor: AuthenticatedActor, input: { returnId: string; note: string }) {
    return transaction(async (tx) => {
      const [initial] = await tx<
        ReturnRow[]
      >`select * from handoff_returns where id=${input.returnId}`;
      if (!initial) throw new Error("Return not found.");
      const handoff = await resolveHandoff(tx, initial.handoff_id),
        c = await locked(tx, actor, handoff.case_id);
      const [row] = await tx<
        ReturnRow[]
      >`select * from handoff_returns where id=${input.returnId} for update`;
      const note = text(input.note, 1000);
      if (row.returned_manifest_sha256 !== handoff.manifest_sha256)
        conflict("Unmatched manifest needs investigation; it cannot be reconciled as matching.");
      await attachment(tx, c.caseItem, row.document_id, row.document_version_id, true, c.actor);
      if (row.reconciled_at) {
        if (row.reconciliation_note !== note)
          conflict("Return already reconciled with a different note.");
        return mapReturn(row);
      }
      const [updated] = await tx<
        ReturnRow[]
      >`update handoff_returns set reconciled_at=now(),reconciled_by=${c.actor.userId!},reconciliation_note=${note} where id=${row.id} returning *`;
      await audit(tx, c.actor, c.caseItem, "manual_return_reconciled_not_filing_accepted", row.id);
      return mapReturn(updated);
    });
  }
  async function withdraw(actor: AuthenticatedActor, input: ExportHandoffInput & { note: string }) {
    return transaction(async (tx) => {
      const initial = await resolveHandoff(tx, input.handoffId),
        c = await locked(tx, actor, initial.case_id),
        row = await resolveHandoff(tx, input.handoffId);
      if (
        c.caseItem.readiness?.sourceVersion !== input.expectedVersion ||
        row.status !== "prepared" ||
        !["prepared", "exported"].includes(row.delivery_fact ?? "")
      )
        conflict("Only a current unsubmitted package can be withdrawn.");
      text(input.note, 1000);
      const [updated] = await tx<
        HandoffRow[]
      >`update package_handoffs set status='cancelled',last_error_code='human_withdrawn',updated_at=now() where id=${row.id} returning *`;
      await audit(tx, c.actor, c.caseItem, "package_withdrawn: " + input.note, row.id);
      return mapHandoff(updated);
    });
  }
  async function list(actor: AuthenticatedActor, caseId: string) {
    await caseFor(db, actor, caseId);
    const rows = await db<
      HandoffRow[]
    >`select * from package_handoffs where case_id=${caseId} order by created_at desc,id limit 100`;
    const returns = await db<
      ReturnRow[]
    >`select r.* from handoff_returns r join package_handoffs h on h.id=r.handoff_id where h.case_id=${caseId} order by r.received_at desc,r.id limit 200`;
    return {
      handoffs: rows.map(mapHandoff),
      returns: returns.map(mapReturn),
      connectorConfigured: false,
    };
  }
  return {
    preview,
    approve,
    approvedExport,
    recordExport,
    recordManualSubmission,
    recordReturn,
    reconcile,
    withdraw,
    list,
  };
}
export type HandoffRepository = ReturnType<typeof createHandoffRepository>;
