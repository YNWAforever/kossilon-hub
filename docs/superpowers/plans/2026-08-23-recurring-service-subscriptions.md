# P1-8: Recurring Service Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track per-company recurring service subscriptions (Secretary,
Registered Office, Director Correspondence Address, Designated
Representative) with renewal dates, reminders, and a `/clients/$id` UI —
retiring the unused generic `service_packages` model — per
`docs/superpowers/specs/2026-08-23-recurring-service-subscriptions-design.md`.

**Architecture:** A new `src/features/service-subscriptions/` feature slice
(types, constants, repository, authorization, errors, server-fns), a new
`service_subscriptions`/`service_subscription_reminder_events` table pair,
reminder logic wired into the existing 5-minute maintenance cron alongside
P1-2's annual-return reminders, and a new section on the existing
`/clients/$id` page. `oneYearLater`/`daysBetween`/`dueMilestone` move from
their current feature-slice homes into `src/lib/` since two independent
features now need them, with re-exports so nothing else breaks.
`service_packages`/`companies.service_package_id` are fully retired.

**Tech Stack:** TanStack Start, Postgres via `postgres` (raw SQL), Zod,
Vitest, React 19.

---

## Task 1: Migration and schema.sql

**Files:**
- Create: `db/migrations/0018_recurring_service_subscriptions.sql`
- Modify: `src/server/db/schema.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0018: recurring service subscriptions and renewals (P1-8).
--
-- Retires service_packages (unnamed generic tiers, no dates, no renewal
-- logic) in favor of per-company subscriptions to four named services with
-- real catalogue fees, each independently renewable. See the design spec for
-- why this is a replacement, not an addition.

alter table companies drop column if exists service_package_id;
drop table if exists service_packages;

create table if not exists service_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  service_type text not null check (service_type in (
    'secretary', 'registered_office', 'director_correspondence_address', 'designated_representative'
  )),
  fee integer not null check (fee > 0),
  status text not null default 'Active' check (status in ('Active', 'Cancelled')),
  renewal_date date not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_subscriptions_one_per_type unique (company_id, service_type)
);

create index if not exists service_subscriptions_company_idx on service_subscriptions (company_id);
create index if not exists service_subscriptions_renewal_date_idx on service_subscriptions (renewal_date)
  where status = 'Active';

-- Mirrors annual_return_reminder_events exactly (see its own migration's
-- comment for why this needs to be a permanent record independent of
-- notification_outbox, which redacts rows after retention_until).
create table if not exists service_subscription_reminder_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references service_subscriptions(id) on delete cascade,
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, milestone)
);
```

- [ ] **Step 2: Update `schema.sql`**

