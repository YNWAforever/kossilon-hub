import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import { lockActiveStaffUser } from "@/features/auth/staff-state";
import { rankAssignmentCandidates } from "./assignment";
import { snapshotSla, thresholdFor } from "./sla";
import { enqueueNotification } from "@/features/notifications/outbox";
import {
  createAnnualReturnRepository,
  type CaseFilters,
} from "@/features/annual-return/repository";
import { hongKongBusinessDate } from "@/lib/hong-kong-time";
import { z } from "zod";
import { decodeListCursor, encodeListCursor, listPageSize, type ListPage } from "@/lib/list-page";
import { queueScopeSql } from "./queue-scope";
import type { WorkQueueSummary } from "./queue-page";
import {
  caseBusinessContext,
  type AssignmentOption,
  type CaseBusinessContext,
} from "./assignment-labels";
import type {
  AssignmentRecommendation,
  AssignmentRole,
  BusinessCalendar,
  SlaThreshold,
  StaffCandidate,
  WorkItemCaseType,
  WorkItemStatus,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
export type EscalationState = "none" | "warning" | "breach" | "acknowledged";

export type PersistedWorkItem = {
  id: string;
  companyId: string;
  /**
   * Resolved on the read, because the queue rendered `companyId.slice(0, 8)` and
   * `ownerId.slice(0, 8)` -- raw uuid prefixes where the company and the person
   * belong. Nullable so a row whose company or owner is gone still renders
   * rather than dropping out of the queue.
   */
  companyName: string | null;
  ownerName: string | null;
  ownerTeamName?: string | null;
  reviewerName?: string | null;
  reviewerTeamName?: string | null;
  businessContext?: CaseBusinessContext | null;
  caseType: WorkItemCaseType;
  annualReturnCaseId: string | null;
  corporateChangeRequestId: string | null;
  sourceEventKey: string;
  sourceEventType: string;
  workType: string;
  requiredSkillKey: string | null;
  title: string;
  status: WorkItemStatus;
  escalationState: EscalationState;
  priority: number;
  ownerId: string | null;
  reviewerId: string | null;
  teamId: string | null;
  slaPolicyVersionId: string;
  slaStartedAt: string;
  slaWarningAt: string;
  slaDueAt: string;
  slaBreachedAt: string | null;
  version: number;
  completedAt: string | null;
};

type WorkItemRow = {
  id: string;
  company_id: string;
  /** Present only on reads that join them; optional so other reads still map. */
  company_name?: string | null;
  owner_name?: string | null;
  owner_team_name?: string | null;
  reviewer_name?: string | null;
  reviewer_team_name?: string | null;
  case_type: WorkItemCaseType;
  annual_return_case_id: string | null;
  corporate_change_request_id: string | null;
  source_event_key: string;
  source_event_type: string;
  work_type: string;
  required_skill_key: string | null;
  title: string;
  status: WorkItemStatus;
  escalation_state: EscalationState;
  priority: number;
  owner_id: string | null;
  reviewer_id: string | null;
  team_id: string | null;
  sla_policy_version_id: string;
  sla_started_at: string | Date;
  sla_warning_at: string | Date;
  sla_due_at: string | Date;
  sla_breached_at: string | Date | null;
  version: number;
  completed_at: string | Date | null;
};

export type QueueFilters = {
  ownerId?: string;
  teamId?: string;
  statuses?: readonly WorkItemStatus[];
  escalationState?: EscalationState;
  q?: string;
  workType?: string;
  unassigned?: boolean;
  priority?: "high" | "normal";
  workStatus?: "open" | "in_progress" | "blocked";
  sort?: "sla" | "recent";
  cursor?: string;
  limit?: number;
  actorKey?: string;
  includeFixtures?: boolean;
};
export type AssignmentTarget = "owner" | "reviewer";
export type AssignWorkItemInput = {
  workItemId: string;
  selectedUserId: string;
  assignedById: string;
  expectedVersion: number;
  assignmentTarget?: AssignmentTarget;
  requiredRole?: AssignmentRole;
  separationOfDuties?: boolean;
  overrideReason?: string;
  expectedTeamId?: string;
};
export type AssignmentDecision = {
  decision: "accepted_recommendation" | "override";
  recommendation: AssignmentRecommendation;
  overrideReason: string | null;
};
export type AcknowledgeEscalationInput = {
  workItemId: string;
  actorId: string;
  note: string;
  expectedTeamId?: string;
};
export type EnsureWorkItemEvent = {
  companyId: string;
  caseType: WorkItemCaseType;
  annualReturnCaseId?: string | null;
  corporateChangeRequestId?: string | null;
  sourceEventKey: string;
  sourceEventType: string;
  workType: string;
  requiredSkillKey?: string | null;
  title: string;
  priority?: number;
  ownerId?: string | null;
  reviewerId?: string | null;
  teamId?: string | null;
  startedAt?: string;
};
export type CreateWorkItemRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
  now?: string | (() => string);
};

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}
function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}
function mapWorkItem(row: WorkItemRow): PersistedWorkItem {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name ?? null,
    ownerName: row.owner_name ?? null,
    ownerTeamName: row.owner_team_name ?? null,
    reviewerName: row.reviewer_name ?? null,
    reviewerTeamName: row.reviewer_team_name ?? null,
    caseType: row.case_type,
    annualReturnCaseId: row.annual_return_case_id,
    corporateChangeRequestId: row.corporate_change_request_id,
    sourceEventKey: row.source_event_key,
    sourceEventType: row.source_event_type,
    workType: row.work_type,
    requiredSkillKey: row.required_skill_key,
    title: row.title,
    status: row.status,
    escalationState: row.escalation_state,
    priority: row.priority,
    ownerId: row.owner_id,
    reviewerId: row.reviewer_id,
    teamId: row.team_id,
    slaPolicyVersionId: row.sla_policy_version_id,
    slaStartedAt: iso(row.sla_started_at),
    slaWarningAt: iso(row.sla_warning_at),
    slaDueAt: iso(row.sla_due_at),
    slaBreachedAt: nullableIso(row.sla_breached_at),
    version: row.version,
    completedAt: nullableIso(row.completed_at),
  };
}

