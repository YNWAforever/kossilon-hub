# Generalize Work Items Beyond Annual Returns (P1-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `work_items`' hard dependency on `annual_return_cases`, so a future case type
(P1-6/7/9) can create work items without a schema change to `work_items` itself — while every
existing annual-return workflow behaves identically to today.

**Architecture:** Replace `work_items.case_id uuid not null references annual_return_cases(id)`
with `case_type text not null` (a CHECK-constrained list, extended one value per future case
type) plus `annual_return_case_id uuid references annual_return_cases(id)` (the first of what
will be one nullable FK column per case type). Every consumer of a work item's case reference —
2 repository call sites, 1 assignment-scoring feed, 3 `timeline_events` inserts, 1 notification
payload, 2 UI files — is updated to the new shape. No new case type is introduced; this is a
pure refactor.

**Tech Stack:** Postgres (raw SQL, no ORM) · TypeScript 5.8 strict · TanStack Query 5 · Vitest 4.

**Reference files** (read, not modified beyond what's specified):
- `src/server/db/schema.sql` — canonical current-state schema (updated alongside the migration).
- `src/features/work-items/repository.ts` — `PersistedWorkItem`, `EnsureWorkItemEvent`,
  `ensureWorkItemForEvent`, `recommendationsFor`, the three mutation methods that write
  `timeline_events`.
- `src/features/work-items/assignment.ts` — pure scoring logic, one line reads `caseId` for a
  continuity bonus.
- `src/features/annual-return/repository.ts` — the only 2 callers of `ensureWorkItemForEvent`.
- `src/routes/work-queue.tsx`, `src/routes/annual-returns.tsx`,
  `src/features/annual-return/components/production-command-center.tsx` — the 3 UI consumers.

---

### Task 1: Schema migration

**Files:**
- Create: `db/migrations/0014_generalize_work_item_case_reference.sql`
- Modify: `src/server/db/schema.sql` (the `work_items` table definition)

- [ ] **Step 1: Write the migration**

```sql
-- 0014: generalize work_items' case reference beyond annual returns.
--
-- work_items.case_id was `not null references annual_return_cases(id)`, so no other
-- case type (SCR, incorporation intake, ad hoc changes — P1-6/7/9) could ever create a
-- work item. This replaces it with a case_type discriminator plus one nullable FK
-- column per case type — today just annual_return_case_id. A future case type adds its
-- own nullable FK column and extends the two CHECK constraints below, in its own
-- migration; this file is not touched again.

alter table work_items add column case_type text;
alter table work_items add column annual_return_case_id uuid
  references annual_return_cases(id) on delete restrict;

update work_items set case_type = 'annual_return', annual_return_case_id = case_id;

alter table work_items alter column case_type set not null;

alter table work_items add constraint work_items_case_type_check
  check (case_type in ('annual_return'));

alter table work_items add constraint work_items_case_reference_check
  check (case_type <> 'annual_return' or annual_return_case_id is not null);

alter table work_items drop constraint work_items_case_id_fkey;
alter table work_items drop column case_id;
```

- [ ] **Step 2: Determine the real FK constraint name and adjust if needed**

Postgres auto-names a column FK as `<table>_<column>_fkey` unless the original `create table`
gave it an explicit name. Run this against a database that already has the `work_items` table
(local dev DB is fine — this is a read-only check):

```bash
psql "$DATABASE_URL" -c "\d work_items" | grep -i "case_id\|foreign key"
```

If the constraint name printed differs from `work_items_case_id_fkey`, update the `drop
constraint` line in the migration to match the real name before proceeding. (If `psql` isn't
available, running `npm run db:migrate` in Step 4 below will surface the real name in its
error output if the guessed name is wrong — fix and retry.)

- [ ] **Step 3: Update the canonical schema**

In `src/server/db/schema.sql`, replace the `work_items` table's `case_id` line:

```sql
  case_id uuid not null references annual_return_cases(id) on delete restrict,
```

with:

```sql
  case_type text not null check (case_type in ('annual_return')),
  annual_return_case_id uuid references annual_return_cases(id) on delete restrict,
```

and add the cross-column check constraint alongside the table's existing
`work_items_sla_order_check`/`work_items_completion_state_check` constraints:

```sql
  constraint work_items_case_reference_check check (
    case_type <> 'annual_return' or annual_return_case_id is not null
  ),
```

- [ ] **Step 4: Apply the migration to your local dev database**

Run: `npm run db:migrate`

This requires **explicit user approval if `DATABASE_URL` points to anything other than a
local database** — check its value first (`echo $DATABASE_URL`, without printing it if it
looks like a real credential) and stop to ask if it's not clearly local. Confirm the command
completes without error.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0014_generalize_work_item_case_reference.sql src/server/db/schema.sql
git commit -m "feat: generalize work_items' case reference beyond annual returns (schema)"
```

---

### Task 2: Repository and types layer

**Files:**
- Modify: `src/features/work-items/types.ts`
- Modify: `src/features/work-items/repository.ts`
- Modify: `src/features/work-items/assignment.ts`
- Modify: `src/features/work-items/repository.test.ts`

- [ ] **Step 1: Update the failing unit test fixture**

In `src/features/work-items/repository.test.ts`, change the `item()` builder's fixture
(currently `caseId: "case-1"`) to:

```ts
function item(id: string, input: Partial<PersistedWorkItem> = {}): PersistedWorkItem {
  return {
    id,
    companyId: "company-1",
    caseType: "annual_return",
    annualReturnCaseId: "case-1",
    sourceEventKey: `event:${id}`,
    sourceEventType: "status_changed",
    workType: "annual_return_status",
    requiredSkillKey: "annual_returns",
    title: id,
    status: "open",
    escalationState: "none",
    priority: 50,
    ownerId: null,
    reviewerId: null,
    teamId: "team-1",
    slaPolicyVersionId: "policy-1",
    slaStartedAt: "2026-07-01T01:00:00.000Z",
    slaWarningAt: "2026-07-01T02:00:00.000Z",
    slaDueAt: "2026-07-01T03:00:00.000Z",
    slaBreachedAt: null,
    version: 1,
    completedAt: null,
    ...input,
  };
}
```

Also update the DB-integration test's raw fixture insert further down in the same file
(inside `describe.skipIf(!databaseUrl)("work-item repository integration", ...)`). The
`select ... arc.id case_id ...` projection and the `insert into work_items (...)` statement
change from:

```ts
          const fixtures = await tx<
            {
              company_id: string;
              case_id: string;
              team_id: string;
              skill_key: string;
              policy_id: string;
            }[]
          >`
            select arc.company_id, arc.id case_id, sp.team_id, ss.skill_key, p.id policy_id
            from annual_return_cases arc
            cross join staff_profiles sp
            join staff_skills ss on ss.staff_profile_id = sp.id and ss.active = true
            join sla_policies p on p.work_type = 'annual_return_case' and p.active = true
            where sp.active = true and sp.role = 'Staff' and sp.team_id is not null
            order by arc.id, sp.id, p.version desc
            limit 1
          `;
          const fixture = fixtures[0];
          expect(fixture).toBeDefined();
          const token = crypto.randomUUID();
          const warningId = crypto.randomUUID();
          const breachId = crypto.randomUUID();

          await tx`
            insert into work_items (
              id, company_id, case_id, source_event_key, source_event_type, work_type,
              required_skill_key, title, priority, team_id, sla_policy_version_id,
              sla_started_at, sla_warning_at, sla_due_at, sla_breached_at
            ) values
              (${warningId}, ${fixture.company_id}, ${fixture.case_id}, ${`test:${token}:warning`},
                'test_event', 'annual_return_case', ${fixture.skill_key}, 'Warning fixture', 80,
                ${fixture.team_id}, ${fixture.policy_id}, '2026-07-01T00:00:00.000Z',
                '2026-07-01T01:00:00.000Z', '2026-07-01T03:00:00.000Z', null),
              (${breachId}, ${fixture.company_id}, ${fixture.case_id}, ${`test:${token}:breach`},
                'test_event', 'annual_return_case', ${fixture.skill_key}, 'Breach fixture', 20,
                ${fixture.team_id}, ${fixture.policy_id}, '2026-07-01T00:00:00.000Z',
                '2026-07-01T01:00:00.000Z', '2026-07-01T05:00:00.000Z',
                '2026-07-01T01:30:00.000Z')
          `;
```

to:

```ts
          const fixtures = await tx<
            {
              company_id: string;
              case_id: string;
              team_id: string;
              skill_key: string;
              policy_id: string;
            }[]
          >`
            select arc.company_id, arc.id case_id, sp.team_id, ss.skill_key, p.id policy_id
            from annual_return_cases arc
            cross join staff_profiles sp
            join staff_skills ss on ss.staff_profile_id = sp.id and ss.active = true
            join sla_policies p on p.work_type = 'annual_return_case' and p.active = true
            where sp.active = true and sp.role = 'Staff' and sp.team_id is not null
            order by arc.id, sp.id, p.version desc
            limit 1
          `;
          const fixture = fixtures[0];
          expect(fixture).toBeDefined();
          const token = crypto.randomUUID();
          const warningId = crypto.randomUUID();
          const breachId = crypto.randomUUID();

          await tx`
            insert into work_items (
              id, company_id, case_type, annual_return_case_id, source_event_key,
              source_event_type, work_type, required_skill_key, title, priority, team_id,
              sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at, sla_breached_at
            ) values
              (${warningId}, ${fixture.company_id}, 'annual_return', ${fixture.case_id},
                ${`test:${token}:warning`}, 'test_event', 'annual_return_case',
                ${fixture.skill_key}, 'Warning fixture', 80, ${fixture.team_id},
                ${fixture.policy_id}, '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z',
                '2026-07-01T03:00:00.000Z', null),
              (${breachId}, ${fixture.company_id}, 'annual_return', ${fixture.case_id},
                ${`test:${token}:breach`}, 'test_event', 'annual_return_case',
                ${fixture.skill_key}, 'Breach fixture', 20, ${fixture.team_id},
                ${fixture.policy_id}, '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z',
                '2026-07-01T05:00:00.000Z', '2026-07-01T01:30:00.000Z')
          `;
```

(Only the `insert into` statement's column list and values change — the `select` fixture
query stays the same, it's still reading a real `annual_return_cases` row to seed from.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -- src/features/work-items/repository.test.ts`
Expected: FAIL — the unit tests fail because `PersistedWorkItem` doesn't yet have
`caseType`/`annualReturnCaseId` (TypeScript error) and the DB-integration test (if
`TEST_DATABASE_URL` is set) fails because `work_items` doesn't yet have the new columns (or
still has `case_id` if Task 1 hasn't been applied to that database).

- [ ] **Step 3: Update `types.ts`**

In `src/features/work-items/types.ts`, add the case-type discriminator as a single named,
exported type — every other file in this plan imports it rather than repeating the literal
`"annual_return"` string, so a future case type only ever needs to widen this one union:

```ts
export type WorkItemCaseType = "annual_return";
```

Add it near the top of the file, above `WorkItemStatus`. Then widen the two fields that carry
a work item's case identity for assignment-continuity scoring — they need to accept `null`
now, since a future non-annual-return work item's continuity bonus is explicitly deferred (see
Step 5):

