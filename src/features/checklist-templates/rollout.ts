import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { DocumentItem } from "./types";
import { previewTemplateRolloutForActor } from "./usage";

type QueryClient = SqlClient | postgres.TransactionSql;
function transaction<T>(
  sql: QueryClient,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return "begin" in sql ? (sql.begin(work) as Promise<T>) : work(sql);
}

type Version = { id: string; templateId: string; documents: DocumentItem[] };
type CaseRow = {
  id: string;
  company_id: string;
  version_id: string | null;
  revision: number;
  status: string;
  due_date: string;
  package_delivered: boolean;
};
type ItemRow = {
  id: string;
  documentId: string | null;
  status: string;
  evidenceId: string | null;
};

/** The one-case domain write that a future T09 batch runner must call per item. */
export async function applyTemplateVersionToCaseForActor(
  actor: AuthenticatedActor,
  input: {
    caseId: string;
    fromVersion: string;
    toVersion: string;
    expectedRevision: number;
  },
  dependencies: { sql?: QueryClient } = {},
): Promise<{ caseId: string; revision: number; addedRequired: string[]; readyAfter: boolean }> {
  if (!actor.active || actor.role !== "Admin" || !actor.userId)
    throw new Error("Forbidden: active Admin access is required.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    throw new Error("A valid case template revision is required.");
  const sql = dependencies.sql ?? getSqlClient();
  return transaction(sql, async (tx) => {
    const [currentAdmin] = await tx<{ id: string }[]>`select u.id from users u
      join staff_profiles sp on sp.user_id=u.id
      where u.id=${actor.userId} and sp.auth_user_id=${actor.authUserId}
        and u.role='Admin' and sp.role='Admin' and u.active=true and sp.active=true
      for share of u,sp`;
    if (!currentAdmin) throw new Error("Forbidden: current Admin profile required.");
    const [caseRow] = await tx<CaseRow[]>`select arc.id,arc.company_id,
      arc.template_version_id version_id,arc.template_revision revision,
      arc.current_status status,arc.filing_due_date::text due_date,
      exists(select 1 from package_handoffs ph where ph.case_id=arc.id
        and ph.status not in ('failed','cancelled')) package_delivered
      from annual_return_cases arc where arc.id=${input.caseId} for update of arc`;
    if (!caseRow) throw new Error("Forbidden: selected case is unavailable.");
    if (caseRow.revision !== input.expectedRevision)
      throw new Error("Case template revision changed; preview again.");
    const versions = await tx<Version[]>`select id,template_id "templateId",documents
      from checklist_template_versions where id in (${input.fromVersion},${input.toVersion})`;
    const from = versions.find((version) => version.id === input.fromVersion);
    const to = versions.find((version) => version.id === input.toVersion);
    if (!from || !to || from.templateId !== to.templateId)
      throw new Error("Published versions of the same template are required.");
    if (new Set(to.documents.map((document) => document.id)).size !== to.documents.length)
      throw new Error("Target version has duplicate document IDs.");
    const existing = await tx<ItemRow[]>`select id,template_document_id "documentId",
      status,document_id "evidenceId" from annual_return_checklist_items
      where case_id=${input.caseId} for update`;
    const preview = await previewTemplateRolloutForActor(
      actor,
      {
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        selection: { kind: "ids", ids: [input.caseId] },
      },
      {
        loadVersions: async () => versions,
        loadCases: async () => [
          {
            caseId: caseRow.id,
            versionId: caseRow.version_id,
            revision: caseRow.revision,
            status: caseRow.status,
            packageDelivered: caseRow.package_delivered,
            items: existing,
          },
        ],
      },
    );
    const decision = preview.items[0]!;
    if (decision.state !== "eligible")
      throw new Error(decision.reason ?? "Case is not eligible for template rollout.");
    const fromDocs = new Map(from.documents.map((document) => [document.id, document]));
    const desired = new Map(to.documents.map((document) => [document.id, document]));
    const current = new Set(existing.map((item) => item.documentId).filter(Boolean));
    for (const item of existing) {
      if (!item.documentId) continue;
      const document = desired.get(item.documentId);
      if (item.status === "Verified") {
        const old = fromDocs.get(item.documentId);
        if (
          !document ||
          !old ||
          old.label !== document.label ||
          old.required !== document.required ||
          old.daysBeforeDue !== document.daysBeforeDue
        )
          throw new Error("Verified evidence cannot be changed by template rollout.");
        continue;
      }
      if (!document) {
        await tx`update annual_return_checklist_items set required=false,updated_at=now()
          where id=${item.id}`;
        continue;
      }
      await tx`update annual_return_checklist_items set item_label=${document.label},
        required=${document.required},
        due_date=(${caseRow.due_date}::date - ${document.daysBeforeDue}::int),
        updated_at=now() where id=${item.id}`;
    }
    for (const document of to.documents) {
      if (current.has(document.id)) continue;
      await tx`insert into annual_return_checklist_items
        (case_id,item_label,required,status,due_date,template_document_id)
        values (${input.caseId},${document.label},${document.required},'Missing',
          (${caseRow.due_date}::date - ${document.daysBeforeDue}::int),${document.id})`;
    }
    const [updated] = await tx<{ template_revision: number }[]>`update annual_return_cases
      set template_version_id=${input.toVersion},template_revision=template_revision+1,
        updated_at=now() where id=${input.caseId}
          and template_revision=${input.expectedRevision}
      returning template_revision`;
    if (!updated) throw new Error("Case template revision changed; preview again.");
    await tx`insert into annual_return_audit_events
      (case_id,company_id,actor_id,actor_role,action,summary,metadata)
      values (${input.caseId},${caseRow.company_id},${actor.userId},'Admin',
        'apply_template_version','Published checklist version applied to case.',
        ${tx.json({
          fromVersion: input.fromVersion,
          toVersion: input.toVersion,
          addedRequired: decision.addedRequired,
          revision: updated.template_revision,
        })})`;
    return {
      caseId: input.caseId,
      revision: updated.template_revision,
      addedRequired: decision.addedRequired,
      readyAfter: decision.readyAfter,
    };
  });
}
