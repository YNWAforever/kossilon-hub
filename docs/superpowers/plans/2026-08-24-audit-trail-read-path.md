# P0-11: Statutory Audit Trail Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a real, scoped read path over `annual_return_audit_events` and `assignment_events` — currently write-only compliance records — via a merged, chronological "Audit history" section on the annual-return case detail screen.

**Architecture:** Two new repository read queries (bounded, joined for actor names), merged by a pure dependency-free function into one sorted feed, exposed through the existing `*ForActor` + `createServerFn` authorization pattern this codebase already uses for every other case sub-resource, and rendered as a new read-only section on the production case detail screen.

**Tech Stack:** TanStack Start server fns, Postgres via `postgres.js` raw SQL, Vitest, `@testing-library/react` with `fireEvent` (no `user-event`/`jest-dom` installed in this codebase).

**Spec:** `docs/superpowers/specs/2026-08-24-audit-trail-read-path-design.md`

---

### Task 1: Pure case-history module (types, merge, and display formatting)

**Files:**
- Create: `src/features/annual-return/case-history.ts`
- Create: `src/features/annual-return/case-history.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/annual-return/case-history.test.ts
import { describe, expect, it } from "vitest";
import {
  describeCaseHistoryEntry,
  mergeCaseHistory,
  type AssignmentEventRow,
  type AuditEventRow,
} from "./case-history";

const baseAuditRow: AuditEventRow = {
  id: "a1000000-0000-0000-0000-000000000001",
  actor_id: "20000000-0000-0000-0000-000000000001",
  actor_name: "Amy Chan",
  actor_role: "Staff",
  action: "add_note",
  result: "succeeded",
  summary: "Note added.",
  metadata: {},
  created_at: "2026-08-01T09:00:00.000Z",
};

const baseAssignmentRow: AssignmentEventRow = {
  id: "b1000000-0000-0000-0000-000000000001",
  work_item_id: "c1000000-0000-0000-0000-000000000001",
  previous_assignee_id: "20000000-0000-0000-0000-000000000001",
  previous_assignee_name: "Amy Chan",
  assigned_to_id: "20000000-0000-0000-0000-000000000002",
  assigned_to_name: "Ken Wong",
  assigned_by_id: "20000000-0000-0000-0000-000000000003",
  assigned_by_name: "Mei Lam",
  decision: "manual",
  override_reason: null,
  recommendation_rank: null,
  recommendation_score: null,
  recommendation_factors: {},
  created_at: "2026-08-02T09:00:00.000Z",
};

describe("mergeCaseHistory", () => {
  it("sorts audit and assignment entries together, newest first", () => {
    const older = { ...baseAuditRow, created_at: "2026-08-01T09:00:00.000Z" };
    const newer = { ...baseAssignmentRow, created_at: "2026-08-02T09:00:00.000Z" };

    const merged = mergeCaseHistory([older], [newer]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ kind: "assignment", id: newer.id });
    expect(merged[1]).toMatchObject({ kind: "audit", id: older.id });
  });

  it("maps an audit row to a fully-shaped audit entry", () => {
    const [entry] = mergeCaseHistory([baseAuditRow], []);

    expect(entry).toEqual({
      kind: "audit",
      id: baseAuditRow.id,
      createdAt: "2026-08-01T09:00:00.000Z",
      actorId: baseAuditRow.actor_id,
      actorName: baseAuditRow.actor_name,
      actorRole: baseAuditRow.actor_role,
      action: baseAuditRow.action,
      result: baseAuditRow.result,
      summary: baseAuditRow.summary,
      metadata: baseAuditRow.metadata,
    });
  });

  it("maps an assignment row to a fully-shaped assignment entry", () => {
    const [entry] = mergeCaseHistory([], [baseAssignmentRow]);

    expect(entry).toEqual({
      kind: "assignment",
      id: baseAssignmentRow.id,
      createdAt: "2026-08-02T09:00:00.000Z",
      workItemId: baseAssignmentRow.work_item_id,
      previousAssigneeId: baseAssignmentRow.previous_assignee_id,
      previousAssigneeName: baseAssignmentRow.previous_assignee_name,
      assignedToId: baseAssignmentRow.assigned_to_id,
      assignedToName: baseAssignmentRow.assigned_to_name,
      assignedById: baseAssignmentRow.assigned_by_id,
      assignedByName: baseAssignmentRow.assigned_by_name,
      decision: baseAssignmentRow.decision,
      overrideReason: baseAssignmentRow.override_reason,
      recommendationRank: baseAssignmentRow.recommendation_rank,
      recommendationScore: baseAssignmentRow.recommendation_score,
      recommendationFactors: baseAssignmentRow.recommendation_factors,
    });
  });

  it("accepts a Date object for created_at", () => {
    const [entry] = mergeCaseHistory(
      [{ ...baseAuditRow, created_at: new Date("2026-08-01T09:00:00.000Z") }],
      [],
    );

    expect(entry.createdAt).toBe("2026-08-01T09:00:00.000Z");
  });
});

describe("describeCaseHistoryEntry", () => {
  const auditActionLabels: Record<AuditEventRow["action"], string> = {
    create_case: "Case created",
    assign_owner: "Owner reassigned",
    add_note: "Note added",
    record_reminder: "Reminder recorded",
    update_checklist: "Checklist updated",
    update_payment: "Payment updated",
    update_filing_proof: "Filing proof updated",
    change_status: "Status changed",
    complete: "Case completed",
  };

  it.each(Object.entries(auditActionLabels))("labels audit action %s as %s", (action, label) => {
    const [entry] = mergeCaseHistory([{ ...baseAuditRow, action: action as AuditEventRow["action"] }], []);

    expect(describeCaseHistoryEntry(entry).label).toBe(label);
  });

  it("labels an audit entry's description as its stored summary", () => {
    const [entry] = mergeCaseHistory([baseAuditRow], []);

    expect(describeCaseHistoryEntry(entry).description).toBe("Note added.");
  });

  it("labels a manual assignment and describes the reassignment", () => {
    const [entry] = mergeCaseHistory([], [baseAssignmentRow]);

    const { label, description } = describeCaseHistoryEntry(entry);
    expect(label).toBe("Assignment: manual");
    expect(description).toBe("Amy Chan → Ken Wong");
  });

  it("labels an overridden assignment and includes the override reason", () => {
    const [entry] = mergeCaseHistory(
      [],
      [{ ...baseAssignmentRow, decision: "override", override_reason: "Amy is on leave." }],
    );

    const { label, description } = describeCaseHistoryEntry(entry);
    expect(label).toBe("Assignment: overridden");
    expect(description).toBe("Amy Chan → Ken Wong (Amy is on leave.)");
  });

  it("labels an accepted-recommendation assignment", () => {
    const [entry] = mergeCaseHistory([], [{ ...baseAssignmentRow, decision: "accepted_recommendation" }]);

    expect(describeCaseHistoryEntry(entry).label).toBe("Assignment: accepted recommendation");
  });

  it("describes an assignment with no previous assignee as Unassigned", () => {
    const [entry] = mergeCaseHistory(
      [],
      [{ ...baseAssignmentRow, previous_assignee_id: null, previous_assignee_name: null }],
    );

    expect(describeCaseHistoryEntry(entry).description).toBe("Unassigned → Ken Wong");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/annual-return/case-history.test.ts`