```ts
export type ActiveWorkload = {
  threshold: SlaThreshold;
  effortPoints: number;
};

export type StaffCandidate = {
  staffId: string;
  userId: string;
  role: AssignmentRole;
  teamIds: readonly string[];
  active: boolean;
  available: boolean;
  capacityPoints: number;
  skills: readonly StaffSkill[];
  activeWork: readonly ActiveWorkload[];
  caseIds: readonly (string | null)[];
};

export type AssignmentInput = {
  assignmentTarget: "owner" | "reviewer";
  requiredRole: AssignmentRole;
  requiredSkillKey: string;
  teamId: string;
  caseId: string | null;
  ownerId: string | null;
  reviewerId: string | null;
  separationOfDuties: boolean;
  candidates: readonly StaffCandidate[];
};
```

(Only `StaffCandidate.caseIds` and `AssignmentInput.caseId` change type; everything else in
the file is unchanged.)

- [ ] **Step 4: Update `assignment.ts`'s continuity bonus for the nullable case id**

Find the line computing the continuity bonus (`candidate.caseIds.includes(input.caseId) ? 30
: 0`) and guard it so a null case id never produces a false-positive bonus match against
another null:

```ts
  const continuityBonus =
    input.caseId !== null && candidate.caseIds.includes(input.caseId) ? 30 : 0;
```