Read the file first. Find the `service_packages` table and the
`companies.service_package_id` column (added by migration 0008) and remove
both — byte-for-byte matching the drops above. Insert the two new
`create table`/`create index` blocks (byte-identical to the migration)
immediately after the last table added by migration 0017
(`incorporation_checklist_items`'s index), before whatever follows it.

- [ ] **Step 3: Verify the migration/schema consistency gate**

Run: `npm run verify:firm -- --dry-run`
Expected: passes, including `migration-schema`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0018_recurring_service_subscriptions.sql src/server/db/schema.sql
git commit -m "feat: add service_subscriptions tables, retire service_packages"
```

---

## Task 2: Extract shared date math

**Files:**
- Create: `src/lib/date-math.ts`
- Create: `src/lib/date-math.test.ts`
- Modify: `src/features/incorporation/workflow.ts`
- Modify: `src/features/annual-return/workflow.ts`

Two independent feature slices (`service-subscriptions` and, already,
`annual-return`/`incorporation`) need `oneYearLater` and `daysBetween`. Both
are pure, stateless date math with zero dependencies on their current
feature's other code — move them to `src/lib/` rather than having
`service-subscriptions` reach into a peer feature slice.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { daysBetween, oneYearLater } from "./date-math";

describe("oneYearLater", () => {
  it("advances the year, keeping month and day", () => {
    expect(oneYearLater("2026-03-15")).toBe("2027-03-15");
  });

  it("handles a leap-year Feb 29 by rolling to Mar 1 the following (non-leap) year", () => {
    expect(oneYearLater("2028-02-29")).toBe("2029-03-01");
  });
});

describe("daysBetween", () => {
  it("returns a positive count when the end date is in the future", () => {
    expect(daysBetween("2026-08-01", "2026-08-11")).toBe(10);
  });

  it("returns a negative count when the end date is in the past", () => {
    expect(daysBetween("2026-08-11", "2026-08-01")).toBe(-10);
  });

  it("returns zero for the same date", () => {
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/date-math.test.ts`
Expected: FAIL — `./date-math` does not exist yet.

- [ ] **Step 3: Read the current implementations**

Read `src/features/incorporation/workflow.ts` (lines 19-28, `oneYearLater`)
and `src/features/annual-return/workflow.ts` (`daysBetween`, currently
around line 64) in full first — copy their exact logic, do not
reimplement from scratch.

- [ ] **Step 4: Write the implementation**

```ts
/**
 * The first calendar anniversary of a date. A genuine year increment, not
 * +365 days, since a flat day count is wrong across a leap year.
 */
export function oneYearLater(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const value = new Date(Date.UTC(year + 1, month - 1, day));
  return value.toISOString().slice(0, 10);
}

/** Whole days from `startDate` to `endDate`, negative when `endDate` is in the past. */
export function daysBetween(startDate: string, endDate: string): number {
  const start = Date.UTC(
    ...(startDate.slice(0, 10).split("-").map(Number) as [number, number, number]),
  );
  const end = Date.UTC(
    ...(endDate.slice(0, 10).split("-").map(Number) as [number, number, number]),
  );
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}
```

Note: `Date.UTC` takes a zero-indexed month; the destructured
`[year, month, day]` from an ISO date string has `month` as 1-indexed, so if
the real `daysBetween` in `annual-return/workflow.ts` subtracts 1 from month
before calling `Date.UTC`, copy that exact adjustment rather than the
snippet above verbatim — match the real file's behavior precisely, since
this step's whole point is a faithful move, not a rewrite.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/date-math.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Re-export from both original locations**

In `src/features/incorporation/workflow.ts`, replace the `oneYearLater`
function body with a re-export:

```ts
export { oneYearLater } from "@/lib/date-math";
```

Remove the now-duplicate implementation and its JSDoc comment. Leave
`isAllowedIntakeStatusTransition` untouched.

In `src/features/annual-return/workflow.ts`, find `daysBetween`'s
definition and replace it the same way:

```ts
export { daysBetween } from "@/lib/date-math";
```

Remove the now-duplicate implementation. Leave everything else in the file
(including `buildReminderDraft`, which calls `daysBetween`) untouched — the
re-export means its existing call keeps working with no further changes.

- [ ] **Step 7: Run the existing test suites for both re-exporting files**

Run: `npx vitest run src/features/incorporation/workflow.test.ts src/features/annual-return`
Expected: PASS, no regressions — these tests import `oneYearLater`/
`daysBetween` from their original relative paths (`"./workflow"`), which
still work because the re-export preserves the same export name.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/date-math.ts src/lib/date-math.test.ts src/features/incorporation/workflow.ts src/features/annual-return/workflow.ts
git commit -m "refactor: move oneYearLater/daysBetween to src/lib/date-math, re-export from their original homes"
```

---

## Task 3: Extract shared reminder cadence

**Files:**
- Create: `src/lib/reminder-cadence.ts`
- Create: `src/lib/reminder-cadence.test.ts`
- Modify: `src/features/annual-return/reminder-cadence.ts`
- Delete: `src/features/annual-return/reminder-cadence.test.ts` (moved, see Step 5)

Same reasoning as Task 2: `dueMilestone` is pure and now needed by two
feature slices.

- [ ] **Step 1: Read the current implementation and its test file in full**

Read `src/features/annual-return/reminder-cadence.ts` (exports
`ReminderMilestone`, `REMINDER_MILESTONES`, and `dueMilestone`, which
imports `daysBetween` from `"./workflow"`) and
`src/features/annual-return/reminder-cadence.test.ts` in full — copy both
exactly, do not reimplement.

- [ ] **Step 2: Create the shared module**

```ts
import { daysBetween } from "./date-math";

export type ReminderMilestone = "1_month" | "2_week" | "1_week";

export const REMINDER_MILESTONES: readonly ReminderMilestone[] = ["1_month", "2_week", "1_week"];

const MILESTONE_OFFSET_DAYS: Record<ReminderMilestone, number> = {
  "1_month": 30,
  "2_week": 14,
  "1_week": 7,
};

// Most urgent first: walking this order and returning the first due milestone
// means a case that becomes eligible late (e.g. created 10 days before its
// deadline) jumps straight to the nearest applicable milestone — 1_month and
// 2_week are never fired for it, with no separate "moot" bookkeeping needed.
// Derived from REMINDER_MILESTONES (rather than hand-duplicated in reverse) so
// the two lists can't drift apart if a milestone is ever added or removed.
const MILESTONES_BY_URGENCY: readonly ReminderMilestone[] = [...REMINDER_MILESTONES].reverse();

export function dueMilestone(
  deadline: string,
  today: string,
  firedMilestones: readonly ReminderMilestone[],
): ReminderMilestone | null {
  const daysRemaining = daysBetween(today, deadline);

  // The first (most urgent) milestone whose threshold is satisfied is the one
  // that determines this tick's outcome — fire it if it hasn't fired yet,
  // otherwise stop and return null immediately. Do NOT fall through to check a
  // less-urgent milestone: that would let a case whose most-urgent applicable
  // reminder already fired cascade into firing every remaining milestone, one
  // per subsequent cron tick.
  for (const milestone of MILESTONES_BY_URGENCY) {
    if (daysRemaining <= MILESTONE_OFFSET_DAYS[milestone]) {
      return firedMilestones.includes(milestone) ? null : milestone;
    }
  }

  return null;
}
```

This is a straight copy of the existing `reminder-cadence.ts` with one
change: the parameter renamed from `filingDueDate` to the more general
`deadline` (a subscription's `renewal_date` is not a "filing due date"), and
the `daysBetween` import now pointing at the sibling `./date-math` module
(created in Task 2) instead of `../annual-return/workflow`.

- [ ] **Step 3: Move the test file, updating call sites for the renamed parameter**

Create `src/lib/reminder-cadence.test.ts` with the exact same test bodies as
`src/features/annual-return/reminder-cadence.test.ts` (all 9 `it` blocks,
including the cascading-duplicate-milestone regression test) — the
parameter rename in Step 2 is positional, so no call site in the copied
tests needs to change, only the import path:

```ts
import { describe, expect, it } from "vitest";
import { dueMilestone } from "./reminder-cadence";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/reminder-cadence.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Replace the original with a re-export, delete the moved test**

Replace the entire contents of `src/features/annual-return/reminder-cadence.ts`
with:

```ts
export type { ReminderMilestone } from "@/lib/reminder-cadence";
export { REMINDER_MILESTONES, dueMilestone } from "@/lib/reminder-cadence";
```

Delete `src/features/annual-return/reminder-cadence.test.ts` — its coverage
now lives at `src/lib/reminder-cadence.test.ts`; leaving both would test the
same code twice under two different paths with no benefit.

- [ ] **Step 6: Run the annual-return suite to confirm nothing broke**

Run: `npx vitest run src/features/annual-return`
Expected: PASS — `annual-return/repository.ts` imports `dueMilestone`/
`ReminderMilestone` from `"./reminder-cadence"`, which still resolves via
the re-export.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/reminder-cadence.ts src/lib/reminder-cadence.test.ts src/features/annual-return/reminder-cadence.ts
git rm src/features/annual-return/reminder-cadence.test.ts
git commit -m "refactor: move dueMilestone to src/lib/reminder-cadence, re-export from annual-return"
```

---

## Task 4: Types and constants

**Files:**
- Create: `src/features/service-subscriptions/types.ts`
- Create: `src/features/service-subscriptions/constants.ts`

- [ ] **Step 1: Write the types**

```ts
export const SERVICE_TYPES = [
  "secretary",
  "registered_office",
  "director_correspondence_address",
  "designated_representative",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export type SubscriptionStatus = "Active" | "Cancelled";

export type ServiceSubscription = {
  id: string;
  companyId: string;
  serviceType: ServiceType;
  fee: number;
  status: SubscriptionStatus;
  renewalDate: string;
  cancelledAt: string | null;
};

export type AddSubscriptionInput = {
  companyId: string;
  serviceType: ServiceType;
  fee: number;
  renewalDate: string;
  actorId: string;
};

export type RenewSubscriptionInput = {
  subscriptionId: string;
  companyId: string;
  actorId: string;
};

export type CancelSubscriptionInput = {
  subscriptionId: string;
  companyId: string;
  actorId: string;
};

export type EvaluateRemindersResult = { sent: number; skipped: number };
```

- [ ] **Step 2: Write the fixed service catalogue**

```ts
import type { ServiceType } from "./types";

/**
 * Standard annual fees (HKD). Used as the default when adding a
 * subscription; the fee is then a normal editable column, not derived live
 * from this table on every read — matches how payments.amount works despite
 * having a "standard" expectation elsewhere.
 */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  secretary: "Company Secretary",
  registered_office: "Registered Office",
  director_correspondence_address: "Director Correspondence Address",
  designated_representative: "Designated Representative",
};

export const SERVICE_TYPE_DEFAULT_FEES: Record<ServiceType, number> = {
  secretary: 2800,
  registered_office: 2800,
  director_correspondence_address: 1000,
  designated_representative: 2000,
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean — nothing else references this new module yet.

- [ ] **Step 4: Commit**

```bash
git add src/features/service-subscriptions/types.ts src/features/service-subscriptions/constants.ts
git commit -m "feat: add service subscription types and fixed catalogue"
```

---

## Task 5: Errors and authorization

**Files:**
- Create: `src/features/service-subscriptions/errors.ts`
- Create: `src/features/service-subscriptions/authorization.ts`

Read `src/features/clients/errors.ts` and `src/features/clients/authorization.ts`
in full first — this task mirrors both closely.

- [ ] **Step 1: Write the constraint-violation translator**

```ts
export type ServiceSubscriptionWriteField = "serviceType";

/** A database constraint violation translated into a message for a specific form field. */
export class ServiceSubscriptionWriteError extends Error {
  readonly field: ServiceSubscriptionWriteField;

  constructor(field: ServiceSubscriptionWriteField, message: string) {
    super(message);
    this.name = "ServiceSubscriptionWriteError";
    this.field = field;
  }
}

const CONSTRAINT_FIELDS: Record<string, { field: ServiceSubscriptionWriteField; message: string }> = {
  service_subscriptions_one_per_type: {
    field: "serviceType",
    message: "This company already has an active subscription for that service.",
  },
};

const HANDLED_CODES = new Set(["23505", "23514"]);

export function toServiceSubscriptionWriteError(error: unknown): ServiceSubscriptionWriteError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const { code, constraint_name: constraintName } = error as Error & {
    code?: string;
    constraint_name?: string;
  };

  if (!code || !constraintName || !HANDLED_CODES.has(code)) {
    return null;
  }

  const mapping = CONSTRAINT_FIELDS[constraintName];

  if (!mapping) {
    return null;
  }

  return new ServiceSubscriptionWriteError(mapping.field, mapping.message);
}

/** Rethrows a recognised constraint violation, otherwise rethrows as-is. */
export function rethrowServiceSubscriptionWriteError(error: unknown): never {
  const mapped = toServiceSubscriptionWriteError(error);

  if (mapped) {
    throw mapped;
  }

  throw error;
}
```

- [ ] **Step 2: Write the authorization module**

```ts
import type { AuthenticatedActor } from "@/features/auth/types";

export type ServiceSubscriptionCompanyTeam = { assignedTeamId: string };

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export function assertServiceSubscriptionWritable(
  actor: AuthenticatedActor,
  company: ServiceSubscriptionCompanyTeam,
): void {
  if (!actor.active) {
    throw forbidden("inactive users cannot change service subscriptions.");
  }

  if (actor.role === "Client") {
    throw forbidden("staff access is required.");
  }

  if (actor.role === "Admin") return;

  if (!actor.teamId) {
    throw forbidden("staff actor has no assigned team.");
  }

  if (actor.teamId !== company.assignedTeamId) {
    throw forbidden("this company belongs to another team.");
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/service-subscriptions/errors.ts src/features/service-subscriptions/authorization.ts
git commit -m "feat: add service subscription errors and authorization"
```

---

## Task 6: Repository

**Files:**
- Create: `src/features/service-subscriptions/repository.ts`

Read `src/features/clients/repository.ts` lines 1-70 (the `ClientRepository`
factory shape: overloaded `createClientRepository`, `QueryClient`/
`TransactionSqlClient` types, `withTransaction`) first — this task's
repository factory mirrors that shape exactly, just for a much smaller
surface.

- [ ] **Step 1: Write the repository**

```ts
import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { oneYearLater } from "@/lib/date-math";
import { rethrowServiceSubscriptionWriteError } from "./errors";
import type {
  AddSubscriptionInput,
  CancelSubscriptionInput,
  RenewSubscriptionInput,
  ServiceSubscription,
  ServiceType,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type CreateServiceSubscriptionRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type ServiceSubscriptionRepository = {
  listSubscriptions(companyId: string): Promise<ServiceSubscription[]>;
  getCompanyTeamId(companyId: string): Promise<string | null>;
  addSubscription(input: AddSubscriptionInput): Promise<ServiceSubscription>;
  renewSubscription(input: RenewSubscriptionInput): Promise<ServiceSubscription>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<ServiceSubscription>;
  close(): Promise<void>;
};

type SubscriptionRow = {
  id: string;
  company_id: string;
  service_type: ServiceType;
  fee: number;
  status: "Active" | "Cancelled";
  renewal_date: string | Date;
  cancelled_at: string | Date | null;
};

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapSubscription(row: SubscriptionRow): ServiceSubscription {
  return {
    id: row.id,
    companyId: row.company_id,
    serviceType: row.service_type,
    fee: row.fee,
    status: row.status,
    renewalDate: dateOnly(row.renewal_date),
    cancelledAt: row.cancelled_at ? timestampString(row.cancelled_at) : null,
  };
}

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: TransactionSqlClient) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return client.begin(handler) as Promise<T>;
  }

  return handler(client as TransactionSqlClient);
}

export function createServiceSubscriptionRepository(
  options?: CreateServiceSubscriptionRepositoryOptions,
): ServiceSubscriptionRepository;
export function createServiceSubscriptionRepository(
  databaseUrl: string | undefined,
  options?: CreateServiceSubscriptionRepositoryOptions,
): ServiceSubscriptionRepository;
export function createServiceSubscriptionRepository(
  databaseUrlOrOptions?: string | CreateServiceSubscriptionRepositoryOptions,
  maybeOptions?: CreateServiceSubscriptionRepositoryOptions,
): ServiceSubscriptionRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function listSubscriptions(companyId: string): Promise<ServiceSubscription[]> {
    const rows = await sql<SubscriptionRow[]>`
      select id, company_id, service_type, fee, status, renewal_date, cancelled_at
      from service_subscriptions
      where company_id = ${companyId}
      order by service_type asc
    `;
    return rows.map(mapSubscription);
  }

  async function getCompanyTeamId(companyId: string): Promise<string | null> {
    const rows = await sql<{ assigned_team_id: string }[]>`
      select assigned_team_id from companies where id = ${companyId} limit 1
    `;
    return rows[0]?.assigned_team_id ?? null;
  }

  async function assertActor(tx: TransactionSqlClient, actorId: string): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from users where id = ${actorId} and active limit 1
    `;
    if (rows.length === 0) throw new Error("Service subscription actor not found or inactive.");
  }

  async function hydrateOne(
    client: QueryClient,
    companyId: string,
    serviceType: ServiceType,
  ): Promise<ServiceSubscription> {
    const rows = await client<SubscriptionRow[]>`
      select id, company_id, service_type, fee, status, renewal_date, cancelled_at
      from service_subscriptions
      where company_id = ${companyId} and service_type = ${serviceType}
      limit 1
    `;
    const [row] = rows;
    if (!row) throw new Error("Service subscription not found.");
    return mapSubscription(row);
  }

  async function hydrateById(client: QueryClient, subscriptionId: string): Promise<ServiceSubscription> {
    const rows = await client<SubscriptionRow[]>`
      select id, company_id, service_type, fee, status, renewal_date, cancelled_at
      from service_subscriptions
      where id = ${subscriptionId}
      limit 1
    `;
    const [row] = rows;
    if (!row) throw new Error("Service subscription not found.");
    return mapSubscription(row);
  }

  async function addSubscription(input: AddSubscriptionInput): Promise<ServiceSubscription> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);

        const existing = await tx<{ id: string; status: "Active" | "Cancelled" }[]>`
          select id, status from service_subscriptions
          where company_id = ${input.companyId} and service_type = ${input.serviceType}
          limit 1
        `;

        if (existing[0]) {
          // Reactivating a cancelled row for this (company, service_type) —
          // the unique constraint means there is at most one row per pair,
          // ever, so "add" on an existing cancelled row updates it in place
          // rather than trying (and failing) to insert a second one.
          await tx`
            update service_subscriptions
            set status = 'Active', fee = ${input.fee}, renewal_date = ${input.renewalDate},
                cancelled_at = null, updated_at = now()
            where id = ${existing[0].id}
          `;
        } else {
          await tx`
            insert into service_subscriptions (company_id, service_type, fee, renewal_date)
            values (${input.companyId}, ${input.serviceType}, ${input.fee}, ${input.renewalDate})
          `;
        }

        return hydrateOne(tx, input.companyId, input.serviceType);
      });
    } catch (error) {
      rethrowServiceSubscriptionWriteError(error);
    }
  }

  async function renewSubscription(input: RenewSubscriptionInput): Promise<ServiceSubscription> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      const current = await hydrateById(tx, input.subscriptionId);
      if (current.status !== "Active") {
        throw new Error("Cannot renew a subscription that is not Active.");
      }

      const nextRenewalDate = oneYearLater(current.renewalDate);

      await tx`
        update service_subscriptions
        set renewal_date = ${nextRenewalDate}, updated_at = now()
        where id = ${input.subscriptionId}
      `;

      return hydrateById(tx, input.subscriptionId);
    });
  }

  async function cancelSubscription(input: CancelSubscriptionInput): Promise<ServiceSubscription> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      const current = await hydrateById(tx, input.subscriptionId);
      if (current.status !== "Active") {
        throw new Error("Cannot cancel a subscription that is not Active.");
      }

      await tx`
        update service_subscriptions
        set status = 'Cancelled', cancelled_at = now(), updated_at = now()
        where id = ${input.subscriptionId}
      `;

      return hydrateById(tx, input.subscriptionId);
    });
  }

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) await sql.end();
  }

  return {
    listSubscriptions,
    getCompanyTeamId,
    addSubscription,
    renewSubscription,
    cancelSubscription,
    close,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/service-subscriptions/repository.ts
git commit -m "feat: add service subscription repository"
```

---

## Task 7: Repository integration tests

**Files:**
- Create: `src/features/service-subscriptions/repository.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createServiceSubscriptionRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for service subscription integration tests.");
  }
  return createSqlClient(databaseUrl, { max: 1 });
}

