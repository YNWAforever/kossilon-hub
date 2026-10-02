import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertBulkManager } from "./authorization";
import type {
  BulkResource,
  MaintenanceAction,
  MaintenanceActionKind,
  MaintenanceOutput,
} from "./types";
import { previewClientMaintenance, applyClientMaintenance } from "@/features/clients/maintenance";
import {
  prepareDocumentMaintenance,
  prepareDocumentReturnDraft,
  prepareDocumentAssignment,
  assignDocumentCase,
} from "@/features/documents/maintenance";
import { prepareMissingEvidenceDraft } from "@/features/annual-return/follow-up-draft";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { isAnnualReturnCaseVisibleToActor } from "@/features/annual-return/permissions";
type Query = SqlClient | postgres.TransactionSql;
type Context = { db: Query; actor: AuthenticatedActor; id: string; action: MaintenanceAction };
type Prepared = { version: string; output: MaintenanceOutput };
type Definition = {
  resource: BulkResource;
  permission: (actor: AuthenticatedActor) => void;
  preview: (context: Context) => Promise<Prepared>;
  validateCurrent: (context: Context, expected: string) => Promise<Prepared>;
  apply: (
    context: Context & { db: postgres.TransactionSql },
    prepared: Prepared,
  ) => Promise<MaintenanceOutput>;
  retryPolicy: "rolled_back_transaction_only";
};
function definition(
  resource: BulkResource,
  preview: Definition["preview"],
  apply?: Definition["apply"],
): Definition {
  return {
    resource,
    permission: assertBulkManager,
    preview,
    async validateCurrent(context, expected) {
      const current = await preview(context);
      if (current.version !== expected)
        throw Object.assign(new Error("Maintenance version changed. Refresh preview."), {
          statusCode: 409,
        });
      return current;
    },
    apply: apply ?? (async (_context, current) => current.output),
    retryPolicy: "rolled_back_transaction_only",
  };
}
export const MAINTENANCE_ACTIONS: Record<MaintenanceActionKind, Definition> = {
  client_maintenance: definition(
    "client_company",
    (c) => {
      if (c.action.kind !== "client_maintenance") throw new Error("Invalid action");
      return previewClientMaintenance(c.db, c.actor, c.id, c.action);
    },
    (c, p) => {
      if (c.action.kind !== "client_maintenance") throw new Error("Invalid action");
      return applyClientMaintenance(c.db, c.actor, c.id, c.action, p.version);
    },
  ),
  document_assignment: definition(
    "document",
    async (c) => {
      if (c.action.kind !== "document_assignment") throw new Error("Invalid action");
      const p = await prepareDocumentAssignment(c.db, c.actor, c.id, c.action);
      return {
        version: p.version,
        output: {
          ...p.output,
          kind: "document_assignment",
          scope: "linked_case",
          target: c.action.target,
          assigneeId: c.action.assigneeId,
        },
      };
    },
    (c, p) => {
      if (c.action.kind !== "document_assignment") throw new Error("Invalid action");
      return assignDocumentCase(c.db, c.actor, c.id, c.action, p.version);
    },
  ),
  document_return_draft: definition("document", (c) => {
    if (c.action.kind !== "document_return_draft") throw new Error("Invalid action");
    return prepareDocumentReturnDraft(c.db, c.actor, c.id, c.action.reasons[c.id] ?? "");
  }),
  document_list_export: definition("document", async (c) => {
    const p = await prepareDocumentMaintenance(c.db, c.actor, c.id, true);
    return { version: p.version, output: p.output };
  }),
  follow_up_draft: definition("annual_return_case", (c) =>
    prepareMissingEvidenceDraft(c.db, c.actor, c.id),
  ),
  payment_list_export: definition("annual_return_case", async (c) => {
    if (!c.actor.userId || c.actor.role === "Client")
      throw new Error("Forbidden: staff identity required.");
    const item = await createAnnualReturnRepository({ sql: c.db }).getCase(c.id);
    if (
      !item ||
      !isAnnualReturnCaseVisibleToActor(
        { id: c.actor.userId, role: c.actor.role, teamId: c.actor.teamId, active: c.actor.active },
        item,
      )
    )
      throw new Error("Forbidden: current payment scope denied.");
    if (!item.payment || !item.readiness?.sourceVersion)
      throw new Error("Locked: no current payment record.");
    return {
      version: item.readiness.sourceVersion,
      output: {
        kind: "payment_list_export",
        caseId: item.id,
        companyName: item.companyName,
        invoiceNumber: item.payment.invoiceNumber,
        amount: item.payment.amount,
        currency: item.payment.currency,
        status: item.payment.status,
        receivedAmount: item.payment.receivedAmount ?? 0,
        balance: item.payment.balance ?? item.payment.amount,
        paidAt: item.payment.paidAt,
        approvalPerformed: false,
      },
    };
  }),
};
export async function lockMaintenanceResource(
  tx: postgres.TransactionSql,
  resource: BulkResource,
  id: string,
) {
  const [subject] =
    resource === "client_company"
      ? await tx<
          { company_id: string; case_id: string | null }[]
        >`select id company_id,null::uuid case_id from companies where id=${id}`
      : resource === "document"
        ? await tx<
            { company_id: string; case_id: string | null }[]
          >`select company_id,case_id from documents where id=${id}`
        : await tx<
            { company_id: string; case_id: string | null }[]
          >`select company_id,id case_id from annual_return_cases where id=${id}`;
  if (!subject) return;
  await tx`select id from companies where id=${subject.company_id} for update`;
  if (subject.case_id)
    await tx`select id from annual_return_cases where id=${subject.case_id} for update`;
  if (resource === "document") {
    await tx`select id from documents where id=${id} for update`;
    await tx`select id from document_upload_intents where document_id=${id} order by id for update`;
    await tx`select id from document_versions where document_id=${id} order by id for update`;
  }
  if (subject.case_id) {
    await tx`select id from annual_return_checklist_items where case_id=${subject.case_id} order by id for update`;
    await tx`select id from work_items where annual_return_case_id=${subject.case_id} order by id for update`;
  }
  // Template edits acquire an UPDATE lock, so a worker cannot validate an old template and then publish its draft.
  if (resource === "annual_return_case") await tx`lock table whatsapp_templates in share mode`;
}