Expected: FAIL with "Cannot find module './case-history'" (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/features/annual-return/case-history.ts
import type { AnnualReturnAction, AnnualReturnActorRole } from "./permissions";

export type AuditEventRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: AnnualReturnActorRole;
  action: AnnualReturnAction;
  result: "succeeded" | "denied" | "failed";
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string | Date;
};

export type AssignmentEventRow = {
  id: string;
  work_item_id: string;
  previous_assignee_id: string | null;
  previous_assignee_name: string | null;
  assigned_to_id: string;
  assigned_to_name: string;
  assigned_by_id: string;
  assigned_by_name: string;
  decision: "accepted_recommendation" | "override" | "manual";
  override_reason: string | null;
  recommendation_rank: number | null;
  recommendation_score: number | null;
  recommendation_factors: Record<string, unknown>;
  created_at: string | Date;
};

export type CaseHistoryEntry =
  | {
      kind: "audit";
      id: string;
      createdAt: string;
      actorId: string | null;
      actorName: string | null;
      actorRole: AnnualReturnActorRole;
      action: AnnualReturnAction;
      result: "succeeded" | "denied" | "failed";
      summary: string;
      metadata: Record<string, unknown>;
    }
  | {
      kind: "assignment";
      id: string;
      createdAt: string;
      workItemId: string;
      previousAssigneeId: string | null;
      previousAssigneeName: string | null;
      assignedToId: string;
      assignedToName: string;
      assignedById: string;
      assignedByName: string;
      decision: "accepted_recommendation" | "override" | "manual";
      overrideReason: string | null;
      recommendationRank: number | null;
      recommendationScore: number | null;
      recommendationFactors: Record<string, unknown>;
    };

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function mergeCaseHistory(
  auditEvents: AuditEventRow[],
  assignmentEvents: AssignmentEventRow[],
): CaseHistoryEntry[] {
  const auditEntries: CaseHistoryEntry[] = auditEvents.map((row) => ({
    kind: "audit",
    id: row.id,
    createdAt: toIsoString(row.created_at),
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    action: row.action,
    result: row.result,
    summary: row.summary,
    metadata: row.metadata,
  }));

  const assignmentEntries: CaseHistoryEntry[] = assignmentEvents.map((row) => ({
    kind: "assignment",
    id: row.id,
    createdAt: toIsoString(row.created_at),
    workItemId: row.work_item_id,
    previousAssigneeId: row.previous_assignee_id,
    previousAssigneeName: row.previous_assignee_name,
    assignedToId: row.assigned_to_id,
    assignedToName: row.assigned_to_name,
    assignedById: row.assigned_by_id,
    assignedByName: row.assigned_by_name,
    decision: row.decision,
    overrideReason: row.override_reason,
    recommendationRank: row.recommendation_rank,
    recommendationScore: row.recommendation_score,
    recommendationFactors: row.recommendation_factors,
  }));

  return [...auditEntries, ...assignmentEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

const AUDIT_ACTION_LABELS: Record<AnnualReturnAction, string> = {
  create_case: "Case created",
  assign_owner: "Owner reassigned",
  add_note: "Note added",
  record_reminder: "Reminder recorded",
  update_checklist: "Checklist updated",
  update_payment: "Payment updated",
  update_filing_proof: "Filing proof updated",
  change_status: "Status changed",
  complete: "Case completed",
};

const ASSIGNMENT_DECISION_LABELS: Record<AssignmentEventRow["decision"], string> = {
  accepted_recommendation: "Assignment: accepted recommendation",
  override: "Assignment: overridden",
  manual: "Assignment: manual",
};

export function describeCaseHistoryEntry(entry: CaseHistoryEntry): {
  label: string;
  description: string;
} {
  if (entry.kind === "audit") {
    return { label: AUDIT_ACTION_LABELS[entry.action], description: entry.summary };
  }

  const from = entry.previousAssigneeName ?? "Unassigned";
  const base = `${from} → ${entry.assignedToName}`;
  const description =
    entry.decision === "override" && entry.overrideReason
      ? `${base} (${entry.overrideReason})`
      : base;

  return { label: ASSIGNMENT_DECISION_LABELS[entry.decision], description };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/annual-return/case-history.test.ts`
Expected: PASS (17 tests: 4 in `mergeCaseHistory`, 13 in `describeCaseHistoryEntry` — 9 from `it.each` over the audit action table plus 4 standalone).

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/case-history.ts src/features/annual-return/case-history.test.ts
git commit -m "feat: add pure case-history merge and formatting for audit trail"
```

---

### Task 2: Repository read functions for audit and assignment events

**Files:**
- Modify: `src/features/annual-return/repository.ts`

- [ ] **Step 1: Add the type import**

In `src/features/annual-return/repository.ts`, insert this import immediately after the existing `evidence-file-types` import block (after line 31, `} from "./evidence-file-types";`, before line 32's `import type { AnnualReturnCase, ...`):

```ts
import type { AuditEventRow, AssignmentEventRow } from "./case-history";
```

- [ ] **Step 2: Add the two query functions**

Insert immediately after the closing brace of `listNotes` (repository.ts:1247, the line reading `}` right before `async function addNote`):

```ts
  async function listAuditEventsForCase(caseId: string): Promise<AuditEventRow[]> {
    return sql<AuditEventRow[]>`
      select
        e.id, e.actor_id, u.name as actor_name, e.actor_role,
        e.action, e.result, e.summary, e.metadata, e.created_at
      from annual_return_audit_events e
      left join users u on u.id = e.actor_id
      where e.case_id = ${caseId}
      order by e.created_at desc
      limit 200
    `;
  }

  async function listAssignmentEventsForCase(caseId: string): Promise<AssignmentEventRow[]> {
    return sql<AssignmentEventRow[]>`
      select
        a.id, a.work_item_id,
        a.previous_assignee_id, pu.name as previous_assignee_name,
        a.assigned_to_id, tu.name as assigned_to_name,
        a.assigned_by_id, bu.name as assigned_by_name,
        a.decision, a.override_reason, a.recommendation_rank, a.recommendation_score,
        a.recommendation_factors, a.created_at
      from assignment_events a
      join work_items w on w.id = a.work_item_id
      left join users pu on pu.id = a.previous_assignee_id
      join users tu on tu.id = a.assigned_to_id
      join users bu on bu.id = a.assigned_by_id
      where w.annual_return_case_id = ${caseId}
      order by a.created_at desc
      limit 200
    `;
  }

```

- [ ] **Step 3: Add both functions to the `AnnualReturnRepository` type**

In the same file, add these two lines to the `AnnualReturnRepository` type immediately after `listNotes(caseId: string): Promise<AnnualReturnCaseNote[]>;` (repository.ts:257):

```ts
  listAuditEventsForCase(caseId: string): Promise<AuditEventRow[]>;
  listAssignmentEventsForCase(caseId: string): Promise<AssignmentEventRow[]>;
```

- [ ] **Step 4: Add both functions to the returned repository object**

In the same file, add these two lines to the object returned by `createAnnualReturnRepository` immediately after `listNotes,` (repository.ts:2026):

```ts
    listAuditEventsForCase,
    listAssignmentEventsForCase,
```

- [ ] **Step 5: Extend the existing "exposes ... commands" configuration test**

In `src/features/annual-return/repository.test.ts`, find the test `"exposes owner assignment and case note commands"` (around line 480) and add two assertions after the existing three:

```ts
    expect(repository.listAuditEventsForCase).toBeTypeOf("function");
    expect(repository.listAssignmentEventsForCase).toBeTypeOf("function");
```

- [ ] **Step 6: Run typecheck and the extended test**

Run: `npm run typecheck`
Expected: PASS, no type errors.

Run: `npx vitest run src/features/annual-return/repository.test.ts -t "exposes owner assignment"`
Expected: PASS (this specific test requires no database).

- [ ] **Step 7: Commit**

```bash
git add src/features/annual-return/repository.ts src/features/annual-return/repository.test.ts
git commit -m "feat: add repository reads for annual_return_audit_events and assignment_events"
```

---

### Task 3: Repository integration tests against a real database

This task requires a real Postgres instance. Follow the pattern established throughout this codebase's history: run a local Docker Postgres, migrate and seed it, and run the DB-integration suite against it — do not rely on typecheck/build alone, since `describe.skipIf(!databaseUrl)` silently skips these tests when `TEST_DATABASE_URL` is unset.

**Files:**
- Modify: `src/features/annual-return/repository.test.ts`

- [ ] **Step 1: Start a local Postgres and set `TEST_DATABASE_URL`**

```bash
docker run -d --name kossilon-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kossilon_test -p 5432:5432 postgres:17-alpine
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test DATABASE_SSL=false bun scripts/db-migrate.ts
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test DATABASE_SSL=false bun scripts/db-seed-annual-return.ts
```

- [ ] **Step 2: Write the failing test**

Add this test inside the existing `describe.skipIf(!databaseUrl)("annual return repository", ...)` block in `src/features/annual-return/repository.test.ts` (the block starting at line 508), anywhere after the existing owner-assignment test:

```ts
  it(
    "reads merged audit and assignment history for a case",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 23 });
      const repository = repositoryFor("2026-07-05");

      await repository.addNote({
        caseId: fixture.caseId,
        body: "Checked with the client.",
        actorId: USER_AMY_ID,
      });
      await repository.assignOwner({
        caseId: fixture.caseId,
        ownerId: USER_MEI_ID,
        actorId: USER_KEN_ID,
      });

      const auditEvents = await repository.listAuditEventsForCase(fixture.caseId);
      const assignmentEvents = await repository.listAssignmentEventsForCase(fixture.caseId);

      expect(auditEvents.length).toBeGreaterThanOrEqual(1);
      expect(auditEvents.some((row) => row.action === "add_note")).toBe(true);
      expect(auditEvents.some((row) => row.action === "assign_owner")).toBe(true);
      expect(auditEvents.every((row) => typeof row.actor_name === "string")).toBe(true);

      expect(assignmentEvents.length).toBeGreaterThanOrEqual(1);
      expect(assignmentEvents[0]).toMatchObject({
        assigned_to_id: USER_MEI_ID,
        assigned_by_id: USER_KEN_ID,
        assigned_to_name: expect.any(String),
        assigned_by_name: expect.any(String),
        decision: "manual",
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test npx vitest run src/features/annual-return/repository.test.ts -t "reads merged audit and assignment history"`
Expected: FAIL — `repository.listAuditEventsForCase is not a function` if Task 2 wasn't yet run in this environment, or the test should already PASS if Task 2's implementation is already in place (Task 2 is a prerequisite for this task; if both are implemented in sequence this test passes immediately — in that case skip to Step 4's full-suite run to prove there's no regression instead of expecting a contrived failure).

- [ ] **Step 4: Run the full annual-return suite against the real database twice**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test npx vitest run src/features/annual-return/repository.test.ts`
Expected: PASS, run it a second time to confirm no fixture-cleanup leakage between runs.

- [ ] **Step 5: Tear down the container**

```bash
docker rm -f kossilon-test-pg
```

- [ ] **Step 6: Commit**

```bash
git add src/features/annual-return/repository.test.ts
git commit -m "test: verify audit and assignment history reads against a real database"
```

---

### Task 4: Domain function and authorization tests

**Files:**
- Modify: `src/features/annual-return/server-fns.ts`
- Modify: `src/features/annual-return/server-fns.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this to `src/features/annual-return/server-fns.test.ts`, inside the existing `describe("annual return case command authorization", ...)` block (or as a new adjacent `describe` block in the same file — either is fine, follow whichever reads more naturally next to the existing tests):

```ts
import { listAnnualReturnCaseHistoryForActor } from "./server-fns";
import type { CaseHistoryEntry } from "./case-history";

// ...inside a describe block, alongside the existing tests:

const managerActor: AuthenticatedActor = {
  authUserId: "manager-auth",
  userId: "20000000-0000-0000-0000-000000000009",
  role: "Manager",
  teamId: "10000000-0000-0000-0000-000000000099",
  active: true,
};

const visibleCase = {
  id: caseId,
  companyName: "Acme Company Limited",
  companyTeamId: staffActor.teamId!,
  ownerId: staffActor.userId!,
  reviewerId: null,
};

it("rejects a history read for a case outside the actor's scope", async () => {
  const getCase = vi.fn(async () => ({ ...visibleCase, companyTeamId: managerActor.teamId! }));
  const listAuditEventsForCase = vi.fn();
  const listAssignmentEventsForCase = vi.fn();
  const dependencies = {
    repository: {
      getCase,
      listAuditEventsForCase,
      listAssignmentEventsForCase,
    } as unknown as AnnualReturnRepository,
  };

  await expect(
    listAnnualReturnCaseHistoryForActor(staffActor, { caseId }, dependencies),
  ).rejects.toThrow(/outside your scope/i);
  expect(listAuditEventsForCase).not.toHaveBeenCalled();
  expect(listAssignmentEventsForCase).not.toHaveBeenCalled();
});

it("throws when the case does not exist", async () => {
  const getCase = vi.fn(async () => null);
  const dependencies = {
    repository: {
      getCase,
      listAuditEventsForCase: vi.fn(),
      listAssignmentEventsForCase: vi.fn(),
    } as unknown as AnnualReturnRepository,
  };

  await expect(
    listAnnualReturnCaseHistoryForActor(staffActor, { caseId }, dependencies),
  ).rejects.toThrow(/not found/i);
});

it("returns the merged history for a visible case", async () => {
  const getCase = vi.fn(async () => visibleCase);
  const listAuditEventsForCase = vi.fn(async () => [
    {
      id: "a1000000-0000-0000-0000-000000000001",
      actor_id: staffActor.userId,
      actor_name: "Amy Chan",
      actor_role: "Staff" as const,
      action: "add_note" as const,
      result: "succeeded" as const,
      summary: "Note added.",
      metadata: {},
      created_at: "2026-08-01T09:00:00.000Z",
    },
  ]);
  const listAssignmentEventsForCase = vi.fn(async () => []);
  const dependencies = {
    repository: {
      getCase,
      listAuditEventsForCase,
      listAssignmentEventsForCase,
    } as unknown as AnnualReturnRepository,
  };

  const history: CaseHistoryEntry[] = await listAnnualReturnCaseHistoryForActor(
    staffActor,
    { caseId },
    dependencies,
  );

  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ kind: "audit", action: "add_note" });
  expect(listAuditEventsForCase).toHaveBeenCalledWith(caseId);
  expect(listAssignmentEventsForCase).toHaveBeenCalledWith(caseId);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/annual-return/server-fns.test.ts -t "history"`
Expected: FAIL with "listAnnualReturnCaseHistoryForActor is not a function" (doesn't exist yet).

- [ ] **Step 3: Implement the domain function**

In `src/features/annual-return/server-fns.ts`, insert immediately after `listAnnualReturnCaseNotesForActor` (ends at line 238, right before `export async function assignAnnualReturnCaseOwnerForActor` at line 240):

```ts
export async function listAnnualReturnCaseHistoryForActor(
  actor: AuthenticatedActor,
  input: { caseId: string },
  dependencies: {
    repository: Pick<
      AnnualReturnRepository,
      "getCase" | "listAuditEventsForCase" | "listAssignmentEventsForCase"
    >;
  },
): Promise<CaseHistoryEntry[]> {
  const case_ = await dependencies.repository.getCase(input.caseId);

  if (!case_) {
    throw new Error("Annual return case not found.");
  }

  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);

  const [auditEvents, assignmentEvents] = await Promise.all([
    dependencies.repository.listAuditEventsForCase(input.caseId),
    dependencies.repository.listAssignmentEventsForCase(input.caseId),
  ]);

  return mergeCaseHistory(auditEvents, assignmentEvents);
}
```

Add the required import at the top of `server-fns.ts`, alongside the existing `import { assertAnnualReturnCaseVisible, ... } from "./permissions";` block (around line 6-9):

```ts
import { mergeCaseHistory, type CaseHistoryEntry } from "./case-history";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/annual-return/server-fns.test.ts`
Expected: PASS, all tests in the file including the 3 new ones.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/annual-return/server-fns.ts src/features/annual-return/server-fns.test.ts
git commit -m "feat: add listAnnualReturnCaseHistoryForActor with scoped visibility"
```

---

### Task 5: Server function wrapper and query key

**Files:**
- Modify: `src/features/annual-return/server-fns.ts`
- Modify: `src/features/annual-return/query-keys.ts`

- [ ] **Step 1: Add the query key**

In `src/features/annual-return/query-keys.ts`, add this line immediately after the `notes:` entry:

```ts
  history: (caseId: string) => ["annual-returns", "history", caseId] as const,
```

- [ ] **Step 2: Add the server fn**

In `src/features/annual-return/server-fns.ts`, insert immediately after the `listAnnualReturnCaseNotes` server fn (ends at line 497, right before `export const addAnnualReturnCaseNote` at line 499):

```ts
export const listAnnualReturnCaseHistory = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCaseHistoryForActor(actor, data, { repository }),
    ),
  );
```

- [ ] **Step 3: Run typecheck and the full annual-return test file**

Run: `npm run typecheck`
Expected: PASS.

Run: `npx vitest run src/features/annual-return/server-fns.test.ts`
Expected: PASS (no behavior change to existing tests; this step only adds a new exported server fn).

- [ ] **Step 4: Commit**

```bash
git add src/features/annual-return/server-fns.ts src/features/annual-return/query-keys.ts
git commit -m "feat: add listAnnualReturnCaseHistory server function"
```

---

### Task 6: Audit history UI section

**Files:**
- Modify: `src/features/annual-return/components/production-case-detail.tsx`
- Modify: `src/features/annual-return/components/production-case-detail.interaction.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/features/annual-return/components/production-case-detail.interaction.test.tsx`, add `listAnnualReturnCaseHistory: vi.fn()` to the `serverFns` hoisted mock object (alongside `listAnnualReturnCaseNotes` at line 13), add a default `serverFns.listAnnualReturnCaseHistory.mockResolvedValue([]);` to the `beforeEach` block (alongside line 106), and add this new test inside `describe("ProductionAnnualReturnCaseDetail", ...)`:

```ts
  it("renders merged audit history entries newest first", async () => {
    serverFns.listAnnualReturnCaseHistory.mockResolvedValue([
      {
        kind: "audit",
        id: "a1000000-0000-0000-0000-000000000001",
        createdAt: "2026-08-01T09:00:00.000Z",
        actorId: ownerId,
        actorName: "Ada Chan",
        actorRole: "Staff",
        action: "add_note",
        result: "succeeded",
        summary: "Checked with the client.",
        metadata: {},
      },
      {
        kind: "assignment",
        id: "b1000000-0000-0000-0000-000000000001",
        createdAt: "2026-08-02T09:00:00.000Z",
        workItemId: "c1000000-0000-0000-0000-000000000001",
        previousAssigneeId: ownerId,
        previousAssigneeName: "Ada Chan",
        assignedToId: nextOwnerId,
        assignedToName: "Ken Wong",
        assignedById: ownerId,
        assignedByName: "Ada Chan",
        decision: "manual",
        overrideReason: null,
        recommendationRank: null,
        recommendationScore: null,
        recommendationFactors: {},
      },
    ]);

    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    const historySection = await screen.findByText("Audit history");
    const [firstEntry, secondEntry] = screen.getAllByRole("listitem");
    expect(historySection).toBeTruthy();
    expect(firstEntry.textContent).toContain("Assignment: manual");
    expect(secondEntry.textContent).toContain("Note added");
  });

  it("shows an empty state when no history exists", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    expect(await screen.findByText("No history yet.")).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/annual-return/components/production-case-detail.interaction.test.tsx -t "audit history"`
Expected: FAIL — "Audit history" text not found (the section doesn't exist in the component yet).

- [ ] **Step 3: Implement the UI section**

In `src/features/annual-return/components/production-case-detail.tsx`, update the import at line 17:

```ts
import { getAnnualReturnCase, listAnnualReturnCaseHistory, listAnnualReturnCaseNotes } from "../server-fns";
```

Add this import near the top of the file, alongside the other local imports (e.g. after the `annualReturnQueryKeys` import at line 15):

```ts
import { describeCaseHistoryEntry } from "../case-history";
```

Add a new query hook immediately after the `notesQuery` declaration (after line 86):

```ts
  const historyQuery = useQuery({
    queryKey: annualReturnQueryKeys.history(caseId),
    queryFn: () => listAnnualReturnCaseHistory({ data: { caseId } }),
  });
```

Insert a new `<section>` between the closing `</section>` of Notes (line 477) and the opening `<section>` of WhatsApp reminder (line 479):

```tsx
          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">Audit history</h2>
            <ul className="mt-3 space-y-3">
              {historyQuery.isPending ? (
                <li className="text-sm text-muted-foreground">Loading history</li>
              ) : historyQuery.isError ? (
                <li role="alert" className="text-sm text-destructive">
                  {historyQuery.error.message}
                </li>
              ) : historyQuery.data.length === 0 ? (
                <li className="text-sm text-muted-foreground">No history yet.</li>
              ) : (
                historyQuery.data.map((entry) => {
                  const { label, description } = describeCaseHistoryEntry(entry);
                  const actorName = entry.kind === "audit" ? (entry.actorName ?? "System") : entry.assignedByName;
                  return (
                    <li key={entry.id} className="border-l-2 pl-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString("en-HK")}
                        </p>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">by {actorName}</p>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/annual-return/components/production-case-detail.interaction.test.tsx`
Expected: PASS, all tests in the file including the 2 new ones.

- [ ] **Step 5: Run typecheck, build, and lint**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

Run: `npm run lint`
Expected: PASS (no new errors or warnings; the codebase's one pre-existing unrelated warning in `work-queue.tsx` is expected and not caused by this change).

- [ ] **Step 6: Commit**

```bash
git add src/features/annual-return/components/production-case-detail.tsx src/features/annual-return/components/production-case-detail.interaction.test.tsx
git commit -m "feat: render merged audit history on the annual return case detail screen"
```

---

### Task 7: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the full local test suite**

Run: `npm run test`
Expected: All tests pass; the new DB-integration test from Task 3 is skipped locally (no `TEST_DATABASE_URL`), consistent with every other DB-integration test in this codebase.

- [ ] **Step 2: Run typecheck, build, and lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: All clean (the one pre-existing unrelated `work-queue.tsx` lint warning is expected).

- [ ] **Step 3: Run `verify:firm` in dry-run mode**

Run: `npm run verify:firm -- --dry-run`
Expected: PASS.

- [ ] **Step 4: Run the full suite against a real database one more time**

Start a fresh local Postgres, migrate, seed (same commands as Task 3, Step 1), then:

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test npm run test`
Expected: All tests pass, including the new audit/assignment history integration test from Task 3, with zero `TEST_DATABASE_URL`-gated skips.

Tear the container down afterward: `docker rm -f kossilon-test-pg`

- [ ] **Step 5: Manual review — confirm demo mode is unaffected**

Read `src/features/annual-return/components/demo-case-detail.tsx` and confirm its existing "Timeline" panel is untouched (this plan does not modify any demo-mode file). Grep the diff for any accidental edit under `src/lib/*-store.ts` or `demo-case-detail.tsx` — there should be none.

- [ ] **Step 6: Push, open a PR, and confirm CI is green**

This step requires the user's explicit go-ahead before pushing or opening a PR (per this project's standing practice). Once approved:

```bash
git push -u origin codex/audit-trail-read-path
gh pr create --title "feat: P0-11 statutory audit trail read path" --body "See docs/superpowers/specs/2026-08-24-audit-trail-read-path-design.md"
```

Then confirm CI's `verify` job specifically reports `SUCCESS` via `gh pr view <n> --json statusCheckRollup` — not just that the PR merged — per the standing discipline from the PR #46 near-miss, before treating this item as done.