describe.skipIf(!databaseUrl)("service subscriptions integration", () => {
  it("adds a subscription with the given fee and renewal date", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2800,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          expect(created.status).toBe("Active");
          expect(created.fee).toBe(2800);
          expect(created.renewalDate).toBe("2027-01-01");
          expect(created.cancelledAt).toBeNull();

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("rejects adding a second active subscription for the same service type", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          await repository.addSubscription({
            companyId: company.id,
            serviceType: "registered_office",
            fee: 2800,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          await expect(
            repository.addSubscription({
              companyId: company.id,
              serviceType: "registered_office",
              fee: 2800,
              renewalDate: "2027-06-01",
              actorId: owner.id,
            }),
          ).rejects.toThrow("This company already has an active subscription for that service.");

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("renews by advancing exactly one year from the current renewal date", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "director_correspondence_address",
            fee: 1000,
            renewalDate: "2026-08-01",
            actorId: owner.id,
          });

          const renewed = await repository.renewSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          });

          expect(renewed.renewalDate).toBe("2027-08-01");

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("cancels a subscription and rejects renewing or cancelling it again", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "designated_representative",
            fee: 2000,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          const cancelled = await repository.cancelSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          });

          expect(cancelled.status).toBe("Cancelled");
          expect(cancelled.cancelledAt).not.toBeNull();

          await expect(
            repository.cancelSubscription({
              subscriptionId: created.id,
              companyId: company.id,
              actorId: owner.id,
            }),
          ).rejects.toThrow("Cannot cancel a subscription that is not Active.");

          await expect(
            repository.renewSubscription({
              subscriptionId: created.id,
              companyId: company.id,
              actorId: owner.id,
            }),
          ).rejects.toThrow("Cannot renew a subscription that is not Active.");

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("reactivates a cancelled subscription in place rather than inserting a second row", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createServiceSubscriptionRepository({ sql: tx });

          const [company] = await tx<{ id: string }[]>`select id from companies limit 1`;
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;

          const created = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2800,
            renewalDate: "2027-01-01",
            actorId: owner.id,
          });

          await repository.cancelSubscription({
            subscriptionId: created.id,
            companyId: company.id,
            actorId: owner.id,
          });

          const reactivated = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2900,
            renewalDate: "2028-01-01",
            actorId: owner.id,
          });

          expect(reactivated.id).toBe(created.id);
          expect(reactivated.status).toBe("Active");
          expect(reactivated.fee).toBe(2900);
          expect(reactivated.renewalDate).toBe("2028-01-01");
          expect(reactivated.cancelledAt).toBeNull();

          const all = await repository.listSubscriptions(company.id);
          expect(all.filter((row) => row.serviceType === "secretary")).toHaveLength(1);

          throw new Error("rollback service subscription integration fixture");
        }),
      ).rejects.toThrow("rollback service subscription integration fixture");
    } finally {
      await sql.end();
    }
  });
});
```

Note: every test rolls back via `sql.begin(...).rejects.toThrow(...)`, the
same self-cleaning pattern used elsewhere in this codebase for tests that
don't need cross-connection concurrency — no `on delete restrict` FK is
involved here (`service_subscriptions.company_id` cascades), so there is no
teardown-ordering hazard like incorporation's `completeCase` tests have.

- [ ] **Step 2: Format, lint, and run**

```bash
npx eslint --fix src/features/service-subscriptions/repository.test.ts
npx vitest run src/features/service-subscriptions/repository.test.ts
```
Expected: skipped locally (no `TEST_DATABASE_URL`), no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/service-subscriptions/repository.test.ts
git commit -m "test: add service subscription repository integration tests"
```

