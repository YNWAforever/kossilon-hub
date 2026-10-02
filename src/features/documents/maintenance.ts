import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createDocumentRepository } from "./repository";
import { assertStaffDocumentAccess } from "./authorization";
import { caseAssignmentVersionSql } from "@/features/annual-return/assignment-version";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { assertCaseAssignmentTarget } from "@/features/annual-return/assignment-target";
import type { Assignment } from "@/features/bulk-operations/types";
type Query = SqlClient | postgres.TransactionSql;
export async function prepareDocumentMaintenance(
  db: Query,
  actor: AuthenticatedActor,
  id: string,
  readOnly = false,
) {
  const repo = createDocumentRepository({ sql: db });
  const subject = await repo.getDocumentAccessSubject(id);
  if (!subject) throw new Error("Forbidden: document unavailable.");
  assertStaffDocumentAccess(actor, subject);
  const document = (await repo.listDocuments({ id, companyId: subject.companyId })).find(
    (d) => d.id === id,
  );
  if (!document) throw new Error("Forbidden: document unavailable.");
  const [row] = await db<
    { version: string; case_version: string | null; locked: boolean }[]
  >`select md5(jsonb_build_object('document',to_jsonb(d),'versions',(select jsonb_agg(to_jsonb(v) order by v.id) from document_versions v where v.document_id=d.id),'intents',(select jsonb_agg(to_jsonb(i) order by i.id) from document_upload_intents i where i.document_id=d.id),'scope',jsonb_build_array(c.assigned_team_id,c.data_origin,arc.owner_id,arc.reviewer_id),'caseVersion',${caseAssignmentVersionSql(db)})::text) version,case when arc.id is null then null else ${caseAssignmentVersionSql(db)} end case_version,(c.data_origin<>'client' or arc.current_status in ('Filed','Completed') or arc.locked_at is not null or arc.completed_at is not null) locked from documents d join companies c on c.id=d.company_id left join annual_return_cases arc on arc.id=d.case_id and arc.company_id=d.company_id where d.id=${id}`;
  if (row.locked && !readOnly)
    throw new Error("Locked: document belongs to a closed or non-client case.");
  return {
    version: row.version,
    document,
    caseVersion: row.case_version,
    output: {
      kind: "document_list_export",
      documentId: id,
      caseId: document.caseId,
      fileName: document.fileName,
      category: document.category,
      currentVersionId: document.currentVersionId ?? null,
      reviewStatus: document.reviewStatus,
      uploadStatus: document.uploadStatus,
      scanVerdictSource: document.scanVerdictSource,
      availability: document.availability ?? "metadata_only",
      storageChecked: false,
    },
  };
}
export async function prepareDocumentAssignment(
  db: Query,
  actor: AuthenticatedActor,
  id: string,
  assignment: Assignment,
) {
  const current = await prepareDocumentMaintenance(db, actor, id);
  if (!current.document.caseId || !current.caseVersion)
    throw new Error("Locked: unlinked document requires manual mapping before case assignment.");
  const [row] = await db<
    { owner_id: string | null; reviewer_id: string | null; children: (string | null)[] }[]
  >`select arc.owner_id,arc.reviewer_id,array(select ${assignment.target === "owner" ? db`reviewer_id` : db`owner_id`} from work_items where annual_return_case_id=arc.id and status in ('open','in_progress','blocked')) children from annual_return_cases arc where id=${current.document.caseId}`;
  assertCaseAssignmentTarget(
    assignment.target,
    assignment.assigneeId,
    assignment.target === "owner" ? row.reviewer_id : row.owner_id,
    actor.role,
    row.children,
  );
  const { readActiveStaffUser } = await import("@/features/auth/staff-state");
  await readActiveStaffUser(db, assignment.assigneeId);
  return current;
}
/** Documents inherit case ownership; reuse its existing assignment and child-work audit. */
export async function assignDocumentCase(
  tx: postgres.TransactionSql,
  actor: AuthenticatedActor,
  id: string,
  assignment: Assignment,
  expectedVersion: string,
) {
  const current = await prepareDocumentAssignment(tx, actor, id, assignment);
  if (current.version !== expectedVersion)
    throw Object.assign(new Error("Document assignment version changed."), { statusCode: 409 });
  const repo = createAnnualReturnRepository({ sql: tx });
  if (assignment.target === "owner")
    await repo.assignOwner({
      caseId: current.document.caseId!,
      ownerId: assignment.assigneeId,
      actorId: actor.userId!,
      expectedVersion: current.caseVersion!,
    });
  else
    await repo.assignReviewer({
      caseId: current.document.caseId!,
      reviewerId: assignment.assigneeId,
      actorId: actor.userId!,
      expectedVersion: current.caseVersion!,
    });
  return {
    ...current.output,
    kind: "document_assignment",
    scope: "linked_case",
    target: assignment.target,
    assigneeId: assignment.assigneeId,
  };
}
export async function prepareDocumentReturnDraft(
  db: Query,
  actor: AuthenticatedActor,
  id: string,
  reason: string,
) {
  const current = await prepareDocumentMaintenance(db, actor, id);
  if (!reason.trim() || reason.trim().length > 500)
    throw new Error("A per-document return reason is required.");
  if (!current.document.currentVersionId) throw new Error("Locked: no current document version.");
  return {
    version: current.version,
    output: {
      kind: "document_return_draft",
      documentId: id,
      caseId: current.document.caseId,
      expectedVersionId: current.document.currentVersionId,
      reason: reason.trim(),
      status: "draft",
      approvalRequired: true,
    },
  };
}
