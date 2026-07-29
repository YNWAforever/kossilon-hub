# Production Annual Return Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/annual-returns` a production implementation that reads real cases from Postgres, scoped to the acting staff member, so the flagship screen stops rendering demo fixtures in production.

**Architecture:** A second component behind a route-level `dataMode` branch, matching the four routes that already branch this way. The demo board stays inline in `src/routes/annual-returns.tsx`; the production board lives in `src/features/annual-return/components/production-command-center.tsx`. Pure derivations move out of server-only modules into `workflow.ts` and `permissions.ts` so the board and its tests need no database.

**Tech Stack:** TanStack Start 1.x + TanStack Router (file routing) + TanStack Query 5, React 19, TypeScript 5.8 strict, Tailwind v4, Zod 3, postgres.js (raw tagged-template SQL), Vitest 4 (jsdom via per-file pragma).

**Spec:** `docs/superpowers/specs/2026-07-30-production-annual-return-command-center-design.md`

---

## Orientation For Someone New To This Repo

Read this before Task 1. It will save you an hour.

**Two modes.** Every screen exists twice. `dataMode` comes from router context (`src/router.tsx:12`) and is read in a component as `const { dataMode } = Route.useRouteContext()`. Compare against `"demo"`, never against `"production"` — production is the fallthrough. `src/routes/-production-authorization.test.ts:26` enforces this.

**Demo mode is read-only.** `src/lib/*-store.ts` export derivations and hooks but no mutations. See `docs/adr/0001-demo-mode-is-read-only.md`.

**Two `AnnualReturnCase` types exist and they are different.** `src/lib/annual-return-store.ts` (demo) and `src/features/annual-return/types.ts` (production). Everything in this plan uses the production one. Never import the demo store into a production file.

**Tests run without a database.** 468 of 500. The other 32 are behind `describe.skipIf(!databaseUrl)`. Keep it that way: pure logic goes in modules with no database imports.

**`@testing-library/jest-dom` is NOT installed.** There is no setup file and no `expect.extend`. These throw "is not a function": `toBeInTheDocument`, `toBeDisabled`, `toHaveTextContent`, `toHaveValue`, `toHaveAttribute`, `toHaveClass`. Use instead:

| Need        | Write                                                            |
| ----------- | ---------------------------------------------------------------- |
| Presence    | `expect(screen.getByRole("button", { name: "X" })).toBeTruthy()` |
| Absence     | `expect(screen.queryByText("X")).toBeNull()`                     |
| Disabled    | `expect((el as HTMLButtonElement).disabled).toBe(true)`          |
| Text        | `expect(el.textContent).toContain("X")`                          |
| Input value | `expect((el as HTMLInputElement).value).toBe("X")`               |

**`// @vitest-environment jsdom` must be line 1** of any test that renders. There is no global environment.

**No Radix `Select` in the new board.** There are no `ResizeObserver`, `matchMedia` or `hasPointerCapture` polyfills anywhere in this repo, so `fireEvent` cannot drive Radix. Use native `<select>`, as `production-case-detail.tsx:245` does.

**Commands:**

```bash
npx vitest run path/to/file.test.ts
```

```bash
npm run typecheck && npm run lint && npm run test
```

**Never force-push or rebase pushed commits** (`AGENTS.md`).

---

## File Structure

**Created**

| File                                                                                   | Responsibility                                                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/features/annual-return/board-metrics.ts`                                          | Pure tile counts over `AnnualReturnCase[]`. No imports beyond `./types` and `./workflow`. |
| `src/features/annual-return/board-metrics.test.ts`                                     | Tile tests. No DOM, no database.                                                          |
| `src/features/annual-return/components/production-command-center.tsx`                  | The production board.                                                                     |
| `src/features/annual-return/components/production-command-center.interaction.test.tsx` | jsdom render tests with faked server functions.                                           |
| `src/routes/-annual-returns-data-mode.test.tsx`                                        | Router tests at both `dataMode` values. The gap that let the `<Outlet />` break through.  |

**Modified**

| File                                             | Change                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/features/annual-return/workflow.ts`         | Gains `hongKongBusinessDate`; exports `hasRequiredChecklistEvidence`.                                                  |
| `src/features/annual-return/repository.ts`       | Imports the moved date helper; adds `visibleToUserId` and `limit` to `CaseFilters` and the SQL.                        |
| `src/features/annual-return/permissions.ts`      | Gains `caseFiltersForActor`.                                                                                           |
| `src/features/annual-return/permissions.test.ts` | Tests for it.                                                                                                          |
| `src/features/annual-return/server-fns.ts`       | Scopes `listAnnualReturnCases`; adds `limit` to its schema.                                                            |
| `src/routes/annual-returns.tsx`                  | Route component becomes guard + branch; existing body becomes `DemoAnnualReturnCommandCenter`; gains `validateSearch`. |
| `src/routes/payments.tsx`                        | Invalidate `.all`; stop rendering empty and error together.                                                            |
| `src/routes/-production-authorization.test.ts`   | Add the new board to the banned-demo-import list.                                                                      |
| `src/features/annual-return/workflow.test.ts`    | Tests for the moved and newly exported functions.                                                                      |

---

## Task 1: Move `hongKongBusinessDate` into `workflow.ts`

The board's "due in 7 / 30" tiles need the same calendar day the server used to derive `riskLevel`. The function is pure (`Intl` only) but stranded in `repository.ts`, which imports the database client and so cannot be imported from a browser component.

**Files:**

- Modify: `src/features/annual-return/workflow.ts`
- Modify: `src/features/annual-return/repository.ts:195-218`
- Test: `src/features/annual-return/workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/annual-return/workflow.test.ts`:

```ts
describe("hongKongBusinessDate", () => {
  it("returns the Hong Kong calendar date regardless of the caller's timezone", () => {
    // 2026-07-30T17:30:00Z is 2026-07-31 01:30 in Hong Kong (UTC+8).
    expect(hongKongBusinessDate(new Date("2026-07-30T17:30:00.000Z"))).toBe("2026-07-31");
  });

  it("does not roll over before Hong Kong midnight", () => {
    // 2026-07-30T15:59:00Z is 2026-07-30 23:59 in Hong Kong.
    expect(hongKongBusinessDate(new Date("2026-07-30T15:59:00.000Z"))).toBe("2026-07-30");
  });

  it("zero-pads single-digit months and days", () => {
    expect(hongKongBusinessDate(new Date("2026-01-05T04:00:00.000Z"))).toBe("2026-01-05");
  });
});
```

Add `hongKongBusinessDate` to the existing import from `./workflow` at the top of that file.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/features/annual-return/workflow.test.ts
```

Expected: FAIL — `hongKongBusinessDate is not a function` (it is not exported from `workflow.ts` yet).

- [ ] **Step 3: Move the function**

In `src/features/annual-return/workflow.ts`, add after the existing `formatDateOnly` helper:

```ts
const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

/**
 * The firm's operational "today". Lives here rather than in the repository so the
 * board can derive deadline tiles against the same calendar day the server used to
 * compute `riskLevel` — a browser-local date drifts for anyone outside HKT.
 */
export function hongKongBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}
```

In `src/features/annual-return/repository.ts`, delete the `datePart` function and the `hongKongBusinessDate` function (lines 199-218) and delete the `HONG_KONG_TIME_ZONE` constant. Then change the existing `./workflow` import on line 9 from:

```ts
import { daysBetween, isAllowedStatusTransition, riskForCase } from "./workflow";
```

to:

```ts
import {
  daysBetween,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  riskForCase,
} from "./workflow";