---

## Task 8: Server functions

**Files:**
- Create: `src/features/service-subscriptions/server-fns.ts`

Read `src/features/incorporation/server-fns.ts` in full first — this task's
`loadDefaultServiceSubscriptionContext`/`requireWritableCompany`/
`withServiceSubscriptionRepository` pattern mirrors it closely.

- [ ] **Step 1: Write the server functions**

```ts
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertServiceSubscriptionWritable } from "./authorization";
import type { ServiceSubscriptionRepository } from "./repository";
import { SERVICE_TYPES } from "./types";

const loadDefaultServiceSubscriptionContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createServiceSubscriptionRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  return { getRequest, requireStaffActor, createServiceSubscriptionRepository };
});

async function getCurrentServiceSubscriptionActor(): Promise<AuthenticatedActor & { userId: string }> {
  const { getRequest, requireStaffActor } = await loadDefaultServiceSubscriptionContext();
  const actor = await requireStaffActor(getRequest());

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}

async function requireWritableCompany(
  repository: ServiceSubscriptionRepository,
  companyId: string,
): Promise<string> {
  const actor = await getCurrentServiceSubscriptionActor();
  const assignedTeamId = await repository.getCompanyTeamId(companyId);

  if (!assignedTeamId) {
    throw new Error("Company not found.");
  }

  assertServiceSubscriptionWritable(actor, { assignedTeamId });
  return actor.userId;
}

async function withServiceSubscriptionRepository<T>(
  handler: (repository: ServiceSubscriptionRepository) => Promise<T>,
): Promise<T> {
  const { createServiceSubscriptionRepository } = await loadDefaultServiceSubscriptionContext();
  const repository = createServiceSubscriptionRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

const listSubscriptionsSchema = z.object({ companyId: z.string().uuid() });

const addSubscriptionSchema = z.object({
  companyId: z.string().uuid(),
  serviceType: z.enum(SERVICE_TYPES),
  fee: z.number().int().positive(),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const renewSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  companyId: z.string().uuid(),
});

const cancelSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const listServiceSubscriptions = createServerFn({ method: "GET" })
  .validator(listSubscriptionsSchema)
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultServiceSubscriptionContext();
    await requireStaffActor(getRequest());
    return withServiceSubscriptionRepository((repository) =>
      repository.listSubscriptions(data.companyId),
    );
  });

export const addServiceSubscription = createServerFn({ method: "POST" })
  .validator(addSubscriptionSchema)
  .handler(async ({ data }) =>
    withServiceSubscriptionRepository(async (repository) =>
      repository.addSubscription({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const renewServiceSubscription = createServerFn({ method: "POST" })
  .validator(renewSubscriptionSchema)
  .handler(async ({ data }) =>
    withServiceSubscriptionRepository(async (repository) =>
      repository.renewSubscription({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const cancelServiceSubscription = createServerFn({ method: "POST" })
  .validator(cancelSubscriptionSchema)
  .handler(async ({ data }) =>
    withServiceSubscriptionRepository(async (repository) =>
      repository.cancelSubscription({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/service-subscriptions/server-fns.ts
git commit -m "feat: add service subscription server functions"
```

---

## Task 9: Reminders

**Files:**
- Modify: `src/features/service-subscriptions/repository.ts`
- Create: `src/features/service-subscriptions/reminder-draft.ts`
- Create: `src/features/service-subscriptions/reminder-draft.test.ts`
- Modify: `src/server/maintenance.ts`

Read `src/features/annual-return/repository.ts`'s `evaluateReminders`
(currently around lines 1882-2009) in full first — this task's
`evaluateServiceSubscriptionReminders` mirrors its locking, skip-logging,
and outbox-enqueue shape closely, adapted for subscriptions (no case-status
progression to worry about, `Cancelled` plays the role `Filed`/`Completed`
play for annual-return cases).

- [ ] **Step 1: Write the Traditional Chinese draft builder**

```ts
import { daysBetween } from "@/lib/date-math";
import { SERVICE_TYPE_LABELS } from "./constants";
import type { ServiceSubscription } from "./types";

export function buildServiceSubscriptionReminderDraft(
  subscription: ServiceSubscription,
  companyName: string,
  contactName: string,
  today: string,
): string {
  const daysRemaining = daysBetween(today, subscription.renewalDate);
  const daysRemainingText =
    daysRemaining >= 0 ? `距離現時尚餘 ${daysRemaining} 天` : `已逾期 ${-daysRemaining} 天`;
  const serviceLabel = SERVICE_TYPE_LABELS[subscription.serviceType];

  return [
    `${contactName} 您好，我是高仕輪企業服務。`,
    `提提您，${companyName} 的${serviceLabel}服務將於 ${subscription.renewalDate} 到期，${daysRemainingText}，續期費用為 HK$${subscription.fee.toLocaleString()}。`,
    "如需續期，請回覆此訊息或聯絡我們安排付款，我們將為貴公司繼續提供服務。",
    "如有任何疑問，歡迎隨時聯絡我們。",
    "高仕輪企業服務",
  ].join("\n\n");
}
```

- [ ] **Step 2: Write the draft builder test**

