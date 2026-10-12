import type postgres from "postgres";
import { z } from "zod";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { requireTeamReadScope } from "@/features/auth/team-read-scope";
import type { AuthenticatedActor } from "@/features/auth/types";
import { caseFiltersForActor } from "@/features/annual-return/permissions";
import { caseScopeSql } from "@/features/annual-return/case-scope";
import {
  annualReturnWorkViewPredicate,
  workViewMetrics,
} from "@/features/annual-return/work-view-repository";
import { readyForApprovalSql } from "@/features/annual-return/readiness-sql";
import { readIncorporationPage } from "@/features/incorporation/list-page-repository";
import { incorporationListPageSchema } from "@/features/incorporation/list-page";
import { readCorporateChangePage } from "@/features/corporate-changes/list-page-repository";
import { corporateChangeListPageSchema } from "@/features/corporate-changes/list-page";
import { businessListContext } from "@/lib/business-list";
import { decodeListCursor, encodeListCursor } from "@/lib/list-page";
import {
  DAILY_SOURCES,
  dailyWorkInputSchema,
  type DailyWorkInput,
  type DailyWorkRow,
  type DailyWorkPage,
  type DailyWorkSource,
  type DailySourceStatus,
} from "./types";
type Query = SqlClient | postgres.TransactionSql;
type Entry = { row: DailyWorkRow; sortKey: string };
const MIN_ID = "00000000-0000-0000-0000-000000000000",
  MAX_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