// Re-exported so existing importers (server-fns.ts) keep working unchanged.
export { hongKongBusinessDate };
```

- [ ] **Step 4: Run the full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean; all tests pass. `hongKongBusinessDate` has callers in `server-fns.ts` and `repository.ts` — the re-export keeps them working. If typecheck reports an unused `HONG_KONG_TIME_ZONE`, you missed deleting it.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/workflow.ts src/features/annual-return/repository.ts src/features/annual-return/workflow.test.ts
git commit -m "refactor(annual-return): move hongKongBusinessDate to the client-safe workflow module"
```

---

## Task 2: Export `hasRequiredChecklistEvidence`

The "missing documents" tile needs this predicate. It is private in `workflow.ts`. The repository's near-twin `hasOutstandingRequiredEvidence` is unusable client-side because that module imports the database client.

**Files:**

- Modify: `src/features/annual-return/workflow.ts:27`
- Test: `src/features/annual-return/workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/annual-return/workflow.test.ts`:

```ts
describe("hasRequiredChecklistEvidence", () => {
  const verified: AnnualReturnChecklistItem = {
    id: "44444444-4444-4444-8444-444444444444",
    caseId: "11111111-1111-4111-8111-111111111111",
    itemLabel: "Signed NAR1",
    required: true,
    status: "Verified",
    dueDate: "2026-08-01",
    receivedAt: "2026-07-10T00:00:00.000Z",
    verifiedAt: "2026-07-11T00:00:00.000Z",
    documentId: "55555555-5555-4555-8555-555555555555",
  };

  it("accepts an item that is verified with full evidence", () => {
    expect(hasRequiredChecklistEvidence(verified)).toBe(true);
  });

  it("rejects a Verified item with no document", () => {
    expect(hasRequiredChecklistEvidence({ ...verified, documentId: null })).toBe(false);
  });

  it("rejects a Verified item that was never marked received", () => {
    expect(hasRequiredChecklistEvidence({ ...verified, receivedAt: null })).toBe(false);
  });

  it("rejects an item that is only Received", () => {
    expect(hasRequiredChecklistEvidence({ ...verified, status: "Received" })).toBe(false);
  });
});
```