```ts
import { describe, expect, it } from "vitest";
import { buildServiceSubscriptionReminderDraft } from "./reminder-draft";
import type { ServiceSubscription } from "./types";

describe("buildServiceSubscriptionReminderDraft", () => {
  const subscription: ServiceSubscription = {
    id: "sub-1",
    companyId: "company-1",
    serviceType: "designated_representative",
    fee: 2000,
    status: "Active",
    renewalDate: "2026-09-15",
    cancelledAt: null,
  };

  it("names the service, fee, and days remaining when the renewal is upcoming", () => {
    const draft = buildServiceSubscriptionReminderDraft(
      subscription,
      "Harbour Trading Ltd",
      "Amy",
      "2026-08-16",
    );
    expect(draft).toContain("Harbour Trading Ltd");
    expect(draft).toContain("Designated Representative");
    expect(draft).toContain("2026-09-15");
    expect(draft).toContain("HK$2,000");
    expect(draft).toContain("距離現時尚餘 30 天");
  });

  it("reports overdue days when the renewal date has already passed", () => {
    const draft = buildServiceSubscriptionReminderDraft(
      subscription,
      "Harbour Trading Ltd",
      "Amy",
      "2026-09-20",
    );
    expect(draft).toContain("已逾期 5 天");
  });
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run src/features/service-subscriptions/reminder-draft.test.ts`
Expected: PASS, both tests.

- [ ] **Step 4: Add `evaluateReminders` to the repository**

In `src/features/service-subscriptions/repository.ts`, add these imports at
the top:

```ts
import { dueMilestone, type ReminderMilestone } from "@/lib/reminder-cadence";
import { enqueueNotification } from "@/features/notifications/outbox";
import { hongKongBusinessDate } from "@/lib/hong-kong-time";
import { buildServiceSubscriptionReminderDraft } from "./reminder-draft";
import type { EvaluateRemindersResult } from "./types";
```

Read `src/components/deadline-pill.tsx`'s `hongKongBusinessDate` function
first — it is currently local to that file, not exported. Check whether
`src/lib/hong-kong-time.ts` already exists (grep the repo for
`hongKongBusinessDate` across `src/`); if it does not, extract it there the
same way Task 2 extracted `oneYearLater`/`daysBetween` (a small, targeted
move — the function is pure, needed here and in `deadline-pill.tsx`, and
this is exactly the class of shared-pure-logic duplication this plan has
already fixed twice), and re-export from `deadline-pill.tsx` so its
existing usage is unaffected.

Add `evaluateReminders` as a new method inside `createServiceSubscriptionRepository`,
before the `return { ... }` block:

```ts
  async function evaluateReminders(now: string = hongKongBusinessDate()): Promise<EvaluateRemindersResult> {
    const candidates = await sql<
      { id: string; company_id: string; company_name: string; renewal_date: string }[]
    >`
      select ss.id, ss.company_id, c.company_name, ss.renewal_date::text
      from service_subscriptions ss
      join companies c on c.id = ss.company_id
      where ss.status = 'Active'
        and ss.renewal_date <= (${now}::date + interval '30 days')
    `;

    let sent = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const outcome = await withTransaction(sql, async (tx) => {
        const lockedRows = await tx<{ id: string; status: "Active" | "Cancelled" }[]>`
          select id, status from service_subscriptions where id = ${candidate.id} for update
        `;
        const locked = lockedRows[0];
        // Re-check under lock: a subscription cancelled by staff while this
        // sweep was still processing an earlier row must not receive a
        // reminder for a service that's no longer active — the same race
        // annual-return's evaluateReminders guards against for a case
        // marked Filed mid-sweep.
        if (!locked || locked.status !== "Active") return null;

        const firedRows = await tx<{ milestone: ReminderMilestone }[]>`
          select milestone from service_subscription_reminder_events where subscription_id = ${candidate.id}
        `;
        const milestone = dueMilestone(
          candidate.renewal_date,
          now,
          firedRows.map((row) => row.milestone),
        );
        if (!milestone) return null;

        const insertedEvent = await tx<{ id: string }[]>`
          insert into service_subscription_reminder_events (subscription_id, milestone, occurred_at)
          values (${candidate.id}, ${milestone}, ${now})
          on conflict (subscription_id, milestone) do nothing
          returning id
        `;
        if (!insertedEvent[0]) return null;

        const contactRows = await tx<
          { name: string; email: string | null; phone: string | null }[]
        >`
          select name, email, phone from company_contacts
          where company_id = ${candidate.company_id} and is_primary = true
          limit 1
        `;
        const contact = contactRows[0];

        if (!contact) {
          await tx`
            insert into timeline_events (
              company_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${candidate.company_id}, 'service_subscription_reminder_skipped',
              'system', null, 'Automated reminder skipped: no primary contact on file.',
              ${tx.json({ subscriptionId: candidate.id, milestone, reason: "no_primary_contact" })}
            )
          `;
          return "skipped" as const;
        }

        const channel: "whatsapp" | "email" = contact.phone ? "whatsapp" : "email";
        const recipient = contact.phone ?? contact.email;

        if (!recipient) {
          await tx`
            insert into timeline_events (
              company_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${candidate.company_id}, 'service_subscription_reminder_skipped',
              'system', null, 'Automated reminder skipped: primary contact has neither phone nor email.',
              ${tx.json({ subscriptionId: candidate.id, milestone, reason: "unreachable_primary_contact" })}
            )
          `;
          return "skipped" as const;
        }

        const fullRows = await tx<SubscriptionRow[]>`
          select id, company_id, service_type, fee, status, renewal_date, cancelled_at
          from service_subscriptions where id = ${candidate.id}
        `;
        const subscription = mapSubscription(fullRows[0]);

        await enqueueNotification(tx, {
          companyId: candidate.company_id,
          channel,
          notificationType: `service_subscription_reminder_${milestone}`,
          recipient,
          payload: {
            subscriptionId: candidate.id,
            milestone,
            subject: `「${candidate.company_name}」服務續期提醒`,
            body: buildServiceSubscriptionReminderDraft(subscription, candidate.company_name, contact.name, now),
          },
        });

        await tx`
          insert into timeline_events (
            company_id, event_type, actor_type, actor_id, description, metadata
          ) values (
            ${candidate.company_id}, 'service_subscription_reminder_sent',
            'system', null, 'Automated reminder sent.',
            ${tx.json({ subscriptionId: candidate.id, milestone, channel })}
          )
        `;

        return "sent" as const;
      });

      if (outcome === "sent") sent += 1;
      else if (outcome === "skipped") skipped += 1;
    }

    return { sent, skipped };
  }
```

Note: this fetches the subscription's full row a second time (`fullRows`)
right before building the reminder draft, rather than threading
`service_type`/`fee` through from the initial `candidates` query. This is a
deliberate, minor inefficiency traded for simplicity — the initial query
only needs enough to decide which rows are due, and the second fetch only
runs for rows that survive the lock-recheck and dedup checks (a small
minority of `candidates` on any given sweep). If profiling ever shows this
matters, select `service_type`/`fee` directly in the initial query instead
— do not add that optimization speculatively now.

Add `evaluateReminders` to the `ServiceSubscriptionRepository` type and the
returned object, alongside the other methods.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Add integration test coverage for the reminder sweep**

Append to `src/features/service-subscriptions/repository.test.ts` (inside
the existing `describe.skipIf(!databaseUrl)` block):

```ts
  it("fires a reminder once per milestone and never again after cancellation", async () => {
    const setupSql = sqlForTests();
    let subscriptionId: string | undefined;

    try {
      const repository = createServiceSubscriptionRepository({ sql: setupSql });
      const [company] = await setupSql<{ id: string }[]>`select id from companies limit 1`;
      const [owner] = await setupSql<{ id: string }[]>`select id from users where active limit 1`;

      const created = await repository.addSubscription({
        companyId: company.id,
        serviceType: "secretary",
        fee: 2800,
        renewalDate: "2026-09-12",
        actorId: owner.id,
      });
      subscriptionId = created.id;

      await repository.evaluateReminders("2026-08-13");

      const fired = await setupSql<{ milestone: string }[]>`
        select milestone from service_subscription_reminder_events where subscription_id = ${created.id}
      `;
      // A primary contact may or may not exist on the seeded fixture company —
      // either way, re-running the same day must not fire a second event for
      // the same milestone (sent -> gating row exists; skipped -> nothing to
      // dedupe against, so re-run count must match exactly).
      await repository.evaluateReminders("2026-08-13");
      const firedAfterSecond = await setupSql<{ milestone: string }[]>`
        select milestone from service_subscription_reminder_events where subscription_id = ${created.id}
      `;
      expect(firedAfterSecond).toHaveLength(fired.length);

      await repository.cancelSubscription({
        subscriptionId: created.id,
        companyId: company.id,
        actorId: owner.id,
      });

      await repository.evaluateReminders("2026-08-29");
      const firedAfterCancel = await setupSql<{ milestone: string }[]>`
        select milestone from service_subscription_reminder_events where subscription_id = ${created.id}
      `;
      // Cancelling stops future milestones from ever firing — no new rows
      // appear for this subscription after cancellation, even though 2_week
      // would otherwise be due by 2026-08-29.
      expect(firedAfterCancel).toHaveLength(fired.length);
    } finally {
      if (subscriptionId) {
        await setupSql`delete from service_subscription_reminder_events where subscription_id = ${subscriptionId}`;
        await setupSql`delete from service_subscriptions where id = ${subscriptionId}`;
      }
      await setupSql.end();
    }
  });
```