- [ ] **Step 5: Update `repository.ts`**

`PersistedWorkItem` and `WorkItemRow`:

Add `WorkItemCaseType` to this file's existing import from `./types`:

```ts
import type {
  AssignmentRecommendation,
  AssignmentRole,
  BusinessCalendar,
  SlaThreshold,
  StaffCandidate,
  WorkItemCaseType,
  WorkItemStatus,
} from "./types";
```

```ts
export type PersistedWorkItem = {
  id: string;
  companyId: string;
  caseType: WorkItemCaseType;
  annualReturnCaseId: string | null;
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
  case_type: WorkItemCaseType;
  annual_return_case_id: string | null;
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
```

`EnsureWorkItemEvent`:

```ts
export type EnsureWorkItemEvent = {
  companyId: string;
  caseType: WorkItemCaseType;
  annualReturnCaseId: string;
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
```

(`annualReturnCaseId` stays required here, not optional — the only case type today is
`annual_return`, and its caller always has a real case id. A future case type adds its own
required field the same way, not a shared optional one.)

`mapWorkItem`:

```ts
function mapWorkItem(row: WorkItemRow): PersistedWorkItem {
  return {
    id: row.id,
    companyId: row.company_id,
    caseType: row.case_type,
    annualReturnCaseId: row.annual_return_case_id,
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
```