Add `hasRequiredChecklistEvidence` to the `./workflow` import and `type AnnualReturnChecklistItem` to the `./types` import in that file.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/features/annual-return/workflow.test.ts
```

Expected: FAIL — `hasRequiredChecklistEvidence is not a function`.

- [ ] **Step 3: Export it**

In `src/features/annual-return/workflow.ts` line 27, change:

```ts
function hasRequiredChecklistEvidence(item: AnnualReturnChecklistItem): boolean {
```

to:

```ts
export function hasRequiredChecklistEvidence(item: AnnualReturnChecklistItem): boolean {
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/annual-return/workflow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/workflow.ts src/features/annual-return/workflow.test.ts
git commit -m "test(annual-return): cover and export hasRequiredChecklistEvidence"
```

---

## Task 3: Add `caseFiltersForActor` to `permissions.ts`

`listAnnualReturnCases` applies no actor scoping, while `getAnnualReturnActionPermission` rejects mutations from staff who are not owner, reviewer, team manager or admin. Without this, a Staff user's board is full of rows whose detail screens reject every action.

This goes in `permissions.ts` — that module has **zero imports**, so the rule sits beside the rule it must agree with and needs no mocking to test.

**Files:**

- Modify: `src/features/annual-return/permissions.ts`
- Test: `src/features/annual-return/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/annual-return/permissions.test.ts`:

```ts
describe("caseFiltersForActor", () => {
  const admin = { id: "admin-1", role: "Admin" as const, teamId: null, active: true };
  const manager = { id: "manager-1", role: "Manager" as const, teamId: "team-1", active: true };
  const staff = { id: "staff-1", role: "Staff" as const, teamId: "team-1", active: true };

  it("does not narrow an admin", () => {
    expect(caseFiltersForActor(admin)).toEqual({});
  });

  it("narrows a manager to their own team", () => {
    expect(caseFiltersForActor(manager)).toEqual({ teamId: "team-1" });
  });

  it("narrows staff to cases they own or review", () => {
    // Owner OR reviewer, matching getAnnualReturnActionPermission. A staff
    // reviewer must see their own review work on the board.
    expect(caseFiltersForActor(staff)).toEqual({
      teamId: "team-1",
      visibleToUserId: "staff-1",
    });
  });

  it("refuses an inactive actor", () => {
    expect(() => caseFiltersForActor({ ...staff, active: false })).toThrow(
      "Forbidden: inactive users cannot list annual return cases.",
    );
  });

  it("refuses a non-admin with no team", () => {
    expect(() => caseFiltersForActor({ ...staff, teamId: null })).toThrow(
      "Forbidden: staff actor has no assigned team.",
    );
  });

  it("refuses a staff actor with no database identity", () => {
    expect(() => caseFiltersForActor({ ...staff, id: null })).toThrow(
      "Forbidden: a staff database identity is required.",
    );
  });

  it("refuses a client", () => {
    expect(() => caseFiltersForActor({ ...staff, role: "Client" })).toThrow(
      "Forbidden: staff access is required.",
    );
  });
});
```

Add `caseFiltersForActor` to the existing import from `./permissions`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/features/annual-return/permissions.test.ts
```

Expected: FAIL — `caseFiltersForActor is not a function`.

- [ ] **Step 3: Implement it**

Append to `src/features/annual-return/permissions.ts`:

```ts
/**
 * The board actor. Structurally satisfied by AuthenticatedActor
 * (src/features/auth/types.ts) with `userId` passed as `id`, so this module keeps
 * its zero imports.
 */
export type AnnualReturnBoardActor = {
  id: string | null;
  role: AnnualReturnActorRole | "Client";
  teamId: string | null;
  active: boolean;
};

/**
 * The narrowing a list read must apply so the board shows exactly the cases whose
 * detail screens will accept actions. Mirrors queueFiltersForActor
 * (src/features/work-items/server-fns.ts:58), including its throws.
 */
export type AnnualReturnCaseScope = {
  teamId?: string;
  visibleToUserId?: string;
};

export function caseFiltersForActor(actor: AnnualReturnBoardActor): AnnualReturnCaseScope {
  if (!actor.active) {
    throw new Error("Forbidden: inactive users cannot list annual return cases.");
  }

  if (actor.role === "Admin") {
    return {};
  }

  if (!actor.id) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  if (!actor.teamId) {
    throw new Error("Forbidden: staff actor has no assigned team.");
  }

  if (actor.role === "Manager") {
    return { teamId: actor.teamId };
  }

  if (actor.role === "Staff") {
    return { teamId: actor.teamId, visibleToUserId: actor.id };
  }

  throw new Error("Forbidden: staff access is required.");
}
```

Note the order: the inactive check comes first so an inactive admin is still refused, matching `getAnnualReturnActionPermission`, which checks `active` before the `Admin` shortcut.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/annual-return/permissions.test.ts
```

Expected: PASS, 7 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/permissions.ts src/features/annual-return/permissions.test.ts
git commit -m "feat(annual-return): derive the list scope an actor is allowed to see"
```

---

## Task 4: Teach the repository `visibleToUserId` and `limit`

`CaseFilters` AND-s `ownerId` and `reviewerId` in SQL, so "owner **or** reviewer" cannot be expressed today. And there is no `LIMIT` anywhere — `selectCaseRows` returns every row and `hydrateCases` then loads every checklist and payment row for the whole result set.

**Files:**

- Modify: `src/features/annual-return/repository.ts:102-111` (the `CaseFilters` type)
- Modify: `src/features/annual-return/repository.ts:538-583` (`selectCaseRows`)
- Test: `src/features/annual-return/repository.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append inside the existing `describe.skipIf(!databaseUrl)` block in `src/features/annual-return/repository.test.ts`. Follow the fixture-creation helpers already in that file for inserting companies, users and cases.

```ts
it("returns only cases the given user owns or reviews", async () => {
  const owned = await createCaseFixture({ ownerId: staffId, reviewerId: null });
  const reviewed = await createCaseFixture({ ownerId: otherStaffId, reviewerId: staffId });
  const unrelated = await createCaseFixture({ ownerId: otherStaffId, reviewerId: null });

  const cases = await repository.listCases({ visibleToUserId: staffId });
  const ids = cases.map((case_) => case_.id).sort();

  expect(ids).toEqual([owned.id, reviewed.id].sort());
  expect(ids).not.toContain(unrelated.id);
});

it("caps the number of cases returned", async () => {
  await createCaseFixture({ ownerId: staffId, reviewerId: null });
  await createCaseFixture({ ownerId: staffId, reviewerId: null });
  await createCaseFixture({ ownerId: staffId, reviewerId: null });

  expect(await repository.listCases({ limit: 2 })).toHaveLength(2);
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/features/annual-return/repository.test.ts
```

Expected without `DATABASE_URL`: **skipped**. That is correct and expected — this is the one part of the plan you cannot verify locally. Note it and continue; the typecheck in Step 4 is what catches mistakes here.

- [ ] **Step 3: Implement**

In `src/features/annual-return/repository.ts`, extend the type at line 102:

```ts
export type CaseFilters = {
  ownerId?: string;
  teamId?: string;
  reviewerId?: string;
  risk?: RiskLevel;
  status?: AnnualReturnStatus;
  missingDocuments?: boolean;
  paymentStatus?: PaymentStatus;
  overdueOnly?: boolean;
  /** Cases this user owns OR reviews. Not expressible via ownerId + reviewerId, which AND. */
  visibleToUserId?: string;
  limit?: number;
};
```

Add near the other module constants:

```ts
/**
 * Applied as a SQL LIMIT rather than a client-side slice, so hydrateCases loads
 * children for at most this many cases instead of the whole table.
 */
export const DEFAULT_CASE_LIMIT = 200;
```

In `selectCaseRows`, add to the local bindings:

```ts
const visibleToUserId = filters.visibleToUserId ?? null;
const limit = filters.limit ?? DEFAULT_CASE_LIMIT;
```

In the same function's SQL, add one clause after the `paymentStatus` block and a `limit` after the existing `order by`:

```sql
        and (
          ${visibleToUserId}::uuid is null
          or arc.owner_id = ${visibleToUserId}::uuid
          or arc.reviewer_id = ${visibleToUserId}::uuid
        )
      order by arc.filing_due_date asc, c.company_name asc
      limit ${limit}
```

- [ ] **Step 4: Run typecheck and the full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean; all tests pass; the two new tests reported as skipped.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/repository.ts src/features/annual-return/repository.test.ts
git commit -m "feat(annual-return): let the case query express owner-or-reviewer and cap its size"
```

---

## Task 5: Scope `listAnnualReturnCases`

The plumbing already exists and is thrown away: `withAnnualReturnRepository` resolves the actor and `server-fns.ts:297` ignores it.

**Files:**

- Modify: `src/features/annual-return/server-fns.ts:28-39` (schema), `:269-298` (helper and handler)
- Test: `src/features/annual-return/server-fns.authorization.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/annual-return/server-fns.authorization.test.ts`, following the mocking style already used in that file for `./session` and `./repository`.

```ts
it("narrows the case list to what the acting staff member may act on", async () => {
  const listCases = vi.fn(async () => []);
  actorMock.mockResolvedValue({
    authUserId: "auth-staff-1",
    userId: "staff-1",
    role: "Staff",
    teamId: "team-1",
    active: true,
  });
  repositoryMock.mockReturnValue({ listCases, close: vi.fn(async () => {}) });

  await listAnnualReturnCases({ data: {} });

  expect(listCases).toHaveBeenCalledWith({
    teamId: "team-1",
    visibleToUserId: "staff-1",
  });
});

it("does not let a client-supplied filter widen the actor's scope", async () => {
  const listCases = vi.fn(async () => []);
  actorMock.mockResolvedValue({
    authUserId: "auth-staff-1",
    userId: "staff-1",
    role: "Staff",
    teamId: "team-1",
    active: true,
  });
  repositoryMock.mockReturnValue({ listCases, close: vi.fn(async () => {}) });

  await listAnnualReturnCases({ data: { teamId: "22222222-2222-4222-8222-222222222222" } });

  expect(listCases).toHaveBeenCalledWith(
    expect.objectContaining({ teamId: "team-1", visibleToUserId: "staff-1" }),
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/features/annual-return/server-fns.authorization.test.ts
```

Expected: FAIL — `listCases` was called with `{}` (or the client's `teamId`), because no scope is applied yet.

- [ ] **Step 3: Implement**

In `src/features/annual-return/server-fns.ts`, add `limit` to the list schema:

```ts
const listAnnualReturnCasesSchema = z
  .object({
    ownerId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    reviewerId: z.string().uuid().optional(),
    risk: z.enum(RISK_LEVELS).optional(),
    status: annualReturnStatusSchema.optional(),
    missingDocuments: z.boolean().optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    overdueOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .default({});
```

Import the new rule:

```ts
import { caseFiltersForActor } from "./permissions";
```

Add a scoped repository helper beside the existing `withAnnualReturnRepository`:

```ts
async function withScopedAnnualReturnRepository<T>(
  handler: (repository: AnnualReturnRepository, scope: AnnualReturnCaseScope) => Promise<T>,
): Promise<T> {
  const actor = await getCurrentAnnualReturnActor(getRequest());
  const scope = caseFiltersForActor({
    id: actor.userId,
    role: actor.role,
    teamId: actor.teamId,
    active: actor.active,
  });
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, scope);
  } finally {
    await repository.close();
  }
}
```

Add `type AnnualReturnCaseScope` to the `./permissions` import.

Replace the handler at line 294:

```ts
export const listAnnualReturnCases = createServerFn({ method: "GET" })
  .validator(listAnnualReturnCasesSchema)
  .handler(async ({ data }) =>
    // Scope last: a client-supplied teamId must never widen what the actor may see.
    withScopedAnnualReturnRepository((repository, scope) =>
      repository.listCases({ ...data, ...scope }),
    ),
  );
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/annual-return/server-fns.authorization.test.ts && npm run typecheck
```

Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/server-fns.ts src/features/annual-return/server-fns.authorization.test.ts
git commit -m "fix(annual-return): scope the case list to the acting staff member"
```

---

## Task 6: Board tile derivations

Tiles derive from the same scoped list that fills the rows, so tiles and rows agree by construction. `getAnnualReturnDashboardMetrics` counts every case in the firm, unfilterable, and would show "Overdue: 12" above three rows.

**The trap this task exists to avoid:** `riskForCase` returns `"green"` for Filed and Completed cases **only when `completionBlockers` is empty**; otherwise it falls through to the deadline ladder, so a filed case past its due date carries `riskLevel: "red"`. A naive "overdue = red" tile counts completed work as overdue.

**Files:**

- Create: `src/features/annual-return/board-metrics.ts`
- Test: `src/features/annual-return/board-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/annual-return/board-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { boardMetrics } from "./board-metrics";
import type { AnnualReturnCase } from "./types";

const TODAY = "2026-07-30";

function makeCase(overrides: Partial<AnnualReturnCase> = {}): AnnualReturnCase {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    companyTeamId: "33333333-3333-4333-8333-333333333333",
    companyName: "Acme Company Limited",
    returnYear: 2026,
    madeUpDate: "2026-06-30",
    filingDueDate: "2026-08-11",
    currentStatus: "Upcoming",
    riskLevel: "green",
    ownerId: "44444444-4444-4444-8444-444444444444",
    ownerName: "Ada Chan",
    reviewerId: null,
    reviewerName: null,
    remindersSent: 0,
    filingReference: null,
    confirmationDocumentId: null,
    lockedAt: null,
    completedAt: null,
    checklist: [],
    payment: null,
    ...overrides,
  };
}

describe("boardMetrics", () => {
  it("counts an open case past its due date as overdue", () => {
    const metrics = boardMetrics(
      [makeCase({ filingDueDate: "2026-07-01", riskLevel: "red" })],
      TODAY,
    );

    expect(metrics.overdue).toBe(1);
  });

  it("does not count a filed case as overdue or high risk even when its risk is red", () => {
    // riskForCase returns green for Filed only when completionBlockers is empty;
    // otherwise a filed-but-past-due case carries riskLevel "red". Filed work is
    // not outstanding work.
    const metrics = boardMetrics(
      [
        makeCase({
          currentStatus: "Filed",
          filingDueDate: "2026-07-01",
          riskLevel: "red",
        }),
      ],
      TODAY,
    );

    expect(metrics.overdue).toBe(0);
    expect(metrics.highRisk).toBe(0);
  });

  it("counts orange and red open cases as high risk", () => {
    const metrics = boardMetrics(
      [makeCase({ riskLevel: "orange" }), makeCase({ riskLevel: "red" }), makeCase()],
      TODAY,
    );

    expect(metrics.highRisk).toBe(2);
  });

  it("splits the deadline windows at 7 and 30 days inclusive", () => {
    const metrics = boardMetrics(
      [
        makeCase({ filingDueDate: "2026-08-06" }), // 7 days out
        makeCase({ filingDueDate: "2026-08-07" }), // 8 days out
        makeCase({ filingDueDate: "2026-08-29" }), // 30 days out
        makeCase({ filingDueDate: "2026-08-30" }), // 31 days out
      ],
      TODAY,
    );

    expect(metrics.dueIn7).toBe(1);
    expect(metrics.dueIn30).toBe(3);
  });

  it("counts a case with an unverified required checklist item as missing documents", () => {
    const item = {
      id: "55555555-5555-4555-8555-555555555555",
      caseId: "11111111-1111-4111-8111-111111111111",
      itemLabel: "Signed NAR1",
      required: true,
      status: "Received" as const,
      dueDate: "2026-08-01",
      receivedAt: "2026-07-10T00:00:00.000Z",
      verifiedAt: null,
      documentId: null,
    };

    expect(boardMetrics([makeCase({ checklist: [item] })], TODAY).missingDocuments).toBe(1);
  });

  it("ignores optional checklist items when counting missing documents", () => {
    const optional = {
      id: "55555555-5555-4555-8555-555555555555",
      caseId: "11111111-1111-4111-8111-111111111111",
      itemLabel: "Nice to have",
      required: false,
      status: "Missing" as const,
      dueDate: "2026-08-01",
      receivedAt: null,
      verifiedAt: null,
      documentId: null,
    };

    expect(boardMetrics([makeCase({ checklist: [optional] })], TODAY).missingDocuments).toBe(0);
  });

  it("counts pending and overdue payments, not received ones", () => {
    const payment = {
      id: "66666666-6666-4666-8666-666666666666",
      caseId: "11111111-1111-4111-8111-111111111111",
      invoiceNumber: "INV-1",
      amount: 2800,
      currency: "HKD" as const,
      status: "Payment pending" as const,
      dueDate: "2026-08-01",
      paidAt: null,
      paymentProofDocumentId: null,
    };

    const metrics = boardMetrics(
      [
        makeCase({ payment }),
        makeCase({ payment: { ...payment, status: "Overdue" } }),
        makeCase({ payment: { ...payment, status: "Payment received" } }),
        makeCase({ payment: null }),
      ],
      TODAY,
    );

    expect(metrics.paymentPending).toBe(2);
  });

  it("returns zeroes for an empty board", () => {
    expect(boardMetrics([], TODAY)).toEqual({
      dueIn7: 0,
      dueIn30: 0,
      overdue: 0,
      highRisk: 0,
      missingDocuments: 0,
      paymentPending: 0,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/features/annual-return/board-metrics.test.ts
```

Expected: FAIL — cannot resolve `./board-metrics`.

- [ ] **Step 3: Implement**

Create `src/features/annual-return/board-metrics.ts`:

```ts
import type { AnnualReturnCase } from "./types";
import { daysBetween, hasRequiredChecklistEvidence } from "./workflow";

/**
 * No "assigned to me" tile. The board is already scoped to the actor, and the
 * client holds an auth user id rather than the staff uuid that `ownerId` carries,
 * so the count could not be derived here honestly.
 */
export type AnnualReturnBoardMetrics = {
  dueIn7: number;
  dueIn30: number;
  overdue: number;
  highRisk: number;
  missingDocuments: number;
  paymentPending: number;
};

/**
 * Filed and Completed cases are finished work. They are excluded from every tile
 * — matching repository.dashboardMetrics, and necessary
 * because riskForCase returns "red" for a filed case past its due date whenever
 * completionBlockers is non-empty.
 */
function isOpen(case_: AnnualReturnCase): boolean {
  return case_.currentStatus !== "Filed" && case_.currentStatus !== "Completed";
}

function isMissingRequiredEvidence(case_: AnnualReturnCase): boolean {
  return case_.checklist.some((item) => item.required && !hasRequiredChecklistEvidence(item));
}

export function boardMetrics(
  cases: readonly AnnualReturnCase[],
  today: string,
): AnnualReturnBoardMetrics {
  const metrics: AnnualReturnBoardMetrics = {
    dueIn7: 0,
    dueIn30: 0,
    overdue: 0,
    highRisk: 0,
    missingDocuments: 0,
    paymentPending: 0,
  };

  for (const case_ of cases) {
    if (!isOpen(case_)) continue;

    const daysRemaining = daysBetween(today, case_.filingDueDate);

    if (daysRemaining < 0) metrics.overdue += 1;
    if (daysRemaining >= 0 && daysRemaining <= 7) metrics.dueIn7 += 1;
    if (daysRemaining >= 0 && daysRemaining <= 30) metrics.dueIn30 += 1;
    if (case_.riskLevel === "red" || case_.riskLevel === "orange") metrics.highRisk += 1;
    if (isMissingRequiredEvidence(case_)) metrics.missingDocuments += 1;
    if (case_.payment?.status === "Payment pending" || case_.payment?.status === "Overdue") {
      metrics.paymentPending += 1;
    }
  }

  return metrics;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/annual-return/board-metrics.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/board-metrics.ts src/features/annual-return/board-metrics.test.ts
git commit -m "feat(annual-return): derive board tiles from the scoped case list"
```

---

## Task 7: The production board component

**Files:**

- Create: `src/features/annual-return/components/production-command-center.tsx`
- Test: `src/features/annual-return/components/production-command-center.interaction.test.tsx`

Design constraints this task must honour, all from the spec:

- Read `riskLevel` off the payload. Never recompute it client-side.
- No Blockers column. `completionBlockers` is a completion gate, not a work list.
- Error text is a **fixed string**. `query.error.message` is the verbatim server error — a postgres `ECONNREFUSED <host>:<port>` or `DATABASE_URL is required...`.
- The empty state is gated on `!isError` as well as `!isLoading`. `payments.tsx` renders both at once; do not copy that.
- `retry: false` on every query.
- A failing work-queue query gets a banner, not a silent per-row "Unavailable".
- Native `<select>`, not Radix.

- [ ] **Step 1: Write the failing test**

Create `src/features/annual-return/components/production-command-center.interaction.test.tsx`:

```tsx
// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnualReturnCase } from "../types";
import { ProductionAnnualReturnCommandCenter } from "./production-command-center";

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCases: vi.fn(),
  listWorkQueue: vi.fn(),
}));

vi.mock("../server-fns", () => ({ listAnnualReturnCases: serverFns.listAnnualReturnCases }));
vi.mock("@/features/work-items/server-fns", () => ({ listWorkQueue: serverFns.listWorkQueue }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

const caseId = "11111111-1111-4111-8111-111111111111";

function makeCase(overrides: Partial<AnnualReturnCase> = {}): AnnualReturnCase {
  return {
    id: caseId,
    companyId: "22222222-2222-4222-8222-222222222222",
    companyTeamId: "33333333-3333-4333-8333-333333333333",
    companyName: "Acme Company Limited",
    returnYear: 2026,
    madeUpDate: "2026-06-30",
    filingDueDate: "2026-08-11",
    currentStatus: "Upcoming",
    riskLevel: "green",
    ownerId: "44444444-4444-4444-8444-444444444444",
    ownerName: "Ada Chan",
    reviewerId: null,
    reviewerName: null,
    remindersSent: 0,
    filingReference: null,
    confirmationDocumentId: null,
    lockedAt: null,
    completedAt: null,
    checklist: [],
    payment: null,
    ...overrides,
  };
}

function renderBoard() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionAnnualReturnCommandCenter search={{}} />
    </QueryClientProvider>,
  );
}

describe("production annual return command center", () => {
  beforeEach(() => {
    serverFns.listAnnualReturnCases.mockReset();
    serverFns.listWorkQueue.mockReset();
    serverFns.listWorkQueue.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a row per case", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([makeCase()]);
    renderBoard();

    expect(await screen.findByText("Acme Company Limited")).toBeTruthy();
  });

  it("shows a fixed message on failure and never the raw server error", async () => {
    serverFns.listAnnualReturnCases.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:5432"),
    );
    renderBoard();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Annual return data is unavailable.");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
    expect(screen.queryByText(/10\.0\.0\.4/)).toBeNull();
  });

  it("does not render the empty state and the error at the same time", async () => {
    // payments.tsx:83 and :160 do exactly this: on error `data` is undefined so the
    // list is empty and isLoading is false, so the screen says both "unavailable"
    // and "nothing to review".
    serverFns.listAnnualReturnCases.mockRejectedValue(new Error("boom"));
    renderBoard();

    await screen.findByRole("alert");

    expect(screen.queryByText("No annual return cases match these filters.")).toBeNull();
  });

  it("shows the empty state when the query succeeds with no cases", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([]);
    renderBoard();

    expect(await screen.findByText("No annual return cases match these filters.")).toBeTruthy();
  });

  it("surfaces a work queue failure as a banner instead of silent per-row text", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([makeCase()]);
    serverFns.listWorkQueue.mockRejectedValue(
      new Error("Forbidden: staff actor has no assigned team."),
    );
    renderBoard();

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .map((node) => node.textContent ?? "")
          .join(" "),
      ).toContain("Assignment and SLA data is unavailable."),
    );
  });

  it("warns when the result is capped", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue(
      Array.from({ length: 200 }, (_, index) =>
        makeCase({ id: `case-${index}`, companyName: `Company ${index}` }),
      ),
    );
    renderBoard();

    expect(
      await screen.findByText("Showing the first 200 cases — narrow the filters."),
    ).toBeTruthy();
  });

  it("requests the capped page size", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([]);
    renderBoard();

    await waitFor(() =>
      expect(serverFns.listAnnualReturnCases).toHaveBeenCalledWith({ data: { limit: 200 } }),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/features/annual-return/components/production-command-center.interaction.test.tsx
```

Expected: FAIL — cannot resolve `./production-command-center`.

- [ ] **Step 3: Implement the component**

Create `src/features/annual-return/components/production-command-center.tsx`:

```tsx
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { listWorkQueue } from "@/features/work-items/server-fns";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { boardMetrics } from "../board-metrics";
import { annualReturnQueryKeys } from "../query-keys";
import { listAnnualReturnCases } from "../server-fns";
import { ANNUAL_RETURN_STATUSES, type AnnualReturnCase, type RiskLevel } from "../types";
import { daysBetween, hongKongBusinessDate } from "../workflow";

const BOARD_PAGE_SIZE = 200;

// One template, defined once, with real floors on both flexible tracks. A track
// of minmax(0, …) collapses to zero and lets its text draw over the neighbouring
// column, which is what happened on the demo board.
const BOARD_GRID_COLUMNS =
  "lg:grid-cols-[minmax(220px,1.6fr)_140px_150px_96px_minmax(130px,1fr)_110px_120px_90px_72px]";
const BOARD_GRID_MIN_WIDTH = "lg:min-w-[1200px]";

const riskToneClasses: Record<RiskLevel, string> = {
  red: "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-700",
  yellow: "bg-yellow-100 text-yellow-800",
  green: "bg-green-100 text-green-700",
};

export type ProductionBoardSearch = {
  q?: string;
  status?: string;
  risk?: string;
  ownerId?: string;
  overdueOnly?: boolean;
};

export function ProductionAnnualReturnCommandCenter({
  search,
  onSearchChange,
}: {
  search: ProductionBoardSearch;
  onSearchChange?: (next: ProductionBoardSearch) => void;
}) {
  const today = hongKongBusinessDate();

  const casesQuery = useQuery({
    queryKey: annualReturnQueryKeys.list({
      status: search.status,
      risk: search.risk,
      ownerId: search.ownerId,
      overdueOnly: search.overdueOnly,
    }),
    queryFn: () =>
      listAnnualReturnCases({
        data: {
          limit: BOARD_PAGE_SIZE,
          ...(search.status ? { status: search.status as AnnualReturnCase["currentStatus"] } : {}),
          ...(search.risk ? { risk: search.risk as RiskLevel } : {}),
          ...(search.ownerId ? { ownerId: search.ownerId } : {}),
          ...(search.overdueOnly ? { overdueOnly: true } : {}),
        },
      }),
    retry: false,
  });

  const workItemsQuery = useQuery({
    queryKey: ["work-queue", "annual-return-board"],
    queryFn: () => listWorkQueue({ data: { view: "team" } }),
    retry: false,
  });

  const cases = useMemo(() => casesQuery.data ?? [], [casesQuery.data]);

  const workItemsByCase = useMemo(() => {
    const map = new Map<string, PersistedWorkItem>();
    for (const item of workItemsQuery.data ?? []) {
      if (!map.has(item.caseId)) map.set(item.caseId, item);
    }
    return map;
  }, [workItemsQuery.data]);

  // Company-name only: the production case carries no contact name or phone.
  const query = (search.q ?? "").trim().toLowerCase();
  const visibleCases = useMemo(
    () =>
      query ? cases.filter((c) => c.companyName.toLowerCase().includes(query)) : cases.slice(),
    [cases, query],
  );

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const case_ of cases) map.set(case_.ownerId, case_.ownerName);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [cases]);

  const metrics = boardMetrics(cases, today);
  const capped = cases.length === BOARD_PAGE_SIZE;

  function update(patch: Partial<ProductionBoardSearch>) {
    onSearchChange?.({ ...search, ...patch });
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Operations"
        title="Annual returns"
        actions={
          <Link
            to="/work-queue"
            search={{
              view: "team",
              owner: "all",
              workType: "all",
              sla: "all",
              priority: "all",
              status: "all",
            }}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Open work queue
          </Link>
        }
      />

      {/* A fixed string, never query.error.message: the client rehydrates and
          rethrows the verbatim server error, which is a postgres ECONNREFUSED
          with host and port, or the DATABASE_URL message. */}
      {casesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Annual return data is unavailable. Try again shortly.
        </p>
      ) : null}

      {workItemsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Assignment and SLA data is unavailable. Case details below are unaffected.
        </p>
      ) : null}

      {capped ? (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the first {BOARD_PAGE_SIZE} cases — narrow the filters.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Metric label="Due in 7 days" value={metrics.dueIn7} />
        <Metric label="Due in 30 days" value={metrics.dueIn30} />
        <Metric label="Overdue" value={metrics.overdue} />
        <Metric label="High risk" value={metrics.highRisk} />
        <Metric label="Missing documents" value={metrics.missingDocuments} />
        <Metric label="Payment pending" value={metrics.paymentPending} />
        <Metric label="Cases shown" value={visibleCases.length} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto_auto]">
          <input
            aria-label="Search company"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Search company"
            value={search.q ?? ""}
            onChange={(event) => update({ q: event.target.value })}
          />
          <select
            aria-label="Filter by owner"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.ownerId ?? ""}
            onChange={(event) => update({ ownerId: event.target.value || undefined })}
          >
            <option value="">All owners</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.status ?? ""}
            onChange={(event) => update({ status: event.target.value || undefined })}
          >
            <option value="">All statuses</option>
            {ANNUAL_RETURN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by risk"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.risk ?? ""}
            onChange={(event) => update({ risk: event.target.value || undefined })}
          >
            <option value="">All risk levels</option>
            <option value="red">Red</option>
            <option value="orange">Orange</option>
            <option value="yellow">Yellow</option>
            <option value="green">Green</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <div className={BOARD_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${BOARD_GRID_COLUMNS}`}
            >
              <span>Company</span>
              <span>Due</span>
              <span>Status</span>
              <span>Risk</span>
              <span>Owner</span>
              <span>Checklist</span>
              <span>Payment</span>
              <span>Reminders</span>
              <span className="text-right">Open</span>
            </div>

            <div className="divide-y">
              {visibleCases.map((case_) => (
                <BoardRow
                  key={case_.id}
                  caseItem={case_}
                  today={today}
                  workItem={workItemsByCase.get(case_.id)}
                  workItemsUnavailable={workItemsQuery.isError}
                />
              ))}
            </div>
          </div>
        </div>

        {casesQuery.isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading annual return cases...</p>
        ) : null}

        {/* Gated on isError as well as isPending. payments.tsx omits the isError
            half and so renders "unavailable" and "nothing to review" together. */}
        {!casesQuery.isPending && !casesQuery.isError && visibleCases.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No annual return cases match these filters.
          </p>
        ) : null}
      </section>
    </main>
  );
}

function BoardRow({
  caseItem,
  today,
  workItem,
  workItemsUnavailable,
}: {
  caseItem: AnnualReturnCase;
  today: string;
  workItem: PersistedWorkItem | undefined;
  workItemsUnavailable: boolean;
}) {
  const daysRemaining = daysBetween(today, caseItem.filingDueDate);
  const required = caseItem.checklist.filter((item) => item.required);
  const verified = required.filter((item) => item.status === "Verified");

  return (
    <div className={`grid gap-3 px-4 py-3 text-sm lg:grid ${BOARD_GRID_COLUMNS}`}>
      <div className="min-w-0">
        <p className="truncate font-medium">{caseItem.companyName}</p>
        <p className="truncate text-sm text-muted-foreground">
          {caseItem.returnYear} · made up {caseItem.madeUpDate}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          SLA:{" "}
          {workItemsUnavailable
            ? "Unavailable"
            : workItem
              ? workItem.escalationState
              : "No work item"}
        </p>
      </div>
      <Field label="Due" value={formatDue(caseItem.filingDueDate, daysRemaining)} />
      <Field label="Status" value={caseItem.currentStatus} />
      <Field
        label="Risk"
        value={
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${riskToneClasses[caseItem.riskLevel]}`}
          >
            {caseItem.riskLevel}
          </span>
        }
      />
      <Field label="Owner" value={caseItem.ownerName} />
      <Field label="Checklist" value={`${verified.length}/${required.length} verified`} />
      <Field label="Payment" value={caseItem.payment?.status ?? "Not invoiced"} />
      <Field label="Reminders" value={`${caseItem.remindersSent}`} />
      <div className="flex justify-start lg:justify-end">
        <Link
          className="rounded-md border px-3 py-1.5 text-sm"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
        >
          Open
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground lg:hidden">{label}</p>
      <div className="truncate">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatDue(dueDate: string, daysRemaining: number): string {
  if (daysRemaining < 0) return `${dueDate} (${Math.abs(daysRemaining)}d overdue)`;
  return `${dueDate} (${daysRemaining}d)`;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/annual-return/components/production-command-center.interaction.test.tsx && npm run typecheck
```

Expected: PASS, 7 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/components/production-command-center.tsx src/features/annual-return/components/production-command-center.interaction.test.tsx
git commit -m "feat(annual-return): add the production command center board"
```

---

## Task 8: Router tests at both data modes

This is the gap that let the `<Outlet />` break through in design: `dataMode: "production"` appears in **no test in this repository**, so the only router-level test could not have caught a parent route that stops rendering its child.

**Files:**

- Create: `src/routes/-annual-returns-data-mode.test.tsx`

Note the `-` prefix: without it TanStack Router treats the file as a route, and `page-header.convention.test.ts:47` will also police it.

- [ ] **Step 1: Write the test**

Create `src/routes/-annual-returns-data-mode.test.tsx`. The four auth mocks below are required — the router will not load without them. They are reproduced in full here rather than cross-referenced, because `vi.mock` calls are hoisted and must appear before any import.

```tsx
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/session")>();
  return {
    ...actual,
    getStoredSession: () => ({
      id: "test-admin",
      name: "Test Admin",
      email: "admin@example.com",
      role: "Admin",
      initials: "TA",
      team: "Operations",
      signedInAt: "2026-07-11T00:00:00.000Z",
    }),
  };
});

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-admin" }),
}));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  const session = {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@example.com",
    role: "Admin" as const,
    initials: "TA",
    team: "Operations",
    signedInAt: "2026-07-11T00:00:00.000Z",
  };

  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session,
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: true,
      login: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCases: vi.fn(async () => []),
  listWorkQueue: vi.fn(async () => []),
}));

vi.mock("../features/annual-return/server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/annual-return/server-fns")>()),
  listAnnualReturnCases: serverFns.listAnnualReturnCases,
  getAnnualReturnCase: vi.fn(async () => null),
}));

vi.mock("../features/work-items/server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/work-items/server-fns")>()),
  listWorkQueue: serverFns.listWorkQueue,
}));

import { routeTree } from "../routeTree.gen";
import { resetAnnualReturnCasesForTest } from "../lib/annual-return-store";
import { resetClientPortalStoreForTest } from "../lib/client-portal-store";

async function renderRoute(pathname: string, dataMode: "demo" | "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: { queryClient: new QueryClient(), dataMode },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("annual returns route across data modes", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();
  });

  // The regression guard. /annual-returns/$id is a CHILD of /annual-returns and
  // renders only through the parent's <Outlet />. A parent that branches on
  // dataMode without keeping that guard silently stops rendering the detail
  // screen, and every other test in the repo runs at dataMode "demo".
  it("still renders the production detail screen through the parent outlet", async () => {
    const html = await renderRoute(
      "/annual-returns/11111111-1111-4111-8111-111111111111",
      "production",
    );

    expect(html).toContain("Annual return case");
    expect(html).not.toContain("Search company");
  });

  it("still renders the demo detail screen through the parent outlet", async () => {
    const html = await renderRoute("/annual-returns/ar-delta", "demo");

    expect(html).toContain("Delta Bloom Ventures Limited");
  });

  it("renders the production board at /annual-returns in production mode", async () => {
    const html = await renderRoute("/annual-returns", "production");

    expect(html).toContain("Search company");
    expect(html).not.toContain("Search company or contact");
    expect(html).not.toContain("Delta Bloom Ventures Limited");
  });

  it("renders the demo board at /annual-returns in demo mode", async () => {
    const html = await renderRoute("/annual-returns", "demo");

    expect(html).toContain("Search company or contact");
    expect(html).toContain("Delta Bloom Ventures Limited");
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/routes/-annual-returns-data-mode.test.tsx
```

Expected: the two detail tests **PASS** (the `<Outlet />` guard is intact today — these are regression guards, written before the change so they can catch it breaking). The third test **FAILS**: the demo board renders in production mode, so `Search company or contact` is present and `Search company` alone is not.

If the first test fails instead, stop — something is already wrong with the route tree and this plan's assumptions do not hold.

- [ ] **Step 3: Commit the red test**

```bash
git add src/routes/-annual-returns-data-mode.test.tsx
git commit -m "test(annual-returns): pin the outlet contract at both data modes"
```

Committing a failing test is deliberate here: the next task makes it pass, and the commit records that the guard existed before the restructure.

---

## Task 9: Branch the route

**Files:**

- Modify: `src/routes/annual-returns.tsx:24-77`

The two constraints that decide the shape, both verified during design:

- `-annual-returns-workflow.test.ts:162-167` asserts this file contains `<span>Blockers</span>`, `<span>Packet</span>`, `<span>Follow-ups</span>` and `<Field label="Blockers" value={blockerSummary} />`. **The demo markup must stay in this file.**
- `-annual-returns-table-layout.test.ts` requires exactly one `lg:grid-cols-[minmax` literal and zero unprefixed `min-w-[Npx]` in this file. **The production grid must not be added to it.**

- [ ] **Step 1: Restructure the route component**

In `src/routes/annual-returns.tsx`, add the import:

```ts
import { ProductionAnnualReturnCommandCenter } from "../features/annual-return/components/production-command-center";
```

Replace the opening of `AnnualReturnsRoute` (currently lines 28-46, from `function AnnualReturnsRoute() {` through the `const [owner, setOwner] = useState("all");` line) and the guard at lines 75-77, so the file reads:

```tsx
function AnnualReturnsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();

  // Hoisted above both the branch and every hook. /annual-returns/$id is a child
  // route and renders only through this outlet; the guard previously sat after
  // the hooks, so the demo store subscription, the work-queue query and the whole
  // filter pipeline ran while the detail screen was displayed.
  if (pathname !== "/annual-returns") {
    return <Outlet />;
  }

  return dataMode === "demo" ? (
    <DemoAnnualReturnCommandCenter />
  ) : (
    <ProductionAnnualReturnCommandCenter search={{}} />
  );
}

function DemoAnnualReturnCommandCenter() {
  const cases = useAnnualReturnCases();
  const workItemsQuery = useQuery({
    queryKey: ["work-queue", "annual-return-list"],
    queryFn: () => listWorkQueue({ data: { view: "team" } }),
  });
  // Everything below is the existing body, moved verbatim.
}
```

Concretely, in the old `AnnualReturnsRoute`:

- **Delete** its first two lines — `const pathname = useRouterState(...)` and, if present, any `useRouteContext` call. They move up into the new route component.
- **Delete** the guard at old lines 75-77 (`if (pathname !== "/annual-returns") { return <Outlet />; }`). It moves up too.
- **Keep, unchanged**, everything from `const workItemsByCase = useMemo(...)` through the closing `}` — the `useState` calls, `getCaseMetrics`, `visibleCases`, the whole `return (...)`, and the module-level `CASE_GRID_COLUMNS` and `CASE_GRID_MIN_WIDTH` constants. Not one JSX string changes; the two pinning tests in Steps 2-3 verify that.
- **Rename** the function to `DemoAnnualReturnCommandCenter`.

`useRouterState` and `Outlet` are already imported at the top of the file and are now used only by the new route component.

- [ ] **Step 2: Run the router tests**

```bash
npx vitest run src/routes/-annual-returns-data-mode.test.tsx
```

Expected: all four PASS. If the two detail tests now fail, the `<Outlet />` guard was dropped — that is exactly the bug this test exists to catch.

- [ ] **Step 3: Run the two pinning tests**

```bash
npx vitest run src/routes/-annual-returns-workflow.test.ts src/routes/-annual-returns-table-layout.test.ts
```

Expected: PASS. If the workflow test fails you moved demo markup out of the file; if the layout test fails you added a second grid template to it.

- [ ] **Step 4: Run everything**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: typecheck clean; lint 0 errors (6 pre-existing warnings); all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/annual-returns.tsx
git commit -m "fix(annual-returns): branch the board on dataMode without dropping the outlet"
```

---

## Task 10: Put the board filters in the URL

All board state is local `useState` today, lost on reload and on every return from a detail screen.

**Files:**

- Modify: `src/routes/annual-returns.tsx:24-26` (route config) and the branch in `AnnualReturnsRoute`
- Test: `src/routes/-annual-returns-data-mode.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/routes/-annual-returns-data-mode.test.tsx`:

```tsx
it("reads board filters from the URL in production mode", async () => {
  await renderRoute("/annual-returns?status=Filed&overdueOnly=true", "production");

  expect(serverFns.listAnnualReturnCases).toHaveBeenCalledWith({
    data: { limit: 200, status: "Filed", overdueOnly: true },
  });
});

it("ignores an unknown status in the URL", async () => {
  await renderRoute("/annual-returns?status=NotAStatus", "production");

  expect(serverFns.listAnnualReturnCases).toHaveBeenCalledWith({ data: { limit: 200 } });
});
```

Add `serverFns.listAnnualReturnCases.mockClear()` to the `beforeEach`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/routes/-annual-returns-data-mode.test.tsx
```

Expected: FAIL — called with `{ data: { limit: 200 } }` for both, because `search={{}}` is hardcoded.

- [ ] **Step 3: Add `validateSearch` and wire it**

In `src/routes/annual-returns.tsx`, add the import:

```ts
import { ANNUAL_RETURN_STATUSES } from "../features/annual-return/types";
```

Replace the route config:

```tsx
const RISK_VALUES = ["green", "yellow", "orange", "red"] as const;

export const Route = createFileRoute("/annual-returns")({
  // Board filters live in the URL so they survive a reload and a return from a
  // detail screen. work-queue.tsx:31 is the precedent.
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status: ANNUAL_RETURN_STATUSES.includes(search.status as never)
      ? (search.status as string)
      : undefined,
    risk: RISK_VALUES.includes(search.risk as never) ? (search.risk as string) : undefined,
    ownerId: typeof search.ownerId === "string" ? search.ownerId : undefined,
    overdueOnly: search.overdueOnly === true || search.overdueOnly === "true" ? true : undefined,
  }),
  component: AnnualReturnsRoute,
});
```

In `AnnualReturnsRoute`, read the search and pass it down:

```tsx
function AnnualReturnsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  if (pathname !== "/annual-returns") {
    return <Outlet />;
  }

  return dataMode === "demo" ? (
    <DemoAnnualReturnCommandCenter />
  ) : (
    <ProductionAnnualReturnCommandCenter
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/routes/-annual-returns-data-mode.test.tsx && npm run typecheck
```

Expected: PASS, 6 tests; typecheck clean.

If typecheck complains that `/annual-returns` now requires search params at existing `<Link to="/annual-returns">` call sites, add `search={{}}` at each — `demo-case-detail.tsx:117` and `production-case-detail.tsx:173,184` are the ones to check.

- [ ] **Step 5: Commit**

```bash
git add src/routes/annual-returns.tsx src/routes/-annual-returns-data-mode.test.tsx
git commit -m "feat(annual-returns): keep board filters in the URL"
```

---

## Task 11: Fix the two `payments.tsx` defects the board would inherit

Both were found while designing this screen. Neither is hypothetical.

**Files:**

- Modify: `src/routes/payments.tsx:63-71` and `:160-164`
- Test: `src/routes/-payments.interaction.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/routes/-payments.interaction.test.tsx`. The `-` prefix is required or the router treats it as a route.

`ProductionPaymentsRoute` is not exported — it is an inner function of `payments.tsx`. Export it as part of this task:

```tsx
export function ProductionPaymentsRoute() {
```

Then the test:

```tsx
// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductionPaymentsRoute } from "./payments";

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCases: vi.fn(),
  listDocuments: vi.fn(),
  reviewAnnualReturnEvidenceAction: vi.fn(),
}));

vi.mock("../features/annual-return/server-fns", () => ({
  listAnnualReturnCases: serverFns.listAnnualReturnCases,
}));

vi.mock("../features/documents/server-fns", () => ({
  listDocuments: serverFns.listDocuments,
}));

vi.mock("../features/annual-return/evidence-server-fns", () => ({
  reviewAnnualReturnEvidenceAction: serverFns.reviewAnnualReturnEvidenceAction,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/payments">{children}</a>,
  createFileRoute: () => () => ({ useRouteContext: () => ({ dataMode: "production" }) }),
}));

function renderPayments() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionPaymentsRoute />
    </QueryClientProvider>,
  );
}

describe("production payments route", () => {
  beforeEach(() => {
    serverFns.listAnnualReturnCases.mockReset();
    serverFns.listDocuments.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not claim there is nothing to review when the query failed", async () => {
    // On error `data` is undefined so the filtered list is empty, and isLoading is
    // false because the status is `error`. Without an isError guard the screen
    // renders "unavailable" and "nothing to review" at the same time.
    serverFns.listAnnualReturnCases.mockRejectedValue(new Error("boom"));
    serverFns.listDocuments.mockRejectedValue(new Error("boom"));
    renderPayments();

    await screen.findByRole("alert");

    expect(screen.queryByText("No production payment evidence is awaiting review.")).toBeNull();
  });

  it("still shows the empty state when the queries succeed with nothing to review", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([]);
    serverFns.listDocuments.mockResolvedValue([]);
    renderPayments();

    expect(
      await screen.findByText("No production payment evidence is awaiting review."),
    ).toBeTruthy();
  });
});
```

If mocking `createFileRoute` proves awkward because `payments.tsx` calls it at module scope, move `ProductionPaymentsRoute` into `src/features/annual-return/components/production-payments.tsx` instead and import it back — that is the convention two of the four branching routes already follow, and it removes the need for the `createFileRoute` mock entirely.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/routes/-payments.interaction.test.tsx
```

Expected: FAIL — both the alert and the empty message render, because `isLoading` is `false` when the status is `error`.

- [ ] **Step 3: Fix both defects**

In `src/routes/payments.tsx`, gate the empty state on error too (line 160):

```tsx
{
  !casesQuery.isLoading &&
  !documentsQuery.isLoading &&
  !casesQuery.isError &&
  !documentsQuery.isError &&
  paymentDocuments.length === 0 ? (
    <p className="px-4 py-6 text-sm text-muted-foreground">
      No production payment evidence is awaiting review.
    </p>
  ) : null;
}
```

And invalidate the whole namespace after a review (line 65), so any board keyed on `annualReturnQueryKeys.list(...)` refreshes — `.all` is `["annual-returns"]` and matches by prefix:

```tsx
onSuccess: ({ caseItem }) => {
  queryClient.setQueryData(annualReturnQueryKeys.detail(caseItem.id), caseItem);
  void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
},
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/routes/-payments.interaction.test.tsx && npm run typecheck
```

Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/payments.tsx src/routes/-payments.interaction.test.tsx
git commit -m "fix(payments): stop reporting an empty queue on a failed query"
```

---

## Task 12: Enforce the demo-import ban on the new board

`-production-authorization.test.ts:48-51` bans `annual-return-store` and `client-portal-store` strings in two named production files. The new board is not covered, so the guarantee is convention rather than enforcement.

**Files:**

- Modify: `src/routes/-production-authorization.test.ts:48-51`

- [ ] **Step 1: Extend the test**

Add a read for the new file alongside the existing ones and assert the same two bans:

```ts
const productionCommandCenterSource = readFileSync(
  new URL("../features/annual-return/components/production-command-center.tsx", import.meta.url),
  "utf8",
);
```

```ts
for (const source of [
  productionAnnualReturnDetailSource,
  productionAnnualReturnActionsSource,
  productionCommandCenterSource,
]) {
  expect(source).not.toContain("annual-return-store");
  expect(source).not.toContain("client-portal-store");
}
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/routes/-production-authorization.test.ts
```

Expected: PASS — the board imports only from `../types`, `../workflow`, `../board-metrics`, `../server-fns`, `../query-keys` and the work-items feature.

- [ ] **Step 3: Full gate**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: typecheck clean; lint 0 errors (6 pre-existing warnings); all tests pass with the repository integration tests skipped; build succeeds.

- [ ] **Step 4: Verify the demo board in a browser**

Demo mode is the only mode verifiable without a database. Start the dev server with `VITE_ENABLE_DEMO_AUTH=true`, sign in as the demo Admin, and confirm:

- `/annual-returns` still shows the demo board with all eleven columns.
- Clicking **Open** on a row still reaches the demo detail screen — this is the `<Outlet />` guard working through the new branch.

State plainly in the final report that the production board's data path was **not** exercised in a browser, and that the `visibleToUserId` SQL clause was **not** executed, because no `DATABASE_URL` was available.

- [ ] **Step 5: Commit**

```bash
git add src/routes/-production-authorization.test.ts
git commit -m "test(annual-returns): ban demo store imports in the production board"
```

---

## Definition Of Done

1. In production mode `/annual-returns` lists real cases from `listAnnualReturnCases`, and every row links to a case id the detail screen accepts.
2. In production mode `/annual-returns/<uuid>` still renders the production detail screen, proven by a test at `dataMode: "production"`.
3. A Staff actor's list call carries `teamId` and `visibleToUserId`, matching what `getAnnualReturnActionPermission` will allow them to act on.
4. Filter state survives a reload and a return from a detail screen.
5. With the database unreachable the board shows one fixed message, never a raw `ECONNREFUSED`, and never the empty state at the same time.
6. Demo mode is unchanged: same board, same columns, same fixtures.
7. `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build` all clean.

## Known Limits To Report, Not Fix

- The `visibleToUserId` SQL clause runs only under `describe.skipIf(!databaseUrl)` and is unverified without a `DATABASE_URL`.
- The `<Outlet />` guard is exact string equality, so `/annual-returns/` with a trailing slash misses it. Pre-existing.
- `/whatsapp` reads `lib/app-data` fixtures with no `dataMode` branch and is still in production navigation. Same defect, out of scope.
- `annual-returns.$id.tsx` has no `params` validation, so `/annual-returns/ar-delta` in production renders a serialized `ZodError` as its error message.
- `annual-returns.tsx` keeps its top-level demo store import, because the demo body must stay in the file. Same as `payments.tsx`, `portal.tsx` and `whatsapp.automation.tsx`.