- [ ] **Step 7: Format, lint, run**

```bash
npx eslint --fix src/features/service-subscriptions
npx vitest run src/features/service-subscriptions
```
Expected: all new tests pass or skip cleanly (integration tests skip
without `TEST_DATABASE_URL`); `reminder-draft.test.ts` runs and passes
unconditionally (no DB needed).

- [ ] **Step 8: Wire into the maintenance cron**

Read `src/server/maintenance.ts` in full first — this mirrors how the
existing annual-return reminder sweep and SLA escalation sweep are already
wired into `runFirmMaintenanceWithDependencies`. Add a new dynamic import
for the service-subscriptions repository alongside the existing ones in
`runFirmMaintenance`'s `Promise.all`, and call `evaluateReminders()` on it
inside the function body, following the exact same "import module, call
its factory, invoke the sweep, fold the result into the returned summary"
shape the existing annual-return reminder call already uses in this file.
The exact insertion point and the summary object's shape both depend on
this file's current content — read it in full now rather than guessing.

- [ ] **Step 9: Run the maintenance test suite**

Run: `npx vitest run src/server/maintenance.test.ts`
Expected: PASS. If the existing tests assert an exact shape for
`runFirmMaintenance`'s return value (e.g. a fixed set of keys), extend
those assertions to include the new service-subscription sweep's
sent/skipped counts, following whatever naming convention the existing
annual-return/escalation counts already use in that return shape.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add src/features/service-subscriptions src/server/maintenance.ts src/lib/hong-kong-time.ts src/components/deadline-pill.tsx
git commit -m "feat: add service subscription reminder sweep, wire into maintenance cron"
```

(Omit `src/lib/hong-kong-time.ts`/`deadline-pill.tsx` from this commit if
Step 4's grep found `hongKongBusinessDate` already shared and no extraction
was needed.)

---

## Task 10: Retire `service_packages` from the clients feature

**Files:**
- Modify: `src/features/clients/types.ts`
- Modify: `src/features/clients/repository.ts`
- Modify: `src/features/clients/repository.test.ts`
- Modify: `src/features/clients/server-fns.ts`

This is a mechanical removal, verified by the compiler rather than
hand-checked line by line — `packageId`/`packageName`/`ServicePackage`/
`servicePackages`/`PackageRow`/`mapPackage`/`listServicePackages` all
disappear together, and `npx tsc --noEmit` will surface every remaining
reference as an error.

- [ ] **Step 1: `src/features/clients/types.ts`**

Delete the `ServicePackage` type (lines 5-12). Remove `packageId: string |
null;` and `packageName: string | null;` from `ClientSummary`. Remove
`packages: ServicePackage[];` from `ClientAssignmentOptions`. Remove
`packageId: string | null;` from `CreateClientInput` and `UpdateClientInput`.

- [ ] **Step 2: `src/features/clients/repository.ts`**

- Remove the `ServicePackage` import from `"./types"`.
- Delete the `PackageRow` type (around line 153) and `mapPackage` function
  (around line 189).
- Delete `listServicePackages` from the `ClientRepository` type (line 51)
  and its implementation (around line 315), and remove it from the
  returned object at the end of the file (line 1246).
- In `listAssignmentOptions`: change `const [owners, teams, packages] =
  await Promise.all([...])` to `const [owners, teams] = await
  Promise.all([...])`, removing the `listServicePackages()` call from the
  array, and remove `packages,` from the returned object.
- In `mapSummary`: remove the `packageId: row.service_package_id,
  packageName: row.package_name,` lines.
- In `SummaryRow`: remove `service_package_id: string | null;` and
  `package_name: string | null;`.
- In `listClients`'s SQL: remove `c.service_package_id,` and `sp.name as
  package_name,` from the `select` list, and remove `left join
  service_packages sp on sp.id = c.service_package_id` from the `from`
  clause.
- Do the identical removal in `hydrateClient`'s SQL (the same three lines,
  duplicated for the detail query).
- In `createClient`'s insert: remove `service_package_id` from the column
  list and `${input.packageId}` from the values list.
- In `changedFields`: remove the `["packageId", before.packageId,
  input.packageId],` comparison tuple.
- In `updateClient`'s update statement: remove `service_package_id =
  ${input.packageId},`.

- [ ] **Step 3: `src/features/clients/server-fns.ts`**

Remove `packageId: z.string().uuid().nullable(),` from both
`createClientSchema` and `updateClientSchema`.

- [ ] **Step 4: `src/features/clients/repository.test.ts`**

Read the file first. Remove the `packageId`/`PACKAGE_BASIC_ID`/
`PACKAGE_STANDARD_ID` fixture helper options and every `packageId: ...`/
`packageName: ...` property from expected-object assertions (grep the file
for `[Pp]ackage` — there are roughly 20 occurrences per the investigation
during planning). Remove the two `it(...)` blocks that specifically test
`listServicePackages`/`options.packages` (currently titled "lists seeded
service packages in sort order" and covering the `packages` field inside
"returns owners, teams, and packages for assignment forms" — narrow that
second test's name and body to just owners/teams once the packages
assertion is gone, do not delete the whole test if it also covers
owners/teams).

- [ ] **Step 5: Typecheck — this is the real verification for this task**

Run: `npx tsc --noEmit`
Expected: initially FAILS, listing every remaining reference to the removed
types/fields/functions across the repo (including the UI files handled in
Task 11, which have not been touched yet). Fix `clients/repository.test.ts`
until every error inside that file specifically is gone; errors in UI
components are expected at this point and get fixed in Task 11.

- [ ] **Step 6: Run the clients test suite**

Run: `npx vitest run src/features/clients/repository.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/clients/types.ts src/features/clients/repository.ts src/features/clients/repository.test.ts src/features/clients/server-fns.ts
git commit -m "refactor: remove service_packages from the clients feature"
```

---

## Task 11: Retire `service_packages` from the UI

**Files:**
- Modify: `src/components/clients/client-form-dialog.tsx`
- Modify: `src/features/clients/components/production-client-detail.tsx`
- Modify: `src/features/clients/components/production-client-register.tsx`
- Modify their `*.test.tsx`/`*.interaction.test.tsx` counterparts

- [ ] **Step 1: `client-form-dialog.tsx`**

Remove `packageId: string;` from `FormState`. Remove `packageId:
options.packages[0]?.id ?? "",` from `emptyForm`. Remove `packageId:
client.packageId ?? options.packages[0]?.id ?? "",` from `formFor`. Remove
`packageId: form.packageId || null,` from both the `updateClient` and
`createClient` calls inside `submit`. Delete the entire "Package" `<div>`
block (the `<select id="client-package">` field, currently the third
column in the owner/team/package grid) — change that grid from
`md:grid-cols-3` to `md:grid-cols-2` since it now holds only Owner and
Team.

- [ ] **Step 2: `production-client-detail.tsx`**

Change `Owner, team and package options are unavailable...` to `Owner and
team options are unavailable...`. Delete the `<Detail label="Package"
value={client.packageName ?? "No package"} />` line entirely.

- [ ] **Step 3: `production-client-register.tsx`**

Change `Owner, team and package options are unavailable...` to `Owner and
team options are unavailable...`. Delete the `<span>Package</span>` column
header. Delete the `<Field label="Package" value={client.packageName ??
"No package"} />` line. If the row grid's column count is derived from a
fixed template (e.g. a `grid-template-columns` matching the header count),
adjust it to match the now-one-fewer column, the same way Step 1 adjusted
`client-form-dialog.tsx`'s grid.

- [ ] **Step 4: Typecheck — confirms every UI reference is gone**

Run: `npx tsc --noEmit`
Expected: clean. If anything remains, it will name the exact file/line —
fix it before proceeding.

- [ ] **Step 5: Update the corresponding tests**

Read each `*.test.tsx`/`*.interaction.test.tsx` file for
`client-form-dialog.tsx`, `production-client-detail.tsx`, and
`production-client-register.tsx`. Remove any assertion that selects the
package `<select>`/renders "Package"/checks `options.packages`/passes a
`packages` array in test fixtures for `ClientAssignmentOptions`. Since
`ClientAssignmentOptions` no longer has a `packages` field (Task 10, Step
1), any test fixture object literal typed as `ClientAssignmentOptions` that
still includes `packages: [...]` is now a type error `tsc` will already
have caught in Step 4 if these test files are included in the typecheck —
confirm they are, then fix each one the compiler flags.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass, no failures, no skipped-that-should-run.

- [ ] **Step 7: Run lint**

Run: `npm run lint`
Expected: clean (only the pre-existing `work-queue.tsx` warning).

- [ ] **Step 8: Commit**

```bash
git add src/components/clients/client-form-dialog.tsx src/features/clients/components/production-client-detail.tsx src/features/clients/components/production-client-register.tsx
git add -u src/features/clients/components src/components/clients
git commit -m "refactor: remove service_packages UI from client form, detail, and register"
```

---

## Task 12: Subscriptions section on the client detail page

**Files:**
- Create: `src/features/clients/components/service-subscriptions-section.tsx`
- Create: `src/features/clients/components/service-subscriptions-section.test.tsx`
- Modify: `src/features/clients/components/production-client-detail.tsx`

Read `src/components/incorporation/create-incorporation-case-dialog.tsx` in
full first for the small-dialog loading/error/empty-state pattern this
task's add-subscription dialog mirrors, and re-read
`production-client-detail.tsx` in full (already partially read across
Tasks 10-11) to find where the Officers/Shareholders sections render, so
the new section is inserted at the position the spec calls for (after
Officers/Shareholders, before SCR/DR).

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeadlinePill } from "@/components/deadline-pill";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS } from "@/features/service-subscriptions/constants";
import type { ServiceType } from "@/features/service-subscriptions/types";
import {
  addServiceSubscription,
  cancelServiceSubscription,
  listServiceSubscriptions,
  renewServiceSubscription,
} from "@/features/service-subscriptions/server-fns";

type Props = { companyId: string };

function defaultRenewalDate(): string {
  const oneYearFromNow = new Date();
  oneYearFromNow.setUTCFullYear(oneYearFromNow.getUTCFullYear() + 1);
  return oneYearFromNow.toISOString().slice(0, 10);
}

export function ServiceSubscriptionsSection({ companyId }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["service-subscriptions", companyId];
  const [isAddOpen, setIsAddOpen] = useState(false);

  const subscriptionsQuery = useQuery({
    queryKey,
    queryFn: () => listServiceSubscriptions({ data: { companyId } }),
  });

  const renewMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      renewServiceSubscription({ data: { subscriptionId, companyId } }),
    onSuccess: () => {
      toast.success("Subscription renewed.");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to renew."),
  });

  const cancelMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      cancelServiceSubscription({ data: { subscriptionId, companyId } }),
    onSuccess: () => {
      toast.success("Subscription cancelled.");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to cancel."),
  });

  const subscriptions = subscriptionsQuery.data ?? [];
  const activeTypes = new Set(
    subscriptions.filter((row) => row.status === "Active").map((row) => row.serviceType),
  );
  const offeredTypes = SERVICE_TYPES.filter((type) => !activeTypes.has(type));

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Subscriptions</h2>
        {offeredTypes.length > 0 ? (
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="rounded-md border px-2 py-1 text-xs font-medium"
          >
            Add subscription
          </button>
        ) : null}
      </div>

      {subscriptionsQuery.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Subscriptions are unavailable. Try again shortly.
        </p>
      ) : null}

      <div className="mt-3 divide-y">
        {subscriptions.map((subscription) => (
          <div
            key={subscription.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
          >
            <span className="min-w-0 truncate font-medium">
              {SERVICE_TYPE_LABELS[subscription.serviceType]}
            </span>
            <span className="text-muted-foreground">HKD {subscription.fee.toLocaleString()}</span>
            {subscription.status === "Active" ? (
              <DeadlinePill dueDate={subscription.renewalDate} />
            ) : (
              <span className="text-xs text-muted-foreground">Cancelled</span>
            )}
            {subscription.status === "Active" ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={renewMutation.isPending}
                  onClick={() => renewMutation.mutate(subscription.id)}
                  className="rounded-md border px-2 py-1 text-xs"
                >
                  Mark renewed
                </button>
                <button
                  type="button"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(subscription.id)}
                  className="rounded-md border px-2 py-1 text-xs"
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {!subscriptionsQuery.isPending && subscriptions.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No subscriptions yet.</p>
        ) : null}
      </div>

      <AddSubscriptionDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        companyId={companyId}
        offeredTypes={offeredTypes}
        onAdded={() => void queryClient.invalidateQueries({ queryKey })}
      />
    </section>
  );
}

function AddSubscriptionDialog({
  open,
  onOpenChange,
  companyId,
  offeredTypes,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  offeredTypes: readonly ServiceType[];
  onAdded: () => void;
}) {
  const [serviceType, setServiceType] = useState<ServiceType | "">("");
  const [fee, setFee] = useState("");
  const [renewalDate, setRenewalDate] = useState(defaultRenewalDate());
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceType) return;
    setSaving(true);

    try {
      await addServiceSubscription({
        data: {
          companyId,
          serviceType,
          fee: Number.parseInt(fee, 10),
          renewalDate,
        },
      });
      toast.success("Subscription added.");
      onAdded();
      onOpenChange(false);
      setServiceType("");
      setFee("");
      setRenewalDate(defaultRenewalDate());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add subscription.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add subscription</DialogTitle>
          <DialogDescription>Start tracking a recurring service for this company.</DialogDescription>
        </DialogHeader>

        {offeredTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every service already has an active subscription.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="subscription-type">
                Service
              </label>
              <select
                id="subscription-type"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={serviceType}
                onChange={(event) => setServiceType(event.target.value as ServiceType)}
                required
              >
                <option value="" disabled>
                  Select a service
                </option>
                {offeredTypes.map((type) => (
                  <option key={type} value={type}>
                    {SERVICE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="subscription-fee">
                Fee (HKD)
              </label>
              <input
                id="subscription-fee"
                type="number"
                min="1"
                step="1"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="subscription-renewal">
                Renewal date
              </label>
              <input
                id="subscription-renewal"
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={renewalDate}
                onChange={(event) => setRenewalDate(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? "Adding…" : "Add subscription"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it into the client detail page**

In `production-client-detail.tsx`, import `ServiceSubscriptionsSection`
and render `<ServiceSubscriptionsSection companyId={client.id} />`
immediately after the Officers/Shareholders section(s) and before the
SCR/DR section(s) — matching the section order already established on that
page.

- [ ] **Step 3: Write the component test**

Before writing this file for real, read an existing component test in this
codebase (e.g. `create-incorporation-case-dialog.test.tsx`) for the exact
`vi.mock`/render-helper conventions already established, and match those
precisely rather than the illustrative shape below if they differ (e.g. a
shared test-utils render wrapper may already exist and should be reused
instead of the inline helper here).

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSubscriptionsSection } from "./service-subscriptions-section";
import * as serverFns from "@/features/service-subscriptions/server-fns";

vi.mock("@/features/service-subscriptions/server-fns", () => ({
  listServiceSubscriptions: vi.fn(),
  addServiceSubscription: vi.fn(),
  renewServiceSubscription: vi.fn(),
  cancelServiceSubscription: vi.fn(),
}));

function renderWithClient(companyId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServiceSubscriptionsSection companyId={companyId} />
    </QueryClientProvider>,
  );
}

const secretarySubscription = {
  id: "sub-1",
  companyId: "company-1",
  serviceType: "secretary" as const,
  fee: 2800,
  status: "Active" as const,
  renewalDate: "2027-01-01",
  cancelledAt: null,
};

describe("ServiceSubscriptionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each subscription with its fee and renewal date", async () => {
    vi.mocked(serverFns.listServiceSubscriptions).mockResolvedValue([secretarySubscription]);

    renderWithClient("company-1");

    expect(await screen.findByText("Company Secretary")).toBeInTheDocument();
    expect(screen.getByText("HKD 2,800")).toBeInTheDocument();
  });

  it("offers only service types without an active subscription in the add dialog", async () => {
    vi.mocked(serverFns.listServiceSubscriptions).mockResolvedValue([secretarySubscription]);

    renderWithClient("company-1");
    await screen.findByText("Company Secretary");

    await userEvent.click(screen.getByRole("button", { name: "Add subscription" }));

    const select = screen.getByLabelText("Service");
    const options = Array.from(select.querySelectorAll("option")).map((option) => option.textContent);
    expect(options).not.toContain("Company Secretary");
    expect(options).toContain("Registered Office");
  });

  it("calls renewServiceSubscription when Mark renewed is clicked", async () => {
    vi.mocked(serverFns.listServiceSubscriptions).mockResolvedValue([secretarySubscription]);
    vi.mocked(serverFns.renewServiceSubscription).mockResolvedValue({
      ...secretarySubscription,
      renewalDate: "2028-01-01",
    });

    renderWithClient("company-1");
    await screen.findByText("Company Secretary");

    await userEvent.click(screen.getByRole("button", { name: "Mark renewed" }));

    await waitFor(() =>
      expect(serverFns.renewServiceSubscription).toHaveBeenCalledWith({
        data: { subscriptionId: "sub-1", companyId: "company-1" },
      }),
    );
  });

  it("calls cancelServiceSubscription when Cancel is clicked", async () => {
    vi.mocked(serverFns.listServiceSubscriptions).mockResolvedValue([secretarySubscription]);
    vi.mocked(serverFns.cancelServiceSubscription).mockResolvedValue({
      ...secretarySubscription,
      status: "Cancelled",
      cancelledAt: "2026-08-23T00:00:00.000Z",
    });

    renderWithClient("company-1");
    await screen.findByText("Company Secretary");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(serverFns.cancelServiceSubscription).toHaveBeenCalledWith({
        data: { subscriptionId: "sub-1", companyId: "company-1" },
      }),
    );
  });
});
```

