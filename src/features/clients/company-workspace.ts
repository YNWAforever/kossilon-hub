import type postgres from "postgres";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { requireTeamReadScope } from "@/features/auth/team-read-scope";
import { createDailyWorkRepository } from "@/features/daily-work/repository";
import { createDocumentRepository } from "@/features/documents/repository";
import { documentScopeForStaffActor } from "@/features/documents/authorization";
import { createPaymentWorkspaceRepository } from "@/features/annual-return/payment-workspace-repository";
import { paymentCreditSql } from "@/features/annual-return/payment-workspace-scope";
import { caseFiltersForActor } from "@/features/annual-return/permissions";
import { caseScopeSql } from "@/features/annual-return/case-scope";
import { hongKongBusinessDate } from "@/features/annual-return/workflow";
import {
  decodeTimestampCursor,
  encodeListCursor,
  literalContains,
  type ListPage,
} from "@/lib/list-page";
import {
  companyWorkspaceInput,
  type CompanyWorkspaceInput,
  type CompanyWorkspaceSummary,
  type CompanyActivity,
} from "./company-workspace-types";
type Query = SqlClient | postgres.TransactionSql;
export function createCompanyWorkspaceRepository({ sql = getSqlClient() }: { sql?: Query } = {}) {
  async function access(actor: AuthenticatedActor, companyId: string) {
    const scope = requireTeamReadScope(actor);
    const [current] =
      await sql`select active,role,team_id from users where id=${actor.userId}::uuid`;
    if (!current?.active || current.role !== actor.role || current.team_id !== actor.teamId)
      throw Error("Forbidden: current staff authorization changed.");
    const [company] =
      await sql`select id,company_name from companies where id=${companyId}::uuid and (${scope.kind === "all"} or assigned_team_id=${scope.kind === "team" ? scope.teamId : null}::uuid)`;
    if (!company) throw Error("Forbidden: company unavailable in this staff scope.");
    return company;
  }
  async function cases(actor: AuthenticatedActor, raw: CompanyWorkspaceInput) {
    const input = companyWorkspaceInput.parse(raw);
    await access(actor, input.companyId);
    return createDailyWorkRepository({ sql }).listCompanyCases(actor, {
      companyId: input.companyId,
      sourceType: input.kind,
      q: input.q,
      cursor: input.cursor,
      limit: input.limit,
      history: input.history,
    });
  }
  async function documents(actor: AuthenticatedActor, raw: CompanyWorkspaceInput) {
    const input = companyWorkspaceInput.parse(raw);
    await access(actor, input.companyId);
    const page = await createDocumentRepository({ sql }).listDocumentPage({
      ...documentScopeForStaffActor(actor),
      actorKey: JSON.stringify(actor),
      companyId: input.companyId,
      q: input.q,
      cursor: input.cursor,
      limit: input.limit,
    });
    return { ...page, items: page.documents, observedAt: new Date().toISOString() };
  }
  async function payments(actor: AuthenticatedActor, raw: CompanyWorkspaceInput) {
    const input = companyWorkspaceInput.parse(raw);
    await access(actor, input.companyId);
    return createPaymentWorkspaceRepository(sql).list(actor, {
      mode: "outstanding",
      companyId: input.companyId,
      q: input.q,
      cursor: input.cursor,
      limit: input.limit,
    });
  }
  async function activity(
    actor: AuthenticatedActor,
    raw: CompanyWorkspaceInput,
  ): Promise<ListPage<CompanyActivity>> {
    const input = companyWorkspaceInput.parse(raw);
    await access(actor, input.companyId);
    const key = JSON.stringify([actor, { ...input, cursor: undefined }]),
      cursor = decodeTimestampCursor(input.cursor, key);
    const predicate = sql`te.company_id=${input.companyId}::uuid and (${input.eventType === "all"} or te.event_type=${input.eventType}) and (${input.q === ""} or te.description ilike ${literalContains(input.q)} escape '\\')`;
    const [count] =
      await sql`select count(*)::int total from timeline_events te where ${predicate}`;
    const rows =
      await sql`select te.id,te.event_type,coalesce(u.name,'系統') actor_name,te.description,te.created_at::text cursor_at from timeline_events te left join users u on u.id=te.actor_id where ${predicate}
 and (${cursor === null} or (te.created_at,te.id)<(${cursor?.[0] ?? null}::text::timestamptz,${cursor?.[1] ?? null}::uuid)) order by te.created_at desc,te.id desc limit ${input.limit + 1}`;
    const page = rows.slice(0, input.limit),
      last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        actorName: r.actor_name,
        description: r.description,
        createdAt: new Date(r.cursor_at).toISOString(),
      })),
      total: count.total,
      nextCursor:
        rows.length > input.limit && last ? encodeListCursor(key, [last.cursor_at, last.id]) : null,
      observedAt: new Date().toISOString(),
    };
  }
  async function summary(
    actor: AuthenticatedActor,
    raw: Pick<CompanyWorkspaceInput, "companyId">,
  ): Promise<CompanyWorkspaceSummary> {
    const input = companyWorkspaceInput.parse(raw),
      company = await access(actor, input.companyId);
    const work = await cases(actor, { companyId: input.companyId, limit: 3 }),
      docs = await documents(actor, { companyId: input.companyId, limit: 1 }),
      debt = await payments(actor, { companyId: input.companyId, limit: 1 });
    const scope = {
      ...caseFiltersForActor({
        id: actor.userId,
        role: actor.role,
        teamId: actor.teamId,
        active: actor.active,
      }),
      companyIds: [input.companyId],
      selectionContext: "payment_outstanding_cases" as const,
    };
    const [balance] =
      await sql`select coalesce(sum(greatest(p.amount-(${paymentCreditSql(sql)}),0)),0)::text balance from annual_return_cases arc join companies c on c.id=arc.company_id join payments p on p.case_id=arc.id and p.company_id=arc.company_id where ${caseScopeSql(sql, scope, hongKongBusinessDate())}`;
    return {
      companyId: company.id,
      companyName: company.company_name,
      openCases: work.total,
      documents: docs.total,
      paymentCases: debt.total,
      outstandingAmount: balance.balance,
      partial: work.partial,
      observedAt: new Date().toISOString(),
      scopeNotice:
        "摘要只涵蓋你有權讀取的工作；款項只計周年申報已入賬證據及其欠款，其他業務報價不當作入賬。",
    };
  }
  return { summary, cases, documents, payments, activity, access };
}