function compareText(a: string, b: string) {
  const x = Array.from(a, (c) => c.codePointAt(0)!),
    y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
export function createDailyWorkRepository({
  sql = getSqlClient(),
  now = () => new Date(),
}: { sql?: Query; now?: () => Date } = {}) {
  async function currentActor(
    actor: AuthenticatedActor,
    scope: "mine" | "team",
    companyContext = false,
  ) {
    const team = requireTeamReadScope(actor);
    if (scope === "team" && actor.role !== "Admin" && actor.role !== "Manager" && !companyContext)
      throw Error("Forbidden: team view requires Manager or Admin.");
    const [current] =
      await sql`select role,team_id,active from users where id=${actor.userId}::uuid`;
    if (
      !current ||
      !current.active ||
      current.role !== actor.role ||
      current.team_id !== actor.teamId
    )
      throw Error("Forbidden: current staff role/team has changed.");
    return team;
  }
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now());
  const sourceRead = <T>(read: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    ("begin" in sql ? sql.begin(read) : sql.savepoint(read)) as Promise<T>;
  async function listPage(
    actor: AuthenticatedActor,
    raw: DailyWorkInput = {},
    companyContext = false,
  ): Promise<DailyWorkPage> {
    const input = dailyWorkInputSchema.parse(raw),
      scope = await currentActor(actor, input.scope, companyContext),
      date = today();
    const { cursor, ...filters } = input,
      key = JSON.stringify([actor, filters, date]),
      values = decodeListCursor(cursor, key, 3);
    if (
      values &&
      (!/^(annual_return|incorporation|corporate_change_request):[0-9a-f-]{36}$/i.test(values[1]) ||
        !z.string().uuid().safeParse(values[1].split(":")[1]).success ||
        (input.sort === "deadline" && !/^\d{4}-\d{2}-\d{2}$/.test(values[0])))
    )
      throw Error("Invalid daily cursor; return to the first page.");
    const ids = values?.[1].split(":");
    const idBoundary = (type: DailyWorkSource) =>
      !ids ? null : type === ids[0] ? ids[1] : type > ids[0] ? MIN_ID : MAX_ID;
    const available: Entry[] = [],
      sources: DailySourceStatus[] = [];
    let more = false;
    for (const type of DAILY_SOURCES.filter(
      (s) => input.sourceType === "all" || s === input.sourceType,
    )) {
      try {
        const result = await sourceRead(async (tx) => {
          if (type === "annual_return") {
            const caseScope = {
              ...caseFiltersForActor({
                id: actor.userId,
                role: actor.role,
                teamId: actor.teamId,
                active: actor.active,
              }),
              q: input.q || undefined,
              ...(input.scope === "mine" ? { visibleToUserId: actor.userId! } : {}),
              ...(input.companyId ? { companyIds: [input.companyId] } : {}),
            };
            const predicate = input.history
              ? tx`true`
              : input.view === "all"
                ? tx`(arc.current_status not in ('Filed','Completed') or ${annualReturnWorkViewPredicate(tx, "returnsAndExceptions", date, actor.userId)})`
                : annualReturnWorkViewPredicate(tx, input.view, date, actor.userId);
            const sort =
              input.sort === "company"
                ? tx`c.company_name collate "C"`
                : tx`coalesce(arc.filing_due_date,'9999-12-31'::date)`;
            const boundary = values
              ? input.sort === "company"
                ? tx`(${sort},arc.id)>(${values[0]} collate "C",${idBoundary(type)}::uuid)`
                : tx`(${sort},arc.id)>(${values[0]}::date,${idBoundary(type)}::uuid)`
              : tx`true`;
            const [count] =
              await tx`select count(*)::int total from annual_return_cases arc join companies c on c.id=arc.company_id where ${caseScopeSql(tx, caseScope, date)} and ${predicate}`;
            const rows =
              await tx`with bounded as materialized(select arc.id,${sort}::text sort_key from annual_return_cases arc join companies c on c.id=arc.company_id where ${caseScopeSql(tx, caseScope, date)} and ${predicate} and ${boundary} order by ${sort},arc.id limit ${input.limit + 1})
 select arc.id,arc.company_id,c.company_name,arc.filing_due_date::text due_date,u.name owner_name,arc.updated_at::text updated_raw,b.sort_key,
 case when arc.locked_at is not null then '案件已鎖定，請開案核對'
 when ${readyForApprovalSql(tx)} then '當前文件及入賬證據齊備；待準備／批准交件'
 when exists(select 1 from annual_return_checklist_items i where i.case_id=arc.id and i.required and i.status in ('Missing','Rejected')) then '待追必需文件'
 when exists(select 1 from annual_return_checklist_items i where i.case_id=arc.id and i.status='Received') then '文件待安全覆核'
 else '請核對當前文件、付款及交件回執' end blocker
 from bounded b join annual_return_cases arc on arc.id=b.id join companies c on c.id=arc.company_id join users u on u.id=arc.owner_id order by ${sort},arc.id`;
            return {
              total: count.total,
              more: rows.length > input.limit,
              entries: rows.slice(0, input.limit).map(
                (r) =>
                  ({
                    sortKey: r.sort_key,
                    row: {
                      workKey: type + ":" + r.id,
                      sourceType: type,
                      sourceId: r.id,
                      companyId: r.company_id,
                      companyName: r.company_name,
                      dueDate: r.due_date,
                      ownerName: r.owner_name,
                      blocker: r.blocker,
                      nextAction: {
                        label: "開案核對周年申報",
                        href: "/annual-returns/" + r.id,
                        enabled: true,
                      },
                      updatedAt: new Date(r.updated_raw).toISOString(),
                    },
                  }) as Entry,
              ),
            };
          }
          const rawBusiness = {
            history: input.history,
            q: input.q,
            view: input.scope === "mine" ? ("mine" as const) : ("all" as const),
            sort: input.sort,
            companyId: input.companyId,
            limit: input.limit,
          };
          const parsed =
            type === "incorporation"
              ? incorporationListPageSchema.parse(rawBusiness)
              : corporateChangeListPageSchema.parse(rawBusiness);
          const ctx = businessListContext(
            type === "incorporation" ? "incorporation" : "corporate_change_request",
            scope,
            parsed,
            actor.userId!,
          );
          const sourceCursor = values
            ? encodeListCursor(ctx.key, [values[0], idBoundary(type)!])
            : undefined;
          if (type === "incorporation") {
            const page = await readIncorporationPage(
              tx,
              scope,
              { ...rawBusiness, cursor: sourceCursor },
              actor.userId!,
            );
            const summary = page.items.length
              ? await tx`select ic.id,(select i.item_label from incorporation_checklist_items i where i.case_id=ic.id and i.required and i.status<>'Verified' order by i.id limit 1) blocker from incorporation_cases ic where ic.id=any(${page.items.map((r) => r.id)}::uuid[])`
              : [];
            return {
              total: page.total,
              more: !!page.nextCursor,
              entries: page.items.map(
                (r) =>
                  ({
                    sortKey:
                      input.sort === "company"
                        ? r.proposedCompanyNameEn
                        : (r.dueDate ?? "9999-12-31"),
                    row: {
                      workKey: type + ":" + r.id,
                      sourceType: type,
                      sourceId: r.id,
                      companyId: r.companyId,
                      companyName: r.proposedCompanyNameEn,
                      dueDate: r.dueDate,
                      ownerName: r.ownerName,
                      blocker:
                        summary.find((s) => s.id === r.id)?.blocker ??
                        (r.status === "Filed with Registrar"
                          ? "待正式註冊批核"
                          : "註冊資料／進度待核對"),
                      nextAction: {
                        label: "開案核對註冊進度",
                        href: "/incorporation/" + r.id,
                        enabled: true,
                      },
                      updatedAt: r.updatedAt,
                    },
                  }) as Entry,
              ),
            };
          }
          const page = await readCorporateChangePage(
            tx,
            scope,
            { ...rawBusiness, cursor: sourceCursor },
            actor.userId!,
          );
          return {
            total: page.total,
            more: !!page.nextCursor,
            entries: page.items.map(
              (r) =>
                ({
                  sortKey: input.sort === "company" ? r.companyName : (r.dueDate ?? "9999-12-31"),
                  row: {
                    workKey: type + ":" + r.id,
                    sourceType: type,
                    sourceId: r.id,
                    companyId: r.companyId,
                    companyName: r.companyName,
                    dueDate: r.dueDate,
                    ownerName: r.ownerName,
                    blocker:
                      r.status === "Filed with Registrar"
                        ? "待核對變更提交／回執"
                        : r.status === "Documents pending"
                          ? "待追變更文件"
                          : "變更資料及交件準備待核對",
                    nextAction: {
                      label: "開案核對變更進度",
                      href: "/corporate-changes/" + r.id,
                      enabled: true,
                    },
                    updatedAt: r.updatedAt,
                  },
                }) as Entry,
            ),
          };
        });
        sources.push({ sourceType: type, status: "available", total: result.total });
        available.push(...result.entries);
        more ||= result.more;
      } catch (error) {
        const record = error as { message?: string };
        if (/Forbidden|cursor|viewer/i.test(record.message ?? "")) throw error;
        sources.push({
          sourceType: type,
          status: "unavailable",
          total: null,
          reason: "此業務來源讀取失敗，暫未能納入；請重試或從原入口核對。",
          supportId: crypto.randomUUID(),
        });
      }
    }
    const coverage = sources.map((s) => s.sourceType + ":" + s.status).join("|");
    if (values && values[2] !== coverage)
      throw Error("Daily source coverage changed; return to the first page.");
    available.sort(
      (a, b) => compareText(a.sortKey, b.sortKey) || compareText(a.row.workKey, b.row.workKey),
    );
    const page = available.slice(0, input.limit),
      last = page.at(-1);
    return {
      items: page.map((e) => e.row),
      total: sources.reduce((n, s) => n + (s.total ?? 0), 0),
      nextCursor:
        last && (more || available.length > input.limit)
          ? encodeListCursor(key, [last.sortKey, last.row.workKey, coverage])
          : null,
      observedAt: now().toISOString(),
      sources,
      partial: sources.some((s) => s.status === "unavailable"),
      businessDate: date,
    };
  }
  async function metrics(
    actor: AuthenticatedActor,
    raw: Pick<DailyWorkInput, "q" | "scope" | "companyId"> = {},
  ) {
    const input = dailyWorkInputSchema.parse({ ...raw, sourceType: "annual_return" });
    await currentActor(actor, input.scope);
    const scope = {
      ...caseFiltersForActor({
        id: actor.userId,
        role: actor.role,
        teamId: actor.teamId,
        active: actor.active,
      }),
      q: input.q || undefined,
      ...(input.scope === "mine" ? { visibleToUserId: actor.userId! } : {}),
      ...(input.companyId ? { companyIds: [input.companyId] } : {}),
    };
    return workViewMetrics(sql, { scope, viewerUserId: actor.userId }, today());
  }
  return {
    listPage: (actor: AuthenticatedActor, raw: DailyWorkInput = {}) => listPage(actor, raw, false),
    metrics,
    listCompanyCases: (actor: AuthenticatedActor, raw: DailyWorkInput & { companyId: string }) =>
      listPage(actor, { ...raw, scope: "team" }, true),
  };
}