`recommendationsFor`'s candidate query and construction (replace the `case_id` column with
`annual_return_case_id`, and thread the rename through to `StaffCandidate.caseIds` and the
`thresholdFor` call's synthetic `id`):

```ts
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
  return rankAssignmentCandidates({
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
```

(`id: entry.annual_return_case_id ?? ""` — `thresholdFor`'s input `id` field is just an
opaque label for its own internal bookkeeping, unrelated to `work_items.id`; it was never a
real foreign key, so a placeholder default when null is safe and matches how it was already
being used loosely.)

`ensureWorkItemForEvent`'s INSERT:

```ts
  const inserted = await tx<WorkItemRow[]>`
    insert into work_items (
      company_id, case_type, annual_return_case_id, source_event_key, source_event_type,
      work_type, required_skill_key, title, priority, owner_id, reviewer_id, team_id,
      sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at
    ) values (
      ${event.companyId}, ${event.caseType}, ${event.annualReturnCaseId}, ${event.sourceEventKey},
      ${event.sourceEventType}, ${event.workType}, ${event.requiredSkillKey ?? null},
      ${event.title}, ${event.priority ?? 50}, ${event.ownerId ?? null}, ${event.reviewerId ?? null},
      ${event.teamId ?? null}, ${snapshot.policyVersionId}, ${snapshot.startedAt},
      ${snapshot.warningAt}, ${snapshot.dueAt}
    ) on conflict (source_event_key) do nothing returning *
  `;
```

