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
  WorkItemStatus,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
export type EscalationState = "none" | "warning" | "breach" | "acknowledged";

export type PersistedWorkItem = {
  id: string;
  companyId: string;
  caseId: string;
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
  case_id: string;
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
  caseId: string;
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
    caseId: row.case_id,
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
      team_id: string | null;
      capacity_points: number;
      active: boolean;
      skill_key: string;
      proficiency: number;
    }[]
  >`
    select sp.id staff_id, sp.user_id, sp.role, sp.team_id, sp.capacity_points,
      sp.active, ss.skill_key, ss.proficiency
    from staff_profiles sp join staff_skills ss on ss.staff_profile_id = sp.id
    where sp.active = true and ss.active = true and sp.team_id = ${item.teamId}
      and ss.skill_key = ${item.requiredSkillKey}
  `;
  const work = await client<
    {
      user_id: string;
      case_id: string;
      priority: number;
      sla_warning_at: string | Date;
      sla_due_at: string | Date;
      sla_breached_at: string | Date | null;
    }[]
  >`
    select ${options.assignmentTarget === "reviewer" ? client`reviewer_id` : client`owner_id`} user_id,
      case_id, priority, sla_warning_at, sla_due_at, sla_breached_at
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
            id: entry.case_id,
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
    caseIds: work.filter((entry) => entry.user_id === row.user_id).map((entry) => entry.case_id),
  }));
  return rankAssignmentCandidates({
    assignmentTarget: options.assignmentTarget ?? "owner",
    requiredRole: options.requiredRole ?? "Staff",
    requiredSkillKey: item.requiredSkillKey,
    teamId: item.teamId,
    caseId: item.caseId,
    ownerId: item.ownerId,
    reviewerId: item.reviewerId,
    separationOfDuties: options.separationOfDuties ?? true,
    candidates,
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
      company_id, case_id, source_event_key, source_event_type, work_type,
      required_skill_key, title, priority, owner_id, reviewer_id, team_id,
      sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at
    ) values (
      ${event.companyId}, ${event.caseId}, ${event.sourceEventKey}, ${event.sourceEventType},
      ${event.workType}, ${event.requiredSkillKey ?? null}, ${event.title}, ${event.priority ?? 50},
      ${event.ownerId ?? null}, ${event.reviewerId ?? null}, ${event.teamId ?? null},
      ${snapshot.policyVersionId}, ${snapshot.startedAt}, ${snapshot.warningAt}, ${snapshot.dueAt}
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
    async listQueue(filters = {}) {
      const statuses = filters.statuses ?? ["open", "in_progress", "blocked"];
      const rows = await sql<WorkItemRow[]>`
        select * from work_items
        where status = any(${statuses as WorkItemStatus[]})
          and (${filters.ownerId ?? null}::uuid is null or owner_id = ${filters.ownerId ?? null})
          and (${filters.teamId ?? null}::uuid is null or team_id = ${filters.teamId ?? null})
          and (${filters.escalationState ?? null}::text is null
            or escalation_state = ${filters.escalationState ?? null})
        order by (sla_breached_at is null), sla_due_at, priority desc, id
      `;
      return rows.map(mapWorkItem);
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
          ) values (${item.companyId}, ${item.caseId}, 'work_item_assigned', 'user',
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
          ) values (${item.companyId}, ${item.caseId}, 'work_item_escalation_acknowledged',
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
              ) values (${item.companyId}, ${item.caseId}, ${`work_item_sla_${threshold}`},
                'system', null, ${`Work item SLA ${threshold} reached.`},
                ${tx.json({
                  workItemId: item.id,
                  policyVersionId: item.slaPolicyVersionId,
                  threshold,
                  occurredAt,
                })})`;
            await enqueueNotification(tx, {
              companyId: item.companyId,
              workItemId: item.id,
              channel: "whatsapp",
              notificationType: `work_item_sla_${threshold}`,
              payload: {
                caseId: item.caseId,
                workItemId: item.id,
                threshold,
                occurredAt,
                body: `Work item SLA ${threshold} reached for ${item.title}.`,
              },
            });
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
