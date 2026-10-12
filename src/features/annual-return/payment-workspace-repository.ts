import { z } from "zod";
import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  decodeListCursor,
  decodeTimestampCursor,
  encodeListCursor,
  type ListPage,
} from "@/lib/list-page";
import { createDocumentRepository } from "@/features/documents/repository";
import { documentScopeSql } from "@/features/documents/list-scope";
import { documentScopeForStaffActor } from "@/features/documents/authorization";
import { caseFiltersForActor } from "./permissions";
import { caseScopeSql } from "./case-scope";
import { caseReadinessPayloadSql } from "./readiness-repository";
import { hongKongBusinessDate } from "./workflow";
import { paymentCreditSql } from "./payment-workspace-scope";
import {
  paymentWorkspaceInput,
  type PaymentWorkspaceInput,
  type PaymentWorkspaceRow,
} from "./payment-workspace";

export function createPaymentWorkspaceRepository(sql: SqlClient | postgres.TransactionSql) {
  return {
    async list(
      actor: AuthenticatedActor,
      requested: PaymentWorkspaceInput,
    ): Promise<ListPage<PaymentWorkspaceRow>> {
      if (!actor.authUserId || !actor.userId)
        throw Error("Forbidden: verified staff identity required.");
      const input = paymentWorkspaceInput.parse(requested),
        review = input.mode === "review";
      const scope = {
        ...caseFiltersForActor({
          id: actor.userId,
          role: actor.role,
          teamId: actor.teamId,
          active: actor.active,
        }),
        q: review ? undefined : input.q,
        ...(input.companyId ? { companyIds: [input.companyId] } : {}),
        selectionContext: review ? undefined : ("payment_outstanding_cases" as const),
      };
      const key = JSON.stringify([
        scope,
        input.mode,
        input.q,
        input.limit,
        actor.authUserId,
        actor.role,
        actor.userId,
      ]);
      const cursor = review
        ? decodeTimestampCursor(input.cursor, key)
        : decodeListCursor(input.cursor, key, 2);
      if (
        !review &&
        cursor &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(cursor[0]) || !z.string().uuid().safeParse(cursor[1]).success)
      )
        throw Error("Invalid payment cursor; return first page.");
      const predicate = caseScopeSql(sql, scope, hongKongBusinessDate());
      const documentPredicate = documentScopeSql(sql, {
        ...documentScopeForStaffActor(actor, "access"),
        category: "payment",
        companyId: input.companyId,
        q: input.q,
      });
      const reviewFrom = sql`from documents d join annual_return_cases arc on arc.id=d.case_id and arc.company_id=d.company_id join companies c on c.id=arc.company_id join payments p on p.case_id=arc.id and p.company_id=arc.company_id`;
      const [count] = review
        ? await sql`select count(*)::int total ${reviewFrom} where ${predicate} and ${documentPredicate}`
        : await sql`select count(*)::int total from annual_return_cases arc join companies c on c.id=arc.company_id where ${predicate}`;
      const pageSql = review
        ? sql`select d.id row_id,d.id document_id,d.uploaded_at sort_at,d.uploaded_at::text cursor_at,arc.id case_id
   ${reviewFrom} where ${predicate} and ${documentPredicate}
   and (${cursor === null} or d.uploaded_at<${cursor?.[0] ?? null}::text::timestamptz or (d.uploaded_at=${cursor?.[0] ?? null}::text::timestamptz and d.id>${cursor?.[1] ?? null}::uuid))
   order by d.uploaded_at desc,d.id limit ${input.limit + 1}`
        : sql`select arc.id row_id,null::uuid document_id,arc.filing_due_date sort_at,arc.filing_due_date::text cursor_at,arc.id case_id
   from annual_return_cases arc join companies c on c.id=arc.company_id where ${predicate}
   and (${cursor === null} or (arc.filing_due_date,arc.id)>(${cursor?.[0] ?? null}::date,${cursor?.[1] ?? null}::uuid))
   order by arc.filing_due_date,arc.id limit ${input.limit + 1}`;
      const rows = await sql`with page as materialized (${pageSql}), tokens as materialized (
        select arc.id,md5((${caseReadinessPayloadSql(sql)})::text) source_version from annual_return_cases arc join companies c on c.id=arc.company_id where arc.id in(select case_id from page))
 select page.*,c.company_name,arc.filing_due_date::text filing_due_date,arc.company_id,
   p.id payment_id,p.amount,p.status,p.due_date::text due_date,p.paid_at::text paid_at,
   (${paymentCreditSql(sql)})::text credited,
   tokens.source_version,
   (select count(*)::int from documents proof where proof.company_id=arc.company_id and proof.case_id=arc.id and proof.file_type='payment') proof_count
 from page join tokens on tokens.id=page.case_id join annual_return_cases arc on arc.id=page.case_id join companies c on c.id=arc.company_id join payments p on p.case_id=arc.id and p.company_id=arc.company_id
 order by ${review ? sql`page.sort_at desc,page.row_id` : sql`page.sort_at,page.row_id`}`;
      const page = rows.slice(0, input.limit),
        ids = page.flatMap((r) => (r.document_id ? [r.document_id as string] : []));
      const documents = ids.length
        ? (
            await createDocumentRepository({ sql }).listDocumentPage({
              ids,
              limit: 50,
              ...documentScopeForStaffActor(actor, "access"),
            })
          ).documents
        : [];
      const byId = new Map(documents.map((d) => [d.id, d])),
        last = page.at(-1);
      const items: PaymentWorkspaceRow[] = page.map((r) => {
        const base = {
          rowId: r.row_id,
          caseId: r.case_id,
          companyName: r.company_name,
          filingDueDate: r.filing_due_date,
          sourceVersion: r.source_version,
          payment: {
            id: r.payment_id,
            amount: Number(r.amount),
            receivedAmount: Number(r.credited),
            balance: Math.max(0, Number(r.amount) - Number(r.credited)),
            status: r.status,
            dueDate: r.due_date,
            paidAt: r.paid_at,
          },
          proofCount: r.proof_count,
        };
        if (review) {
          const document = byId.get(r.document_id);
          if (!document) throw Error("Payment proof changed; reload the page.");
          return { ...base, kind: "review", document };
        }
        return { ...base, kind: "outstanding", document: null };
      });
      return {
        items,
        total: count.total,
        observedAt: new Date().toISOString(),
        nextCursor:
          rows.length > input.limit && last
            ? encodeListCursor(key, [last.cursor_at, last.row_id])
            : null,
      };
    },
  };
}