The three `timeline_events` inserts (in `assign`, `acknowledgeEscalation`, and
`evaluateEscalations`) each currently pass `${item.caseId}` as the `case_id` value — change
each to `${item.annualReturnCaseId}`. `timeline_events.case_id` is nullable, so this compiles
and behaves identically for every existing (annual-return) work item; a future non-
annual-return work item's timeline events simply carry a null `case_id`, which the column
already supports. The `enqueueNotification` payload in `evaluateEscalations` (the `caseId:
item.caseId` field inside the notification's `payload` object) similarly changes to `caseId:
item.annualReturnCaseId` — it's a JSONB field describing the alert email, not a schema
column, so no other change is needed there.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm run test -- src/features/work-items/repository.test.ts src/features/work-items/assignment.test.ts src/features/work-items/sla.test.ts`
Expected: PASS. If `TEST_DATABASE_URL` is set, this also runs the DB-integration test from
Step 1 against a real database — confirm it passes there too (this is the one place the new
CHECK constraints actually get exercised for real).

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: errors remain in every file that still uses the old `caseId`/`case_id` shape
(`annual-return/repository.ts`, `work-queue.tsx`, `annual-returns.tsx`,
`production-command-center.tsx`) — these are fixed in Tasks 3-4. Confirm no NEW errors appear
inside `work-items/` itself.

- [ ] **Step 8: Commit**

```bash
git add src/features/work-items/types.ts src/features/work-items/repository.ts src/features/work-items/assignment.ts src/features/work-items/repository.test.ts
git commit -m "feat: generalize work-items repository layer for a case_type discriminator"
```

---

### Task 3: `annual-return/repository.ts` call sites

**Files:**
- Modify: `src/features/annual-return/repository.ts:490-502` and `:932-943`

- [ ] **Step 1: Update the first call site**

Around line 490 (inside the function that ensures a work item for an existing case's status
change):

```ts
    return ensureWorkItemForEvent(tx, {
      companyId: lockedCase.company_id,
      caseType: "annual_return",
      annualReturnCaseId: lockedCase.id,
      sourceEventKey: event.sourceEventKey,
      sourceEventType: event.sourceEventType,
      workType: "annual_return_case",
      requiredSkillKey: "annual-return",
      title: event.title,
      priority: event.priority,
      ownerId: lockedCase.owner_id,
      reviewerId: lockedCase.reviewer_id,
      teamId: lockedCase.company_team_id,
    });
```

- [ ] **Step 2: Update the second call site**

Around line 932 (inside `createCase`, the P1-1 case-creation flow):

```ts
      await ensureWorkItemForEvent(tx, {
        companyId: input.companyId,
        caseType: "annual_return",
        annualReturnCaseId: newCaseId,
        sourceEventKey: `annual-return:${newCaseId}:created`,
        sourceEventType: "annual_return_case_created",
        workType: "annual_return_case",
        requiredSkillKey: "annual-return",
        title: "Set up new annual return case",
        ownerId: input.ownerId,
        reviewerId: null,
        teamId: company.assigned_team_id,
      });
```

- [ ] **Step 3: Run the annual-return test suite**

Run: `npm run test -- src/features/annual-return/repository.test.ts src/features/annual-return/server-fns.test.ts src/features/annual-return/server-fns.authorization.test.ts`
Expected: PASS — no behavioral change, these two call sites just pass the same case id
through a renamed pair of fields.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: errors remain only in `work-queue.tsx`, `annual-returns.tsx`, and
`production-command-center.tsx` (fixed in Tasks 4-5). Confirm `annual-return/repository.ts`
itself is now clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/repository.ts
git commit -m "feat: pass case_type/annualReturnCaseId through the annual-return work-item calls"
```

---

### Task 4: `work-queue.tsx` consumer update

**Files:**
- Modify: `src/routes/work-queue.tsx`

- [ ] **Step 1: Add the case-detail-link helper**

Add this near the top of the file, after the existing type declarations
(`QueueView`/`SlaFilter`/`PriorityFilter`/`StatusFilter`) and before `export const Route =`:

```ts
type CaseDetailLink = { to: "/annual-returns/$id"; params: { id: string } };

function caseDetailLinkFor(item: PersistedWorkItem): CaseDetailLink | null {
  switch (item.caseType) {
    case "annual_return":
      return item.annualReturnCaseId
        ? { to: "/annual-returns/$id", params: { id: item.annualReturnCaseId } }
        : null;
    default: {
      const exhaustive: never = item.caseType;
      throw new Error(`Unhandled work item case type: ${exhaustive}`);
    }
  }
}
```

(The `default` branch's `never` assignment is a compile-time exhaustiveness check: if
`WorkItemCaseType` ever gains a second member without a matching `case` here, this file fails
to typecheck rather than silently rendering nothing for that case type.)

- [ ] **Step 2: Update the desktop row's Link block**

Replace:

```tsx
                      <Link
                        to="/annual-returns/$id"
                        params={{ id: item.caseId }}
                        className="font-medium hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.workType} · Case {item.caseId.slice(0, 8)}
                      </p>
```

with:

```tsx
                      {caseDetailLinkFor(item) ? (
                        <Link
                          to={caseDetailLinkFor(item)!.to}
                          params={caseDetailLinkFor(item)!.params}
                          className="font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <p className="font-medium">{item.title}</p>
                      )}
                      <p className="truncate text-xs text-muted-foreground">
                        {item.workType}
                        {item.annualReturnCaseId
                          ? ` · Case ${item.annualReturnCaseId.slice(0, 8)}`
                          : ""}
                      </p>
```

- [ ] **Step 3: Update the mobile card's Link block**

Replace the second, structurally identical block:

```tsx
                    <Link
                      to="/annual-returns/$id"
                      params={{ id: item.caseId }}
                      className="font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {item.workType} · Case {item.caseId.slice(0, 8)}
                    </p>
```

with:

```tsx
                    {caseDetailLinkFor(item) ? (
                      <Link
                        to={caseDetailLinkFor(item)!.to}
                        params={caseDetailLinkFor(item)!.params}
                        className="font-medium hover:underline"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <p className="font-medium">{item.title}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {item.workType}
                      {item.annualReturnCaseId
                        ? ` · Case ${item.annualReturnCaseId.slice(0, 8)}`
                        : ""}
                    </p>
```

- [ ] **Step 4: Export the helper and add a focused test**

There is no existing render-level test for `/work-queue` in the repo today (confirmed: no
`src/routes/-work-queue*.test.tsx` and no other file exercises this route's rendered output),
so this is a new, standalone test rather than an extension of something existing. Export
`caseDetailLinkFor` from `work-queue.tsx` (add `export` to its declaration — nothing else in
the file needs exporting) and create `src/routes/-work-queue-case-links.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { caseDetailLinkFor } from "./work-queue";

function makeItem(overrides: Partial<PersistedWorkItem> = {}): PersistedWorkItem {
  return {
    id: "wi-1",
    companyId: "company-1",
    caseType: "annual_return",
    annualReturnCaseId: "case-1",
    sourceEventKey: "event:wi-1",
    sourceEventType: "annual_return_case_created",
    workType: "annual_return_case",
    requiredSkillKey: null,
    title: "Set up new annual return case",
    status: "open",
    escalationState: "none",
    priority: 50,
    ownerId: null,
    reviewerId: null,
    teamId: null,
    slaPolicyVersionId: "policy-1",
    slaStartedAt: "2026-07-01T00:00:00.000Z",
    slaWarningAt: "2026-07-01T01:00:00.000Z",
    slaDueAt: "2026-07-01T03:00:00.000Z",
    slaBreachedAt: null,
    version: 1,
    completedAt: null,
    ...overrides,
  };
}

describe("caseDetailLinkFor", () => {
  it("links an annual_return work item to its case detail route", () => {
    expect(caseDetailLinkFor(makeItem())).toEqual({
      to: "/annual-returns/$id",
      params: { id: "case-1" },
    });
  });

  it("returns null when the work item has no case id yet", () => {
    expect(caseDetailLinkFor(makeItem({ annualReturnCaseId: null }))).toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm run test -- src/routes`
Run: `npm run typecheck`
Expected: PASS, and `work-queue.tsx` no longer appears in the typecheck error list.

- [ ] **Step 6: Commit**

```bash
git add src/routes/work-queue.tsx
git commit -m "feat: route work-queue case links through the case_type discriminator"
```

---

### Task 5: Command-center consumers

**Files:**
- Modify: `src/routes/annual-returns.tsx`
- Modify: `src/features/annual-return/components/production-command-center.tsx`

- [ ] **Step 1: Update the demo command center's map**

In `src/routes/annual-returns.tsx`, the `workItemsByCase` construction:

```ts
  const workItemsByCase = useMemo(() => {
    const map = new Map<string, PersistedWorkItem>();
    for (const item of workItemsQuery.data ?? []) {
      if (!map.has(item.caseId)) map.set(item.caseId, item);
    }
    return map;
  }, [workItemsQuery.data]);
```

becomes:

```ts
  const workItemsByCase = useMemo(() => {
    const map = new Map<string, PersistedWorkItem>();
    for (const item of workItemsQuery.data ?? []) {
      if (item.annualReturnCaseId && !map.has(item.annualReturnCaseId)) {
        map.set(item.annualReturnCaseId, item);
      }
    }
    return map;
  }, [workItemsQuery.data]);
```

- [ ] **Step 2: Update the production command center's map**

Apply the identical change in
`src/features/annual-return/components/production-command-center.tsx`'s `workItemsByCase`
construction (same shape as above).

- [ ] **Step 3: Run the annual-return component tests**

Run: `npm run test -- src/features/annual-return/components src/routes/-annual-returns-data-mode.test.tsx src/routes/-annual-returns-workflow.test.ts`
Expected: PASS — the correlation behaves identically since every work item today has a
non-null `annualReturnCaseId`.

- [ ] **Step 4: Run full typecheck**

Run: `npm run typecheck`
Expected: fully clean now — every consumer has been updated.

- [ ] **Step 5: Commit**

```bash
git add src/routes/annual-returns.tsx src/features/annual-return/components/production-command-center.tsx
git commit -m "feat: key the annual-return command centers' work-item lookup on annualReturnCaseId"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, all suites green, same or higher total test count than before this plan
(baseline before this branch: 108 files / 775 tests, 92 skipped).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS, no errors.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Confirm the DB-integration suite passes against a real database**

If `TEST_DATABASE_URL` is available in this environment, run:

Run: `TEST_DATABASE_URL=$TEST_DATABASE_URL npm run test`

and confirm the `work-item repository integration` suite (previously skipped if unset) now
runs and passes — this is the one test that actually exercises the new CHECK constraints
against Postgres. If `TEST_DATABASE_URL` is not available in this environment, note that
explicitly rather than silently treating the suite's `skipIf` as a pass.

- [ ] **Step 5: Manual smoke test**

Start the dev server in demo mode and confirm:
- `/work-queue` renders with case links intact (each row/card links to
  `/annual-returns/$id` and shows the case id snippet, exactly as before).
- `/annual-returns` (both demo and production command centers, if production data is
  reachable) still correlates work items to cases correctly — SLA/escalation state per case
  row is unchanged.

No commit for this task — it is verification of Tasks 1-5.
