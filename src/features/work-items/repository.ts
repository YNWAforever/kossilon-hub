import { assertAssignableStaffTarget } from "@/features/auth/staff-target";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import { rankAssignmentCandidates } from "./assignment";
import { snapshotSla, thresholdFor } from "./sla";
import { enqueueNotification } from "@/features/notifications/outbox";
import type {
  AssignmentRecommendation,
  AssignmentRole,
  BusinessCalendar,
  SlaThreshold,
  StaffCandidate,
  WorkQueuePerson,
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
  ownerPerson?: WorkQueuePerson | null;
  workDueAt?: string | null;
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
  owner_role?: AssignmentRole | null;
  owner_team_name?: string | null;
  owner_staff_active?: boolean | null;
  owner_user_active?: boolean | null;
  work_due_at?: string | Date | null;
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
    ownerPerson:
      row.owner_id && row.owner_name && row.owner_role
        ? {
            id: row.owner_id,
            name: row.owner_name,
            role: row.owner_role,
            teamName: row.owner_team_name ?? null,
            active: row.owner_staff_active === true && row.owner_user_active === true,
          }
        : null,
    workDueAt: row.work_due_at ? iso(row.work_due_at) : null,
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
): Promise<AssignmentRecommendation[]> {
  if (!item.teamId || !item.requiredSkillKey) return [];
  const rows = await client<
    {
      staff_id: string;
      user_id: string;
      role: AssignmentRole;
      name: string;
      team_name: string | null;
      user_active: boolean;
      team_id: string | null;
      capacity_points: number;
      active: boolean;
      skill_key: string;
      proficiency: number;
    }[]
  >`
    select sp.id staff_id, sp.user_id, sp.role, sp.team_id, sp.capacity_points,
      sp.active, ss.skill_key, ss.proficiency, u.name, t.name as team_name, u.active as user_active
    from staff_profiles sp join staff_skills ss on ss.staff_profile_id = sp.id
    join users u on u.id = sp.user_id
    left join teams t on t.id = sp.team_id
    where sp.active = true and u.active = true and ss.active = true and sp.team_id = ${item.teamId}
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
    from work_items where ${options.assignmentTarget === "reviewer" ? client`reviewer_id` : client`owner_id`} is not null
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
  const byUserId = new Map(rows.map((row) => [row.user_id, row]));
  return ranked.map((recommendation) => {
    const row = byUserId.get(recommendation.userId);
    return {
      ...recommendation,
      person: row
        ? {
            id: row.user_id,
            name: row.name,
            role: row.role,
            teamName: row.team_name,
            active: row.active && row.user_active,
          }
        : undefined,
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
  listQueue(filters?: QueueFilters): Promise<PersistedWorkItem[]>;
  lastSlaEvaluationAt(): Promise<string | null>;
  get(id: string): Promise<PersistedWorkItem | null>;
  recommendAssignees(
    id: string,
    options?: {
      assignmentTarget?: AssignmentTarget;
      requiredRole?: AssignmentRole;
      separationOfDuties?: boolean;
      expectedTeamId?: string;
    },
  ): Promise<AssignmentRecommendation[]>;
  assign(input: AssignWorkItemInput): Promise<PersistedWorkItem>;
  acknowledgeEscalation(input: AcknowledgeEscalationInput): Promise<PersistedWorkItem>;
  evaluateEscalations(
    now?: string,
    limit?: number,
  ): Promise<{ warnings: number; breaches: number }>;
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
    async listQueue(filters = {}) {
      const statuses = filters.statuses ?? ["open", "in_progress", "blocked"];
      const rows = await sql<WorkItemRow[]>`
        select w.*, c.company_name, owner.name as owner_name,
          owner_profile.role as owner_role, owner_team.name as owner_team_name,
          owner_profile.active as owner_staff_active, owner.active as owner_user_active
        from work_items w
        left join companies c on c.id = w.company_id
        left join users owner on owner.id = w.owner_id
        left join staff_profiles owner_profile on owner_profile.user_id = owner.id
        left join teams owner_team on owner_team.id = owner_profile.team_id
        where w.status = any(${statuses as WorkItemStatus[]})
          and (${filters.ownerId ?? null}::uuid is null or w.owner_id = ${filters.ownerId ?? null})
          and (${filters.teamId ?? null}::uuid is null or w.team_id = ${filters.teamId ?? null})
          and (${filters.escalationState ?? null}::text is null
            or w.escalation_state = ${filters.escalationState ?? null})
        order by (w.sla_breached_at is null), w.sla_due_at, w.priority desc, w.id
      `;
      return rows.map(mapWorkItem);
    },
    async lastSlaEvaluationAt() {
      const rows = await sql<{ finished_at: string | Date | null }[]>`
        select max(finished_at) finished_at from maintenance_runs
        where trigger_source = 'scheduled' and (
            passes->>'escalations' is not null
            or passes @> '{"jobs":[{"job":"evaluateEscalations","state":"succeeded"}]}'::jsonb
          )
      `;
      return rows[0]?.finished_at ? iso(rows[0].finished_at) : null;
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
        await assertAssignableStaffTarget(tx, input.selectedUserId, item.teamId);
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
    async evaluateEscalations(now = readNow(), limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("Escalation batch limit must be between 1 and 500.");
      // The prior pass loaded every work item before deciding which ones were
      // due. Select only unrecorded thresholds, so the next tick drains the
      // following batch instead of repeatedly examining the same first page.
      const items = await sql<{ id: string }[]>`
        select w.id from work_items w
        where w.status not in ('completed', 'cancelled')
          and (
            (w.sla_warning_at <= ${now} and not exists (
              select 1 from escalation_events e
              where e.work_item_id = w.id
                and e.sla_policy_version_id = w.sla_policy_version_id
                and e.threshold = 'warning'
            ))
            or ((w.sla_due_at <= ${now} or w.sla_breached_at is not null) and not exists (
              select 1 from escalation_events e
              where e.work_item_id = w.id
                and e.sla_policy_version_id = w.sla_policy_version_id
                and e.threshold = 'breach'
            ))
          )
        order by w.sla_due_at, w.id
        limit ${limit}
      `;
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