- [ ] **Step 4: Run the new test file**

Run: `npx vitest run src/features/clients/components/service-subscriptions-section.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/components/service-subscriptions-section.tsx src/features/clients/components/service-subscriptions-section.test.tsx src/features/clients/components/production-client-detail.tsx
git commit -m "feat: add Subscriptions section to the client detail page"
```

---

## Task 13: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the repo.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no new errors (the pre-existing `work-queue.tsx` fast-refresh
warning may remain).

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all non-DB tests pass; DB-integration tests skip locally.

- [ ] **Step 4: Offline pre-deploy gate**

Run: `npm run verify:firm -- --dry-run`
Expected: passes, including `migration-schema` for migration 0018.

- [ ] **Step 5: Confirm no dangling `service_packages` references anywhere**

```bash
grep -rn "service_packages\|service_package_id\|ServicePackage\|listServicePackages" src/ db/migrations/0018_recurring_service_subscriptions.sql
```
Expected: zero matches outside `db/migrations/0008_client_register.sql`
(the original migration, left untouched — migrations are forward-only and
never edited retroactively) and `db/migrations/0018_...`'s own drop
statements.

- [ ] **Step 6: Confirm the page-header convention holds**

Run the full suite (Step 3) and confirm
`src/components/page-header.convention.test.ts` passes with no changes
needed — this task added a section to an existing page, not a new route,
so nothing about page-header rendering should be affected.