export function sortWorkItemQueue(items: readonly PersistedWorkItem[]): PersistedWorkItem[] {
  return [...items].sort(
    (a, b) =>
      Number(a.slaBreachedAt === null) - Number(b.slaBreachedAt === null) ||
      Date.parse(a.slaDueAt) - Date.parse(b.slaDueAt) ||
      b.priority - a.priority ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function assignmentDecisionFor(input: {
  selectedUserId: string;
  recommendations: readonly AssignmentRecommendation[];
  overrideReason?: string;
}): AssignmentDecision {
  const recommendation = input.recommendations.find((item) => item.userId === input.selectedUserId);
  if (!recommendation) throw new Error("Selected assignee is not eligible for this work item.");
  const overrideReason = input.overrideReason?.trim() || null;
  const requiresOverride =
    recommendation.rank !== 1 || recommendation.factors.capacityUtilization >= 100;
  if (requiresOverride && !overrideReason) {
    throw new Error("An override reason is required for a non-top or overloaded recommendation.");
  }
  return {
    decision: requiresOverride ? "override" : "accepted_recommendation",
    recommendation,
    overrideReason: requiresOverride ? overrideReason : null,
  };
}

export function escalationTransitionsFor(
  item: PersistedWorkItem,
  now: string,
  recorded: readonly Exclude<SlaThreshold, "none">[],
): Exclude<SlaThreshold, "none">[] {
  const threshold = thresholdFor(item, now);
  if (threshold === "none") return [];
  if (threshold === "warning") return recorded.includes("warning") ? [] : ["warning"];

  const transitions: Exclude<SlaThreshold, "none">[] = [];
  if (!recorded.includes("warning")) transitions.push("warning");
  if (!recorded.includes("breach")) transitions.push("breach");
  return transitions;
}

function withTransaction<T>(client: QueryClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in client ? (client.begin(fn) as Promise<T>) : fn(client);
}
async function getWorkItem(
  client: QueryClient,
  id: string,
  lock = false,
): Promise<PersistedWorkItem | null> {
  const rows = lock
    ? await client<WorkItemRow[]>`select * from work_items where id = ${id} for update`
    : await client<WorkItemRow[]>`select * from work_items where id = ${id}`;
  return rows[0] ? mapWorkItem(rows[0]) : null;
}

async function recommendationsFor(
  client: QueryClient,
  item: PersistedWorkItem,
  now: string,
  options: {
    assignmentTarget?: AssignmentTarget;
    requiredRole?: AssignmentRole;
    separationOfDuties?: boolean;
  } = {},
): Promise<(AssignmentRecommendation & AssignmentOption)[]> {
  if (!item.teamId || !item.requiredSkillKey) return [];
  const rows = await client<
    {
      staff_id: string;
      user_id: string;
      role: AssignmentRole;
      team_id: string | null;
      capacity_points: number;
      active: boolean;
      skill_key: string;
      proficiency: number;
      display_name: string;
      team_name: string | null;
    }[]
  >`
    select sp.id staff_id, sp.user_id, sp.role, sp.team_id, sp.capacity_points,
      sp.active, ss.skill_key, ss.proficiency, u.name display_name,t.name team_name
    from staff_profiles sp join staff_skills ss on ss.staff_profile_id = sp.id
    join users u on u.id=sp.user_id and u.active=true and u.role=sp.role and u.team_id=sp.team_id
    left join teams t on t.id=sp.team_id
    where sp.active = true and ss.active = true and sp.team_id = ${item.teamId}
      and ss.skill_key = ${item.requiredSkillKey}
  `;
  const work = await client<
    {
      user_id: string;
      annual_return_case_id: string | null;
      priority: number;
      sla_warning_at: string | Date;
      sla_due_at: string | Date;
      sla_breached_at: string | Date | null;
    }[]
  >`
    select ${options.assignmentTarget === "reviewer" ? client`reviewer_id` : client`owner_id`} user_id,
      annual_return_case_id, priority, sla_warning_at, sla_due_at, sla_breached_at
    from work_items where ${options.assignmentTarget === "reviewer" ? client`reviewer_id` : client`owner_id`} = any(${rows.map((r) => r.user_id)}::uuid[])
      and status in ('open','in_progress','blocked')
  `;
  const candidates: StaffCandidate[] = rows.map((row) => ({
    staffId: row.staff_id,
    userId: row.user_id,
    role: row.role,
    teamIds: row.team_id ? [row.team_id] : [],
    active: row.active,
    available: true,
    capacityPoints: row.capacity_points,
    skills: [{ key: row.skill_key, proficiency: row.proficiency }],
    activeWork: work
      .filter((entry) => entry.user_id === row.user_id)
      .map((entry) => ({
        threshold: thresholdFor(
          {
            id: entry.annual_return_case_id ?? "",
            status: "open",
            priority: entry.priority,
            ownerId: row.user_id,
            reviewerId: null,
            slaWarningAt: iso(entry.sla_warning_at),
            slaDueAt: iso(entry.sla_due_at),
            slaBreachedAt: nullableIso(entry.sla_breached_at),
          },
          now,
        ),
        effortPoints: Math.max(1, Math.ceil(entry.priority / 10)),
      })),
    caseIds: work
      .filter((entry) => entry.user_id === row.user_id)
      .map((entry) => entry.annual_return_case_id),
  }));
  const ranked = rankAssignmentCandidates({
    assignmentTarget: options.assignmentTarget ?? "owner",
    requiredRole: options.requiredRole ?? "Staff",
    requiredSkillKey: item.requiredSkillKey,
    teamId: item.teamId,
    caseId: item.annualReturnCaseId,
    ownerId: item.ownerId,
    reviewerId: item.reviewerId,
    separationOfDuties: options.separationOfDuties ?? true,
    candidates,
  });
  return ranked.map((recommendation) => {
    const row = rows.find((r) => r.user_id === recommendation.userId)!;
    return {
      ...recommendation,
      displayName: row.display_name,
      teamName: row.team_name,
      active: row.active,
      workload: work.filter((w) => w.user_id === row.user_id).length,
    };
  });
}

type PolicyCalendarRow = {
  policy_id: string;
  warning_minutes: number;
  due_minutes: number;
  calendar_id: string;
  timezone: string;
  weekly_schedule: BusinessCalendar["weeklySchedule"];
};

export async function ensureWorkItemForEvent(
  tx: Tx,
  event: EnsureWorkItemEvent,
): Promise<PersistedWorkItem> {
  const existing = await tx<
    WorkItemRow[]
  >`select * from work_items where source_event_key = ${event.sourceEventKey}`;
  if (existing[0]) return mapWorkItem(existing[0]);
  const referenceId =
    event.caseType === "annual_return" ? event.annualReturnCaseId : event.corporateChangeRequestId;
  if (!referenceId) {
    throw new Error(
      `ensureWorkItemForEvent: missing case reference for caseType "${event.caseType}".`,
    );
  }
  const startedAt = event.startedAt ?? new Date().toISOString();
  const policies = await tx<PolicyCalendarRow[]>`
    select p.id policy_id, p.warning_minutes, p.due_minutes, c.id calendar_id,
      c.timezone, c.weekly_schedule
    from sla_policies p join business_calendars c on c.id = p.business_calendar_id
    where p.work_type = ${event.workType} and p.active = true and c.active = true
      and p.effective_from <= ${startedAt}
    order by p.version desc limit 1
  `;
  const policy = policies[0];
  if (!policy) throw new Error(`No active SLA policy exists for work type ${event.workType}.`);
  const holidays = await tx<
    {
      holiday_date: string | Date;
      closed: boolean;
      working_intervals: BusinessCalendar["holidays"][number]["workingIntervals"] | null;
    }[]
  >`
    select holiday_date, closed, working_intervals from business_calendar_holidays
    where business_calendar_id = ${policy.calendar_id}
  `;
  const snapshot = snapshotSla(
    {
      id: policy.policy_id,
      warningMinutes: policy.warning_minutes,
      dueMinutes: policy.due_minutes,
    },
    startedAt,
    {
      id: policy.calendar_id,
      timezone: policy.timezone,
      weeklySchedule: policy.weekly_schedule,
      holidays: holidays.map((holiday) => ({
        date: iso(holiday.holiday_date).slice(0, 10),
        closed: holiday.closed,
        workingIntervals: holiday.working_intervals ?? undefined,
      })),
    },
  );
  const inserted = await tx<WorkItemRow[]>`
    insert into work_items (
      company_id, case_type, annual_return_case_id, corporate_change_request_id,
      source_event_key, source_event_type,
      work_type, required_skill_key, title, priority, owner_id, reviewer_id, team_id,
      sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at
    ) values (
      ${event.companyId}, ${event.caseType}, ${event.annualReturnCaseId ?? null},
      ${event.corporateChangeRequestId ?? null}, ${event.sourceEventKey},
      ${event.sourceEventType}, ${event.workType}, ${event.requiredSkillKey ?? null},
      ${event.title}, ${event.priority ?? 50}, ${event.ownerId ?? null}, ${event.reviewerId ?? null},
      ${event.teamId ?? null}, ${snapshot.policyVersionId}, ${snapshot.startedAt},
      ${snapshot.warningAt}, ${snapshot.dueAt}
    ) on conflict (source_event_key) do nothing returning *
  `;
  if (inserted[0]) return mapWorkItem(inserted[0]);
  const raced = await tx<
    WorkItemRow[]
  >`select * from work_items where source_event_key = ${event.sourceEventKey}`;
  if (!raced[0]) throw new Error("Unable to ensure work item for source event.");
  return mapWorkItem(raced[0]);
}

export type WorkItemRepository = {
  listQueue(filters?: QueueFilters, businessScope?: CaseFilters): Promise<PersistedWorkItem[]>;
  listQueuePage(
    filters?: QueueFilters,
    businessScope?: CaseFilters,
  ): Promise<
    ListPage<WorkQueueSummary> & {
      metrics: { dueToday: number; atRisk: number; breached: number; unassigned: number };
    }
  >;
  get(id: string): Promise<PersistedWorkItem | null>;
  recommendAssignees(
    id: string,
    options?: {
      assignmentTarget?: AssignmentTarget;
      requiredRole?: AssignmentRole;
      separationOfDuties?: boolean;
      expectedTeamId?: string;
    },
  ): Promise<(AssignmentRecommendation & AssignmentOption)[]>;
  assign(input: AssignWorkItemInput): Promise<PersistedWorkItem>;
  acknowledgeEscalation(input: AcknowledgeEscalationInput): Promise<PersistedWorkItem>;
  evaluateEscalations(now?: string): Promise<{ warnings: number; breaches: number }>;
  close(): Promise<void>;
};

export function createWorkItemRepository(
  options?: CreateWorkItemRepositoryOptions,
): WorkItemRepository;
export function createWorkItemRepository(
  databaseUrl: string,
  options?: Omit<CreateWorkItemRepositoryOptions, "sql">,
): WorkItemRepository;
export function createWorkItemRepository(
  databaseUrlOrOptions: string | CreateWorkItemRepositoryOptions = {},
  maybeOptions: Omit<CreateWorkItemRepositoryOptions, "sql"> = {},
): WorkItemRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const options: CreateWorkItemRepositoryOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !options.sql;
  const readNow = () =>
    typeof options.now === "function" ? options.now() : (options.now ?? new Date().toISOString());

  const repository: WorkItemRepository = {
    async listQueue(filters = {}, businessScope) {
      const statuses = filters.statuses ?? ["open", "in_progress", "blocked"];
      const rows = await sql<WorkItemRow[]>`
        select w.*, c.company_name, owner.name as owner_name,ot.name owner_team_name,reviewer.name reviewer_name,rt.name reviewer_team_name
        from work_items w
        left join companies c on c.id = w.company_id
        left join users owner on owner.id = w.owner_id
        left join teams ot on ot.id=owner.team_id
        left join users reviewer on reviewer.id=w.reviewer_id
        left join teams rt on rt.id=reviewer.team_id
        where w.status = any(${statuses as WorkItemStatus[]})
          and (${filters.ownerId ?? null}::uuid is null or w.owner_id = ${filters.ownerId ?? null})
          and (${filters.teamId ?? null}::uuid is null or w.team_id = ${filters.teamId ?? null})
          and (${filters.escalationState ?? null}::text is null
            or w.escalation_state = ${filters.escalationState ?? null})
        order by (w.sla_breached_at is null), w.sla_due_at, w.priority desc, w.id
      `;
      const items = rows.map(mapWorkItem);
      if (!businessScope) return items;
      const caseIds = [
        ...new Set(items.flatMap((i) => (i.annualReturnCaseId ? [i.annualReturnCaseId] : []))),
      ];
      if (!caseIds.length) return items;
      const annualReturn = createAnnualReturnRepository({ sql, today: readNow() });
      const cases = await annualReturn.listAllCases({ ...businessScope, caseIds });
      const contexts = new Map(
        cases.map((c) => [c.id, caseBusinessContext(c, hongKongBusinessDate(new Date(readNow())))]),
      );
      return items.map((item) => ({
        ...item,
        businessContext: item.annualReturnCaseId
          ? (contexts.get(item.annualReturnCaseId) ?? null)
          : null,
      }));
    },
    async listQueuePage(
      filters = {},
      businessScope,
    ): Promise<
      ListPage<WorkQueueSummary> & {
        metrics: { dueToday: number; atRisk: number; breached: number; unassigned: number };
      }
    > {
      const limit = listPageSize.parse(filters.limit);
      const { cursor: _cursor, ...queryFilters } = filters;
      const key = JSON.stringify([queryFilters, businessScope ?? null]);
      const cursor = decodeListCursor(filters.cursor, key, 4);
      if (cursor) {
        z.enum(["0", "1", "2"]).parse(cursor[0]);
        z.string().datetime({ offset: true }).parse(cursor[1]);
        z.coerce.number().int().min(-100).max(0).parse(cursor[2]);
        z.string().uuid().parse(cursor[3]);
      }
      const scope = queueScopeSql(sql, filters);
      const [count] = await sql`select count(*)::int total,
        count(*) filter(where (w.sla_due_at at time zone 'Asia/Hong_Kong')::date=${hongKongBusinessDate(new Date(readNow()))}::date)::int due_today,
        count(*) filter(where w.escalation_state='warning')::int at_risk,
        count(*) filter(where w.escalation_state='breach')::int breached,
        count(*) filter(where w.owner_id is null)::int unassigned
        from work_items w left join companies c on c.id=w.company_id where ${scope}`;
      const rows = await sql<
        (WorkItemRow & {
          filing_due_date: string | null;
          payment_status: string | null;
          case_status: string | null;
          cursor_sort_a: string;
          cursor_sort_b: string;
          cursor_sort_c: string;
        })[]
      >`
        with scoped as (
          select w.*,c.company_name,owner.name owner_name,ot.name owner_team_name,reviewer.name reviewer_name,rt.name reviewer_team_name,
            a.filing_due_date::text,a.current_status case_status,p.status payment_status,
            case when ${filters.sort === "recent"} then 0 when w.sla_due_at is null then 2 when w.sla_breached_at is not null then 0 else 1 end sort_a,
            case when ${filters.sort === "recent"} then to_timestamp(-extract(epoch from w.updated_at)) else coalesce(w.sla_due_at,'0001-01-01'::timestamptz) end sort_b,
            -w.priority sort_c
          from work_items w left join companies c on c.id=w.company_id
          left join users owner on owner.id=w.owner_id left join teams ot on ot.id=owner.team_id
          left join users reviewer on reviewer.id=w.reviewer_id left join teams rt on rt.id=reviewer.team_id
          left join annual_return_cases a on a.id=w.annual_return_case_id and a.company_id=w.company_id
            and (${businessScope?.teamId ?? null}::uuid is null or c.assigned_team_id=${businessScope?.teamId ?? null})
            and (${businessScope?.visibleToUserId ?? null}::uuid is null or a.owner_id=${businessScope?.visibleToUserId ?? null} or a.reviewer_id=${businessScope?.visibleToUserId ?? null})
            and (${businessScope?.companyIds === undefined ? null : [...businessScope.companyIds]}::uuid[] is null or c.id=any(${businessScope?.companyIds === undefined ? null : [...businessScope.companyIds]}::uuid[]))
            and (${businessScope?.includeFixtures ?? false} or c.data_origin<>'fixture')
          left join payments p on p.case_id=a.id and p.company_id=c.id
          where ${scope}
        ) select *,sort_a::text cursor_sort_a,sort_b::text cursor_sort_b,sort_c::text cursor_sort_c from scoped
        where (${cursor?.[3] ?? null}::uuid is null or (sort_a,sort_b,sort_c,id)>(${cursor?.[0] ?? "0"}::int,${cursor?.[1] ?? "1970-01-01T00:00:00Z"}::timestamptz,${cursor?.[2] ?? "0"}::int,${cursor?.[3] ?? null}::uuid))
        order by sort_a,sort_b,sort_c,id limit ${limit + 1}`;
      const page = rows.slice(0, limit),
        last = page.at(-1);
      return {
        items: page.map((row) => ({
          ...mapWorkItem(row),
          slaStartedAt: row.sla_started_at ? iso(row.sla_started_at) : null,
          slaWarningAt: row.sla_warning_at ? iso(row.sla_warning_at) : null,
          slaDueAt: row.sla_due_at ? iso(row.sla_due_at) : null,
          businessContext: row.filing_due_date
            ? {
                filingDueDate: row.filing_due_date,
                sourceVersion: null,
                blockers: [
                  {
                    code:
                      row.payment_status && row.payment_status !== "Payment received"
                        ? "payment_not_received"
                        : "readiness_review_required",
                    stage: "prepare" as const,
                    message:
                      row.payment_status && row.payment_status !== "Payment received"
                        ? "付款尚未核實入賬，先核對款項。"
                        : "開啟案件核對當前文件及交件安全狀態。",
                    action: `/annual-returns/${row.annual_return_case_id}`,
                  },
                ],
              }
            : null,
        })),
        total: count.total,
        observedAt: readNow(),
        nextCursor:
          rows.length > limit && last
            ? encodeListCursor(key, [
                last.cursor_sort_a,
                last.cursor_sort_b.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
                last.cursor_sort_c,
                last.id,
              ])
            : null,
        metrics: {
          dueToday: count.due_today,
          atRisk: count.at_risk,
          breached: count.breached,
          unassigned: count.unassigned,
        },
      };
    },
    get(id) {
      return getWorkItem(sql, id);
    },
    recommendAssignees(id, recommendationOptions = {}) {
      return withTransaction(sql, async (tx) => {
        const item = await getWorkItem(tx, id, true);
        if (!item) throw new Error("Work item not found.");
        if (
          recommendationOptions.expectedTeamId &&
          item.teamId !== recommendationOptions.expectedTeamId
        ) {
          throw new Error("Forbidden: work item moved outside the actor's team.");
        }
        return recommendationsFor(tx, item, readNow(), recommendationOptions);
      });
    },
    assign(input) {
      return withTransaction(sql, async (tx) => {
        const unlocked = await getWorkItem(tx, input.workItemId);
        if (unlocked?.annualReturnCaseId) {
          const [parent] =
            await tx`select id from annual_return_cases where id=${unlocked.annualReturnCaseId} and locked_at is null and completed_at is null and current_status<>'Completed' for update`;
          if (!parent) throw new Error("Closed annual-return case cannot be assigned.");
        }
        const item = await getWorkItem(tx, input.workItemId, true);
        if (!item) throw new Error("Work item not found.");
        if (item.version !== input.expectedVersion)
          throw new Error("Work item assignment is stale.");
        if (input.expectedTeamId && item.teamId !== input.expectedTeamId) {
          throw new Error("Forbidden: work item moved outside the actor's team.");
        }
        if (item.status === "completed" || item.status === "cancelled") {
          throw new Error("Closed work items cannot be assigned.");
        }
        const assignmentTarget = input.assignmentTarget ?? "owner";
        const currentActor = await lockActiveStaffUser(tx, input.assignedById);
        if (
          currentActor.role !== "Admin" &&
          (currentActor.role !== "Manager" ||
            !currentActor.team_id ||
            currentActor.team_id !== item.teamId)
        ) {
          throw new Error("Forbidden: current Manager team or Admin required.");
        }
        await lockActiveStaffUser(tx, input.selectedUserId);
        const recommendations = await recommendationsFor(tx, item, readNow(), {
          assignmentTarget,
          requiredRole: input.requiredRole,
          separationOfDuties: input.separationOfDuties,
        });
        const decision = assignmentDecisionFor({
          selectedUserId: input.selectedUserId,
          recommendations,
          overrideReason: input.overrideReason,
        });
        const previousAssigneeId = assignmentTarget === "owner" ? item.ownerId : item.reviewerId;
        const updated =
          assignmentTarget === "owner"
            ? await tx<WorkItemRow[]>`
              update work_items set owner_id = ${input.selectedUserId}, status = 'in_progress',
                version = version + 1, updated_at = now()
              where id = ${item.id} and version = ${input.expectedVersion} returning *`
            : await tx<WorkItemRow[]>`
              update work_items set reviewer_id = ${input.selectedUserId},
                version = version + 1, updated_at = now()
              where id = ${item.id} and version = ${input.expectedVersion} returning *`;
        if (!updated[0]) throw new Error("Work item assignment is stale.");
        await tx`
          insert into assignment_events (
            work_item_id, previous_assignee_id, assigned_to_id, assigned_by_id,
            recommendation_rank, recommendation_score, recommendation_factors,
            decision, override_reason, expected_version
          ) values (
            ${item.id}, ${previousAssigneeId}, ${input.selectedUserId}, ${input.assignedById},
            ${decision.recommendation.rank}, ${decision.recommendation.score},
            ${tx.json({
              selected: decision.recommendation.factors,
              recommendations,
              assignmentTarget,
            })}, ${decision.decision},
            ${decision.overrideReason}, ${input.expectedVersion})`;
        await tx`
          insert into timeline_events (
            company_id, case_id, event_type, actor_type, actor_id, description, metadata
          ) values (${item.companyId}, ${item.annualReturnCaseId}, 'work_item_assigned', 'user',
            ${input.assignedById}, ${`Work item ${assignmentTarget} assigned.`},
            ${tx.json({
              workItemId: item.id,
              assignmentTarget,
              assignedToId: input.selectedUserId,
              decision: decision.decision,
              expectedVersion: input.expectedVersion,
            })})`;
        return mapWorkItem(updated[0]);
      });
    },
    acknowledgeEscalation(input) {
      if (!input.note.trim()) {
        return Promise.reject(new Error("Acknowledgement note is required."));
      }
      return withTransaction(sql, async (tx) => {
        const item = await getWorkItem(tx, input.workItemId, true);
        if (!item) throw new Error("Work item not found.");
        if (input.expectedTeamId && item.teamId !== input.expectedTeamId) {
          throw new Error("Forbidden: work item moved outside the actor's team.");
        }
        if (item.escalationState !== "warning" && item.escalationState !== "breach") {
          throw new Error("Work item has no active escalation to acknowledge.");
        }
        const acknowledged = await tx<{ id: string }[]>`
          update escalation_events set acknowledged_by_id = ${input.actorId}, acknowledged_at = now(),
            acknowledgement_note = ${input.note.trim()}
          where work_item_id = ${input.workItemId} and threshold = ${item.escalationState}
            and acknowledged_at is null returning id`;
        if (!acknowledged[0]) throw new Error("Escalation was already acknowledged.");
        const rows = await tx<WorkItemRow[]>`
          update work_items set escalation_state = 'acknowledged', version = version + 1,
            updated_at = now() where id = ${input.workItemId} returning *`;
        await tx`
          insert into timeline_events (
            company_id, case_id, event_type, actor_type, actor_id, description, metadata
          ) values (${item.companyId}, ${item.annualReturnCaseId}, 'work_item_escalation_acknowledged',
            'user', ${input.actorId}, 'Work item escalation acknowledged.',
            ${tx.json({ workItemId: item.id, threshold: item.escalationState, note: input.note.trim() })})`;
        return mapWorkItem(rows[0]);
      });
    },
    async evaluateEscalations(now = readNow()) {
      const items = await repository.listQueue();
      let warnings = 0;
      let breaches = 0;
      for (const candidate of items) {
        await withTransaction(sql, async (tx) => {
          const item = await getWorkItem(tx, candidate.id, true);
          if (!item) return;
          const recorded = await tx<{ threshold: "warning" | "breach" }[]>`
            select threshold from escalation_events where work_item_id = ${item.id}`;
          for (const threshold of escalationTransitionsFor(
            item,
            now,
            recorded.map((row) => row.threshold),
          )) {
            const occurredAt = threshold === "warning" ? item.slaWarningAt : item.slaDueAt;
            const inserted = await tx<{ id: string }[]>`
              insert into escalation_events (
                work_item_id, sla_policy_version_id, threshold, occurred_at
              ) values (${item.id}, ${item.slaPolicyVersionId}, ${threshold}, ${occurredAt})
              on conflict (work_item_id, sla_policy_version_id, threshold) do nothing returning id`;
            if (!inserted[0]) continue;
            if (threshold === "breach") {
              await tx`
                update work_items set escalation_state = 'breach',
                  sla_breached_at = coalesce(sla_breached_at, ${occurredAt}),
                  version = version + 1, updated_at = now()
                where id = ${item.id}`;
              breaches += 1;
            } else {
              await tx`
                update work_items set escalation_state = case when escalation_state = 'none'
                  then 'warning' else escalation_state end,
                  version = version + 1, updated_at = now()
                where id = ${item.id}`;
              warnings += 1;
            }
            await tx`
              insert into timeline_events (
                company_id, case_id, event_type, actor_type, actor_id, description, metadata
              ) values (${item.companyId}, ${item.annualReturnCaseId}, ${`work_item_sla_${threshold}`},
                'system', null, ${`Work item SLA ${threshold} reached.`},
                ${tx.json({
                  workItemId: item.id,
                  policyVersionId: item.slaPolicyVersionId,
                  threshold,
                  occurredAt,
                })})`;
            // An SLA breach means the firm is late on its own work, so this is an
            // internal alert and must not reach the client. Staff have no phone
            // column anywhere in the schema, only an email, which is why the channel
            // is email rather than whatsapp. An unassigned item still breaches, so
            // fall back to the owning team's manager.
            const [escalationRecipient] = await tx<{ email: string | null }[]>`
              select coalesce(owner.email, manager.email) as email
              from work_items wi
              left join users owner on owner.id = wi.owner_id and owner.active
              left join teams t on t.id = wi.team_id
              left join users manager on manager.id = t.manager_id and manager.active
              where wi.id = ${item.id}
            `;

            // notification_outbox_redaction_check forbids a null recipient on a
            // non-redacted row, so with nobody to tell we record the escalation
            // event above and skip the notification rather than failing the write.
            if (escalationRecipient?.email) {
              await enqueueNotification(tx, {
                companyId: item.companyId,
                workItemId: item.id,
                channel: "email",
                notificationType: `work_item_sla_${threshold}`,
                recipient: escalationRecipient.email,
                payload: {
                  caseId: item.annualReturnCaseId,
                  workItemId: item.id,
                  threshold,
                  occurredAt,
                  subject: `SLA ${threshold} reached for ${item.title}`,
                  body: `Work item SLA ${threshold} reached for ${item.title}.`,
                },
              });
            }
          }
        });
      }
      return { warnings, breaches };
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
  return repository;
}