- [ ] **Step 7: Manual smoke test in demo mode**

Start the dev server and confirm `/clients/$id` (any company, e.g. one of
the seeded demo companies) shows the new Subscriptions section rendering
correctly for both demo mode (via `DemoClientNotice`, unaffected by this
change) and, if a production-mode smoke test is possible in this
environment, that Add/Mark renewed/Cancel all work end to end against a
real company. If production-mode testing hits the same pre-existing
`NEON_AUTH_URL is required` sandbox limitation earlier plans in this repo
have hit, disclose that explicitly rather than claiming a full
production-mode smoke test.

- [ ] **Step 8: Dispatch a final holistic code review of the whole branch diff**

Compare the full diff against
`docs/superpowers/specs/2026-08-23-recurring-service-subscriptions-design.md`
for spec compliance. Specifically re-verify: (a) `renewSubscription`
advances the renewal date by a genuine calendar year, not a flat 365-day
add, and correctly rolls Feb 29 to Mar 1 (the same class of bug already
fixed once for `oneYearLater` — confirm the moved copy in `src/lib/
date-math.ts` still behaves identically); (b) `evaluateReminders` never
fires more than one milestone per subscription per sweep tick, and never
re-fires a milestone after it has already fired (the exact bug class P1-2
hit once already); (c) a cancelled subscription never receives a reminder,
including one cancelled mid-sweep (the lock-and-recheck path); (d) every
`service_packages`/`service_package_id` reference is genuinely gone, not
just hidden behind a type error that happened to get silenced; (e) the
unique-constraint reactivation path in `addSubscription` is exercised by a
real test, not just reasoned about.

- [ ] **Step 9: Confirm CI is green in an actual CI run before merging**

After pushing and opening the PR, wait for the `verify` CI job (DB-integration
suite against a real database) to report `SUCCESS` before treating this item
as done.

---

## Self-Review Notes

- **Spec coverage**: schema + retiring `service_packages` (Task 1), shared
  pure-logic extraction the reminder design depends on (Tasks 2-3), types/
  constants (Task 4), errors/authorization (Task 5), repository (Task 6),
  repository integration tests (Task 7), server-fns (Task 8), reminders
  including cron wiring (Task 9), retiring `service_packages` from
  data-layer then UI (Tasks 10-11), the client-detail UI section (Task 12),
  and the CI-confirmation acceptance criterion (Task 13) all have a task.
  No gaps found against the design spec.
- **Placeholder scan**: no TBD/TODO; every step has real code, except two
  explicitly-flagged spots where the plan intentionally defers to reading
  existing code first rather than guessing its shape blind (Task 9 Step
  8's `maintenance.ts` wiring, and Task 12 Step 3's test-convention check)
  — both are investigation instructions with a clear, concrete goal, not
  vague implementation hand-waving.
- **Type consistency**: `ServiceSubscription`/`ServiceType`/
  `SubscriptionStatus` and the four input types are defined once in Task 4
  and referenced identically (same field names: `companyId`, `serviceType`,
  `fee`, `status`, `renewalDate`, `cancelledAt`) across Tasks 6, 8, 9, and
  12 — checked for drift across all tasks. Milestone naming
  (`'1_month'`/`'2_week'`/`'1_week'`, singular) matches
  `annual_return_reminder_events` exactly, corrected during the spec's own
  self-review before this plan was written, so no drift exists between
  spec and plan on this point.
- **Post-writing addendum (found while writing Task 9, before this plan
  was finalized)**: the spec's Reminders section only named `dueMilestone`
  as needing extraction to `src/lib/`, but `dueMilestone` itself depends on
  `daysBetween` — which would otherwise still be imported peer-to-peer from
  `annual-return/workflow.ts` into the new shared module. Folded
  `daysBetween` into the same Task 2 extraction as `oneYearLater` (both are
  pure date math, both now needed by `src/lib/reminder-cadence.ts`), rather
  than leaving one pure function extracted and a second, closely related
  one not. Found the identical situation for `hongKongBusinessDate`
  (currently local to `deadline-pill.tsx`, needed by Task 9's reminder
  sweep too) and handled it the same way in Task 9 Step 4, conditional on
  a shared copy not already existing. Both are plan-level precision
  improvements over the spec, not scope changes — the spec's own design
  intent (shared pure logic lives in `src/lib`, not cross-imported between
  peer features) already implied both; the spec just didn't name every
  function by identifier.
