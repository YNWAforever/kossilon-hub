# P1-7: Incorporation Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new case type tracking new-HK-company incorporation intake from
case creation through Companies Registry approval, ending in a real `companies`
row, per `docs/superpowers/specs/2026-08-22-incorporation-intake-design.md`.

**Architecture:** A brand-new, fully self-contained feature slice
`src/features/incorporation/` (two new tables, no changes to `work_items`/
`documents`/the SLA-policy engine), with its own `/incorporation` list and
`/incorporation/$id` detail routes. Completion duplicates `createClient`'s
company-creation insert directly rather than importing across feature slices.

**Tech Stack:** TanStack Start, Postgres via `postgres` (raw SQL), Zod, Vitest, React 19.

---

## Task 1: Migration and schema.sql

**Files:**
- Create: `db/migrations/0017_incorporation_intake.sql`
- Modify: `src/server/db/schema.sql`

- [x] **Step 1: Write the migration**

```sql
-- 0017: incorporation intake case type (P1-7).
--
-- Every existing case type (annual_return_cases) operates on an ALREADY-EXISTING
-- company. An incorporation case has no company at all until it completes, so it
-- cannot use work_items/documents (both company_id not null) or the SLA-policy
-- engine without generalizing all three — deliberately deferred, per the design
-- spec. This migration is fully self-contained: two new tables, nothing altered.

create table if not exists incorporation_cases (
  id uuid primary key default gen_random_uuid(),
  proposed_company_name_en text not null,
  proposed_company_name_zh text,
  proposed_registered_office text not null,
  proposed_company_secretary text not null,
  registered_capital integer not null check (registered_capital > 0),
  business_nature text not null,
  status text not null default 'Intake' check (status in (
    'Intake', 'Documents pending', 'Ready to file', 'Filed with Registrar', 'Completed'
  )),
  owner_id uuid not null references users(id),
  team_id uuid not null references teams(id),
  target_completion_date date not null,
  company_id uuid references companies(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incorporation_cases_completed_has_company check (
    status <> 'Completed' or company_id is not null
  )
);

create index if not exists incorporation_cases_status_idx on incorporation_cases (status);
create index if not exists incorporation_cases_company_idx on incorporation_cases (company_id);

create table if not exists incorporation_checklist_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references incorporation_cases(id) on delete cascade,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'Missing' check (status in ('Missing', 'Received', 'Verified', 'Rejected')),
  note text,
  received_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incorporation_checklist_items_case_idx on incorporation_checklist_items (case_id);
```

Note: `registered_capital` is `integer`, not `numeric` — this codebase already
represents money as plain integers everywhere (`payments.amount`,
`service_packages.default_fee`), never `numeric`, to avoid the
string-vs-number parsing complexity Postgres's `numeric` type forces on JS
consumers. HK company registered capital is a round HKD figure (commonly
10,000), so this loses nothing.

- [x] **Step 2: Update `schema.sql`**

Read the file first. Insert the two `create table`/`create index` blocks above
(byte-identical to the migration) immediately after the `scr_inspection_requests`
table's index (the last table added by migration 0016), before whatever comment
or table follows it.

- [x] **Step 3: Verify the migration/schema consistency gate**

Run: `npm run verify:firm -- --dry-run`
Expected: passes, including `migration-schema`.

- [x] **Step 4: Commit**

```bash
git add db/migrations/0017_incorporation_intake.sql src/server/db/schema.sql
git commit -m "feat: add incorporation_cases and incorporation_checklist_items tables"
```

---

## Task 2: Types

**Files:**
- Create: `src/features/incorporation/types.ts`

- [x] **Step 1: Write the types**

```ts
import type { ChecklistStatus } from "@/features/annual-return/types";

export const INCORPORATION_STATUSES = [
  "Intake",
  "Documents pending",
  "Ready to file",
  "Filed with Registrar",
  "Completed",
] as const;

export type IncorporationStatus = (typeof INCORPORATION_STATUSES)[number];

/** Re-exported so the checklist-item status check constraint (shared literal set
 *  with annual_return_checklist_items) has exactly one TypeScript definition. */
export type ChecklistItemStatus = ChecklistStatus;

export type IncorporationChecklistItem = {
  id: string;
  caseId: string;
  itemLabel: string;
  required: boolean;
  status: ChecklistItemStatus;
  note: string | null;
  receivedAt: string | null;
  verifiedAt: string | null;
};

export type IncorporationCase = {
  id: string;
  proposedCompanyNameEn: string;
  proposedCompanyNameZh: string | null;
  proposedRegisteredOffice: string;
  proposedCompanySecretary: string;
  registeredCapital: number;
  businessNature: string;
  status: IncorporationStatus;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  targetCompletionDate: string;
  companyId: string | null;
  completedAt: string | null;
  createdAt: string;
  checklist: IncorporationChecklistItem[];
};

export type IncorporationCaseSummary = Omit<IncorporationCase, "checklist">;

export type CreateIncorporationCaseInput = {
  proposedCompanyNameEn: string;
  proposedCompanyNameZh: string | null;
  proposedRegisteredOffice: string;
  proposedCompanySecretary: string;
  registeredCapital: number;
  businessNature: string;
  ownerId: string;
  teamId: string;
  targetCompletionDate: string;
  actorId: string;
};

export type UpdateIncorporationChecklistItemInput = {
  caseId: string;
  itemId: string;
  status: ChecklistItemStatus;
  note: string | null;
  actorId: string;
};

export type UpdateIncorporationCaseStatusInput = {
  caseId: string;
  status: IncorporationStatus;
  actorId: string;
};

export type CompleteIncorporationCaseInput = {
  caseId: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  actorId: string;
};
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean — nothing else references this new module yet.

- [x] **Step 3: Commit**

```bash
git add src/features/incorporation/types.ts
git commit -m "feat: add incorporation intake types"
```

---

## Task 3: Pure workflow logic

**Files:**
- Create: `src/features/incorporation/workflow.ts`
- Test: `src/features/incorporation/workflow.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { isAllowedIntakeStatusTransition, oneYearLater } from "./workflow";

describe("isAllowedIntakeStatusTransition", () => {
  it("allows moving forward exactly one step", () => {
    expect(isAllowedIntakeStatusTransition("Intake", "Documents pending")).toBe(true);
    expect(isAllowedIntakeStatusTransition("Documents pending", "Ready to file")).toBe(true);
    expect(isAllowedIntakeStatusTransition("Ready to file", "Filed with Registrar")).toBe(true);
    expect(isAllowedIntakeStatusTransition("Filed with Registrar", "Completed")).toBe(true);
  });

  it("rejects skipping a step", () => {
    expect(isAllowedIntakeStatusTransition("Intake", "Ready to file")).toBe(false);
  });

  it("rejects moving backward", () => {
    expect(isAllowedIntakeStatusTransition("Ready to file", "Intake")).toBe(false);
  });

  it("rejects a no-op transition", () => {
    expect(isAllowedIntakeStatusTransition("Intake", "Intake")).toBe(false);
  });
});

describe("oneYearLater", () => {
  it("advances the year, keeping month and day", () => {
    expect(oneYearLater("2026-03-15")).toBe("2027-03-15");
  });

  it("handles a leap-year Feb 29 by rolling to Mar 1 the following (non-leap) year", () => {
    // 2028 is a leap year; 2029 is not, so Feb 29 2028 -> Mar 1 2029 is the
    // correct, unambiguous JS Date rollover behavior (setUTCFullYear onto a
    // date that doesn't exist in the target year rolls forward).
    expect(oneYearLater("2028-02-29")).toBe("2029-03-01");
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/incorporation/workflow.test.ts`
Expected: FAIL — `./workflow` does not exist yet.

- [x] **Step 3: Write the implementation**

```ts
import type { IncorporationStatus } from "./types";
import { INCORPORATION_STATUSES } from "./types";

export function isAllowedIntakeStatusTransition(
  from: IncorporationStatus,
  to: IncorporationStatus,
): boolean {
  const fromIndex = INCORPORATION_STATUSES.indexOf(from);
  const toIndex = INCORPORATION_STATUSES.indexOf(to);

  if (fromIndex < 0 || toIndex < 0) return false;

  return toIndex === fromIndex + 1;
}

/**
 * The first calendar anniversary of a date — the statutory basis for a new
 * company's first annual return. A genuine year increment, not +365 days,
 * since a flat day count is wrong across a leap year.
 */
export function oneYearLater(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const value = new Date(Date.UTC(year + 1, month - 1, day));
  return value.toISOString().slice(0, 10);
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/incorporation/workflow.test.ts`
Expected: PASS, all 6 tests.

- [x] **Step 5: Commit**

```bash
git add src/features/incorporation/workflow.ts src/features/incorporation/workflow.test.ts
git commit -m "feat: add incorporation intake status transition and date logic"
```

---

## Task 4: Repository layer

**Files:**
- Create: `src/features/incorporation/repository.ts`

Read `src/features/annual-return/repository.ts` lines 838-945 (the `createCase`
function) and `src/features/clients/repository.ts` lines 557-600 (`createClient`)
first — this task's `createIncorporationCase` and `completeIncorporationCase`
mirror those two functions' transactional shape closely. Also read
`annual-return/repository.ts` lines ~1550-1568 (its checklist-item status update)
for the `case when <bool-param> then coalesce(existing, now()) else null end`
pattern this task's `updateChecklistItem` mirrors exactly — resetting a
timestamp to `null` when the item moves away from Received/Verified (e.g. into
Rejected) is the established, deliberate behavior here, not an oversight.

- [x] **Step 1: Write the repository**

```ts
import type postgres from "postgres";
import { rethrowClientWriteError } from "@/features/clients/errors";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { isAllowedIntakeStatusTransition, oneYearLater } from "./workflow";
import type {
  ChecklistItemStatus,
  CompleteIncorporationCaseInput,
  CreateIncorporationCaseInput,
  IncorporationCase,
  IncorporationCaseSummary,
  IncorporationChecklistItem,
  IncorporationStatus,
  UpdateIncorporationCaseStatusInput,
  UpdateIncorporationChecklistItemInput,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type CreateIncorporationRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type IncorporationRepository = {
  listCases(): Promise<IncorporationCaseSummary[]>;
  getCase(id: string): Promise<IncorporationCase | null>;
  getCaseTeamId(caseId: string): Promise<string | null>;
  createCase(input: CreateIncorporationCaseInput): Promise<IncorporationCase>;
  updateChecklistItem(input: UpdateIncorporationChecklistItemInput): Promise<IncorporationCase>;
  updateCaseStatus(input: UpdateIncorporationCaseStatusInput): Promise<IncorporationCase>;
  completeCase(input: CompleteIncorporationCaseInput): Promise<IncorporationCase>;
  close(): Promise<void>;
};

type CaseRow = {
  id: string;
  proposed_company_name_en: string;
  proposed_company_name_zh: string | null;
  proposed_registered_office: string;
  proposed_company_secretary: string;
  registered_capital: number;
  business_nature: string;
  status: IncorporationStatus;
  owner_id: string;
  owner_name: string;
  team_id: string;
  team_name: string;
  target_completion_date: string | Date;
  company_id: string | null;
  completed_at: string | Date | null;
  created_at: string | Date;
};

type ChecklistItemRow = {
  id: string;
  case_id: string;
  item_label: string;
  required: boolean;
  status: ChecklistItemStatus;
  note: string | null;
  received_at: string | Date | null;
  verified_at: string | Date | null;
};

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapChecklistItem(row: ChecklistItemRow): IncorporationChecklistItem {
  return {
    id: row.id,
    caseId: row.case_id,
    itemLabel: row.item_label,
    required: row.required,
    status: row.status,
    note: row.note,
    receivedAt: row.received_at ? timestampString(row.received_at) : null,
    verifiedAt: row.verified_at ? timestampString(row.verified_at) : null,
  };
}

function mapCaseSummary(row: CaseRow): IncorporationCaseSummary {
  return {
    id: row.id,
    proposedCompanyNameEn: row.proposed_company_name_en,
    proposedCompanyNameZh: row.proposed_company_name_zh,
    proposedRegisteredOffice: row.proposed_registered_office,
    proposedCompanySecretary: row.proposed_company_secretary,
    registeredCapital: row.registered_capital,
    businessNature: row.business_nature,
    status: row.status,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    teamId: row.team_id,
    teamName: row.team_name,
    targetCompletionDate: dateOnly(row.target_completion_date),
    companyId: row.company_id,
    completedAt: row.completed_at ? timestampString(row.completed_at) : null,
    createdAt: timestampString(row.created_at),
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

export function createIncorporationRepository(
  options?: CreateIncorporationRepositoryOptions,
): IncorporationRepository;
export function createIncorporationRepository(
  databaseUrl: string | undefined,
  options?: CreateIncorporationRepositoryOptions,
): IncorporationRepository;
export function createIncorporationRepository(
  databaseUrlOrOptions?: string | CreateIncorporationRepositoryOptions,
  maybeOptions?: CreateIncorporationRepositoryOptions,
): IncorporationRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function listCases(): Promise<IncorporationCaseSummary[]> {
    const rows = await sql<CaseRow[]>`
      select
        ic.id, ic.proposed_company_name_en, ic.proposed_company_name_zh,
        ic.proposed_registered_office, ic.proposed_company_secretary, ic.registered_capital,
        ic.business_nature, ic.status, u.id as owner_id, u.name as owner_name,
        t.id as team_id, t.name as team_name, ic.target_completion_date, ic.company_id,
        ic.completed_at, ic.created_at
      from incorporation_cases ic
      join users u on u.id = ic.owner_id
      join teams t on t.id = ic.team_id
      order by ic.created_at desc
    `;
    return rows.map(mapCaseSummary);
  }

  async function hydrateCase(client: QueryClient, id: string): Promise<IncorporationCase | null> {
    const caseRows = await client<CaseRow[]>`
      select
        ic.id, ic.proposed_company_name_en, ic.proposed_company_name_zh,
        ic.proposed_registered_office, ic.proposed_company_secretary, ic.registered_capital,
        ic.business_nature, ic.status, u.id as owner_id, u.name as owner_name,
        t.id as team_id, t.name as team_name, ic.target_completion_date, ic.company_id,
        ic.completed_at, ic.created_at
      from incorporation_cases ic
      join users u on u.id = ic.owner_id
      join teams t on t.id = ic.team_id
      where ic.id = ${id}
      limit 1
    `;

    const [caseRow] = caseRows;
    if (!caseRow) return null;

    const checklist = await client<ChecklistItemRow[]>`
      select id, case_id, item_label, required, status, note, received_at, verified_at
      from incorporation_checklist_items
      where case_id = ${id}
      order by created_at asc
    `;

    return {
      ...mapCaseSummary(caseRow),
      checklist: checklist.map(mapChecklistItem),
    };
  }

  async function getCase(id: string): Promise<IncorporationCase | null> {
    return hydrateCase(sql, id);
  }

  async function getCaseTeamId(caseId: string): Promise<string | null> {
    const rows = await sql<{ team_id: string }[]>`
      select team_id from incorporation_cases where id = ${caseId} limit 1
    `;
    return rows[0]?.team_id ?? null;
  }

  async function hydrateOrThrow(tx: TransactionSqlClient, caseId: string): Promise<IncorporationCase> {
    const result = await hydrateCase(tx, caseId);
    if (!result) throw new Error("Incorporation case not found.");
    return result;
  }

  async function assertActor(tx: TransactionSqlClient, actorId: string): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from users where id = ${actorId} and active limit 1
    `;
    if (rows.length === 0) throw new Error("Incorporation actor not found or inactive.");
  }

  async function createCase(input: CreateIncorporationCaseInput): Promise<IncorporationCase> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      const ownerRows = await tx<{ id: string }[]>`
        select id from users where id = ${input.ownerId} and active limit 1
      `;
      if (ownerRows.length !== 1) throw new Error("Incorporation owner not found or inactive.");

      const templateRows = await tx<{ documents: { label: string; required: boolean }[] }[]>`
        select documents from checklist_templates
        where service_type = 'Incorporation — HK Ltd' and active limit 1
      `;
      const template = templateRows[0];
      if (!template) throw new Error("No active incorporation checklist template exists.");

      const caseRows = await tx<{ id: string }[]>`
        insert into incorporation_cases (
          proposed_company_name_en, proposed_company_name_zh, proposed_registered_office,
          proposed_company_secretary, registered_capital, business_nature,
          owner_id, team_id, target_completion_date
        ) values (
          ${input.proposedCompanyNameEn}, ${input.proposedCompanyNameZh},
          ${input.proposedRegisteredOffice}, ${input.proposedCompanySecretary},
          ${input.registeredCapital}, ${input.businessNature},
          ${input.ownerId}, ${input.teamId}, ${input.targetCompletionDate}
        )
        returning id
      `;
      const newCaseId = caseRows[0].id;

      for (const document of template.documents) {
        await tx`
          insert into incorporation_checklist_items (case_id, item_label, required)
          values (${newCaseId}, ${document.label}, ${document.required})
        `;
      }

      return hydrateOrThrow(tx, newCaseId);
    });
  }

  async function assertItemBelongsToCase(
    tx: TransactionSqlClient,
    caseId: string,
    itemId: string,
  ): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from incorporation_checklist_items where id = ${itemId} and case_id = ${caseId} limit 1
    `;
    if (rows.length === 0) throw new Error("Checklist item not found for this case.");
  }

  async function updateChecklistItem(input: UpdateIncorporationChecklistItemInput): Promise<IncorporationCase> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);
      await assertItemBelongsToCase(tx, input.caseId, input.itemId);

      const hasReceived = input.status === "Received" || input.status === "Verified";
      const hasVerified = input.status === "Verified";

      await tx`
        update incorporation_checklist_items
        set status = ${input.status}, note = ${input.note},
            received_at = case when ${hasReceived} then coalesce(received_at, now()) else null end,
            verified_at = case when ${hasVerified} then coalesce(verified_at, now()) else null end,
            updated_at = now()
        where id = ${input.itemId} and case_id = ${input.caseId}
      `;

      return hydrateOrThrow(tx, input.caseId);
    });
  }

  async function updateCaseStatus(input: UpdateIncorporationCaseStatusInput): Promise<IncorporationCase> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      const current = await hydrateOrThrow(tx, input.caseId);
      if (!isAllowedIntakeStatusTransition(current.status, input.status)) {
        throw new Error(`Cannot move a case from ${current.status} to ${input.status}.`);
      }

      await tx`
        update incorporation_cases set status = ${input.status}, updated_at = now()
        where id = ${input.caseId}
      `;

      return hydrateOrThrow(tx, input.caseId);
    });
  }

  async function completeCase(input: CompleteIncorporationCaseInput): Promise<IncorporationCase> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await tx`select id from incorporation_cases where id = ${input.caseId} for update`;

        const current = await hydrateOrThrow(tx, input.caseId);
        if (current.status !== "Filed with Registrar") {
          throw new Error(
            `Cannot complete a case from status ${current.status}; it must be Filed with Registrar.`,
          );
        }

        const annualReturnBasisDate = oneYearLater(input.incorporationDate);

        const companyRows = await tx<{ id: string }[]>`
          insert into companies (
            company_name, cr_number, br_number, incorporation_date,
            annual_return_basis_date, registered_office, company_secretary,
            status, assigned_owner_id, assigned_team_id
          )
          values (
            ${current.proposedCompanyNameEn}, ${input.crNumber}, ${input.brNumber},
            ${input.incorporationDate}, ${annualReturnBasisDate},
            ${current.proposedRegisteredOffice}, ${current.proposedCompanySecretary},
            'active', ${current.ownerId}, ${current.teamId}
          )
          returning id
        `;
        const companyId = companyRows[0].id;

        await tx`
          insert into officers (company_id, officer_type, name, appointment_date)
          values (${companyId}, 'secretary', ${current.proposedCompanySecretary}, ${input.incorporationDate})
        `;

        await tx`
          update incorporation_cases
          set status = 'Completed', company_id = ${companyId}, completed_at = now(), updated_at = now()
          where id = ${input.caseId}
        `;

        return hydrateOrThrow(tx, input.caseId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) await sql.end();
  }

  return {
    listCases,
    getCase,
    getCaseTeamId,
    createCase,
    updateChecklistItem,
    updateCaseStatus,
    completeCase,
    close,
  };
}
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 3: Commit**

```bash
git add src/features/incorporation/repository.ts
git commit -m "feat: add incorporation intake repository"
```

---

## Task 5: Repository integration tests

**Files:**
- Create: `src/features/incorporation/repository.test.ts`

**Critical, non-optional first step** — see the design spec's explicit callout:
`incorporation_cases.company_id` is `on delete restrict` against `companies`. Any
test that calls `completeCase` creates a real `companies` row. This file's own
cleanup helper MUST delete `incorporation_cases` rows before the `companies` rows
they created, from the very first test that exercises `completeCase` — this is
the third time this exact class of bug could recur in this codebase (PR #46/#47
for officers/shareholdings; caught pre-merge for P1-6's significant_controllers).

- [x] **Step 1: Write the test file**

```ts
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createIncorporationRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for incorporation integration tests.");
  }
  return createSqlClient(databaseUrl, { max: 1 });
}

describe.skipIf(!databaseUrl)("incorporation intake integration", () => {
  it("creates a case with checklist items copied from the seeded template", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;

          const created = await repository.createCase({
            proposedCompanyNameEn: "New Venture Limited",
            proposedCompanyNameZh: "新創有限公司",
            proposedRegisteredOffice: "1 Test Street, Hong Kong",
            proposedCompanySecretary: "Kossilon Secretaries Ltd",
            registeredCapital: 10000,
            businessNature: "Trading",
            ownerId: owner.id,
            teamId: team.id,
            targetCompletionDate: "2026-09-01",
            actorId: owner.id,
          });

          expect(created.status).toBe("Intake");
          expect(created.checklist.length).toBeGreaterThan(0);
          expect(created.checklist.every((item) => item.status === "Missing")).toBe(true);

          throw new Error("rollback incorporation integration fixture");
        }),
      ).rejects.toThrow("rollback incorporation integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("moves a checklist item through Received -> Verified with set-once timestamps", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;

          const created = await repository.createCase({
            proposedCompanyNameEn: "Checklist Test Limited",
            proposedCompanyNameZh: null,
            proposedRegisteredOffice: "1 Test Street, Hong Kong",
            proposedCompanySecretary: "Kossilon Secretaries Ltd",
            registeredCapital: 10000,
            businessNature: "Trading",
            ownerId: owner.id,
            teamId: team.id,
            targetCompletionDate: "2026-09-01",
            actorId: owner.id,
          });

          const item = created.checklist[0];

          const received = await repository.updateChecklistItem({
            caseId: created.id,
            itemId: item.id,
            status: "Received",
            note: "Emailed by client",
            actorId: owner.id,
          });
          const receivedItem = received.checklist.find((candidate) => candidate.id === item.id)!;
          expect(receivedItem.receivedAt).not.toBeNull();
          expect(receivedItem.verifiedAt).toBeNull();

          const verified = await repository.updateChecklistItem({
            caseId: created.id,
            itemId: item.id,
            status: "Verified",
            note: "Confirmed original",
            actorId: owner.id,
          });
          const verifiedItem = verified.checklist.find((candidate) => candidate.id === item.id)!;
          expect(verifiedItem.receivedAt).toBe(receivedItem.receivedAt);
          expect(verifiedItem.verifiedAt).not.toBeNull();

          throw new Error("rollback incorporation integration fixture");
        }),
      ).rejects.toThrow("rollback incorporation integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("rejects skipping a status, allows the linear sequence", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;

          const created = await repository.createCase({
            proposedCompanyNameEn: "Status Test Limited",
            proposedCompanyNameZh: null,
            proposedRegisteredOffice: "1 Test Street, Hong Kong",
            proposedCompanySecretary: "Kossilon Secretaries Ltd",
            registeredCapital: 10000,
            businessNature: "Trading",
            ownerId: owner.id,
            teamId: team.id,
            targetCompletionDate: "2026-09-01",
            actorId: owner.id,
          });

          await expect(
            repository.updateCaseStatus({
              caseId: created.id,
              status: "Ready to file",
              actorId: owner.id,
            }),
          ).rejects.toThrow("Cannot move a case from Intake to Ready to file.");

          const advanced = await repository.updateCaseStatus({
            caseId: created.id,
            status: "Documents pending",
            actorId: owner.id,
          });
          expect(advanced.status).toBe("Documents pending");

          throw new Error("rollback incorporation integration fixture");
        }),
      ).rejects.toThrow("rollback incorporation integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("completes a case by creating a real company and its secretary officer", async () => {
    const setupSql = sqlForTests();
    let caseId: string | undefined;
    let companyId: string | undefined;

    try {
      const repository = createIncorporationRepository({ sql: setupSql });
      const [owner] = await setupSql<{ id: string }[]>`select id from users where active limit 1`;
      const [team] = await setupSql<{ id: string }[]>`select id from teams where active limit 1`;

      const created = await repository.createCase({
        proposedCompanyNameEn: "Complete Test Limited",
        proposedCompanyNameZh: null,
        proposedRegisteredOffice: "1 Test Street, Hong Kong",
        proposedCompanySecretary: "Kossilon Secretaries Ltd",
        registeredCapital: 10000,
        businessNature: "Trading",
        ownerId: owner.id,
        teamId: team.id,
        targetCompletionDate: "2026-09-01",
        actorId: owner.id,
      });
      caseId = created.id;

      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Documents pending",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Ready to file",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Filed with Registrar",
        actorId: owner.id,
      });

      const crNumber = `CR-INC-${crypto.randomUUID().slice(0, 8)}`;
      const brNumber = `BR-INC-${crypto.randomUUID().slice(0, 8)}`;

      const completed = await repository.completeCase({
        caseId: created.id,
        crNumber,
        brNumber,
        incorporationDate: "2026-08-01",
        actorId: owner.id,
      });

      expect(completed.status).toBe("Completed");
      expect(completed.companyId).not.toBeNull();
      companyId = completed.companyId!;

      const companyRows = await setupSql<{ annual_return_basis_date: string }[]>`
        select annual_return_basis_date::text from companies where id = ${companyId}
      `;
      expect(companyRows[0].annual_return_basis_date).toBe("2027-08-01");

      const officerRows = await setupSql<{ officer_type: string; name: string }[]>`
        select officer_type, name from officers where company_id = ${companyId}
      `;
      expect(officerRows).toHaveLength(1);
      expect(officerRows[0].officer_type).toBe("secretary");
      expect(officerRows[0].name).toBe("Kossilon Secretaries Ltd");

      await expect(
        repository.completeCase({
          caseId: created.id,
          crNumber: `CR-INC2-${crypto.randomUUID().slice(0, 8)}`,
          brNumber: `BR-INC2-${crypto.randomUUID().slice(0, 8)}`,
          incorporationDate: "2026-08-01",
          actorId: owner.id,
        }),
      ).rejects.toThrow("Cannot complete a case from status Completed");
    } finally {
      // incorporation_cases.company_id is `on delete restrict` — delete the
      // case row BEFORE the company row it points at, or this cleanup itself
      // reproduces the exact CI failure documented in the design spec.
      if (caseId) {
        await setupSql`delete from incorporation_cases where id = ${caseId}`;
      }
      if (companyId) {
        await setupSql`delete from officers where company_id = ${companyId}`;
        await setupSql`delete from companies where id = ${companyId}`;
      }
      await setupSql.end();
    }
  });

  it("serializes concurrent completions so exactly one company is created", async () => {
    const setupSql = sqlForTests();
    let caseId: string | undefined;
    let companyIds: string[] = [];

    try {
      const repository = createIncorporationRepository({ sql: setupSql });
      const [owner] = await setupSql<{ id: string }[]>`select id from users where active limit 1`;
      const [team] = await setupSql<{ id: string }[]>`select id from teams where active limit 1`;

      const created = await repository.createCase({
        proposedCompanyNameEn: "Race Test Limited",
        proposedCompanyNameZh: null,
        proposedRegisteredOffice: "1 Test Street, Hong Kong",
        proposedCompanySecretary: "Kossilon Secretaries Ltd",
        registeredCapital: 10000,
        businessNature: "Trading",
        ownerId: owner.id,
        teamId: team.id,
        targetCompletionDate: "2026-09-01",
        actorId: owner.id,
      });
      caseId = created.id;

      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Documents pending",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Ready to file",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Filed with Registrar",
        actorId: owner.id,
      });

      // Two independent connections racing to complete the SAME case
      // concurrently — this is what actually exercises the `for update` lock
      // added in completeCase. A single shared transaction calling
      // completeCase twice sequentially would never race at all, since there
      // is nothing to serialize against — the exact tautological-test mistake
      // made once already in this codebase's history (P1-5's first attempt at
      // the secretary-appointment race test) and corrected since.
      const sqlA = createSqlClient(databaseUrl!, { max: 1 });
      const sqlB = createSqlClient(databaseUrl!, { max: 1 });

      let results: PromiseSettledResult<unknown>[];
      try {
        results = await Promise.allSettled([
          createIncorporationRepository({ sql: sqlA }).completeCase({
            caseId: created.id,
            crNumber: `CR-RACEA-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-RACEA-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2026-08-01",
            actorId: owner.id,
          }),
          createIncorporationRepository({ sql: sqlB }).completeCase({
            caseId: created.id,
            crNumber: `CR-RACEB-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-RACEB-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2026-08-01",
            actorId: owner.id,
          }),
        ]);
      } finally {
        await sqlA.end();
        await sqlB.end();
      }

      // Populate the cleanup list BEFORE any assertion below can throw. The
      // query only depends on the fixed CR-number prefixes used in the race,
      // not on which promise fulfilled/rejected, so it's safe to run
      // unconditionally here. If this ran after the expect()s instead, a
      // regression in the `for update` lock (both calls succeeding) would
      // throw on `expect(fulfilled).toHaveLength(1)` and skip straight to
      // `finally` with `companyIds` still empty, leaking both orphan
      // companies (and their officers) into the test database forever.
      const companyRows = await setupSql<{ id: string }[]>`
        select id from companies
        where cr_number like 'CR-RACEA-%' or cr_number like 'CR-RACEB-%'
      `;
      companyIds = companyRows.map((row) => row.id);

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<unknown> => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      // Exactly one call wins and creates the company; the other loses the
      // race (blocked by the `for update` lock, then sees the
      // already-committed 'Completed' status and throws) rather than both
      // succeeding and creating two orphan companies.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(Error);
      expect((rejected[0].reason as Error).message).toContain(
        "Cannot complete a case from status Completed",
      );

      const finalCase = await repository.getCase(created.id);
      expect(finalCase?.companyId).not.toBeNull();

      // The whole point of the fix: only ONE companies row exists for this
      // race, not two.
      expect(companyIds).toHaveLength(1);
    } finally {
      if (caseId) {
        await setupSql`delete from incorporation_cases where id = ${caseId}`;
      }
      for (const companyId of companyIds) {
        await setupSql`delete from officers where company_id = ${companyId}`;
        await setupSql`delete from companies where id = ${companyId}`;
      }
      await setupSql.end();
    }
  });
});
```

- [x] **Step 2: Format, lint, and run**

```bash
npx eslint --fix src/features/incorporation/repository.test.ts
npx vitest run src/features/incorporation/repository.test.ts
```
Expected: skipped locally (no `TEST_DATABASE_URL`), no syntax errors.

- [x] **Step 3: Commit**

```bash
git add src/features/incorporation/repository.test.ts
git commit -m "test: add incorporation intake repository integration tests"
```

---

## Task 6: Authorization

**Files:**
- Create: `src/features/incorporation/authorization.ts`

Read `src/features/clients/authorization.ts` in full first — this mirrors its
Admin/Manager/Staff shape exactly, just scoped to `incorporation_cases.team_id`
instead of `companies.assigned_team_id`.

- [x] **Step 1: Write the authorization module**

```ts
import type { AuthenticatedActor } from "@/features/auth/types";

export type IncorporationCaseTeam = { teamId: string };

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export function assertIncorporationCaseWritable(
  actor: AuthenticatedActor,
  incorporationCase: IncorporationCaseTeam,
): void {
  if (!actor.active) {
    throw forbidden("inactive users cannot change incorporation cases.");
  }

  if (actor.role === "Client") {
    throw forbidden("staff access is required.");
  }

  if (actor.role === "Admin") return;

  if (!actor.teamId) {
    throw forbidden("staff actor has no assigned team.");
  }

  if (actor.teamId !== incorporationCase.teamId) {
    throw forbidden("this incorporation case belongs to another team.");
  }
}

export function assertIncorporationCaseCreatable(
  actor: AuthenticatedActor,
  input: { teamId: string },
): void {
  assertIncorporationCaseWritable(actor, { teamId: input.teamId });
}
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 3: Commit**

```bash
git add src/features/incorporation/authorization.ts
git commit -m "feat: add incorporation intake authorization"
```

---

## Task 7: Server functions

**Files:**
- Create: `src/features/incorporation/server-fns.ts`

Read `src/features/clients/server-fns.ts` in full first for the
`loadDefaultClientContext`/`getCurrentClientActor`/`withClientRepository` pattern
this mirrors closely.

- [x] **Step 1: Write the server functions**

```ts
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertIncorporationCaseCreatable, assertIncorporationCaseWritable } from "./authorization";
import type { IncorporationRepository } from "./repository";
import { INCORPORATION_STATUSES } from "./types";

const loadDefaultIncorporationContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createIncorporationRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  return { getRequest, requireStaffActor, createIncorporationRepository };
});

async function getCurrentIncorporationActor(): Promise<AuthenticatedActor & { userId: string }> {
  const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
  const actor = await requireStaffActor(getRequest());

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}

async function requireWritableCase(
  repository: IncorporationRepository,
  caseId: string,
): Promise<string> {
  const actor = await getCurrentIncorporationActor();
  const teamId = await repository.getCaseTeamId(caseId);

  if (!teamId) {
    throw new Error("Incorporation case not found.");
  }

  assertIncorporationCaseWritable(actor, { teamId });
  return actor.userId;
}

async function withIncorporationRepository<T>(
  handler: (repository: IncorporationRepository) => Promise<T>,
): Promise<T> {
  const { createIncorporationRepository } = await loadDefaultIncorporationContext();
  const repository = createIncorporationRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

const createCaseSchema = z.object({
  proposedCompanyNameEn: z.string().min(1),
  proposedCompanyNameZh: z.string().nullable(),
  proposedRegisteredOffice: z.string().min(1),
  proposedCompanySecretary: z.string().min(1),
  registeredCapital: z.number().int().positive(),
  businessNature: z.string().min(1),
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  targetCompletionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateChecklistItemSchema = z.object({
  caseId: z.string().uuid(),
  itemId: z.string().uuid(),
  status: z.enum(["Missing", "Received", "Verified", "Rejected"]),
  note: z.string().nullable(),
});

const updateCaseStatusSchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum(INCORPORATION_STATUSES),
});

const completeCaseSchema = z.object({
  caseId: z.string().uuid(),
  crNumber: z.string().min(1),
  brNumber: z.string().min(1),
  incorporationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const listIncorporationCases = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
  await requireStaffActor(getRequest());
  return withIncorporationRepository((repository) => repository.listCases());
});

export const getIncorporationCase = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
    await requireStaffActor(getRequest());
    return withIncorporationRepository((repository) => repository.getCase(data.id));
  });

export const createIncorporationCase = createServerFn({ method: "POST" })
  .validator(createCaseSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) => {
      const actor = await getCurrentIncorporationActor();
      assertIncorporationCaseCreatable(actor, { teamId: data.teamId });
      return repository.createCase({ ...data, actorId: actor.userId });
    }),
  );

export const updateIncorporationChecklistItem = createServerFn({ method: "POST" })
  .validator(updateChecklistItemSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) =>
      repository.updateChecklistItem({
        ...data,
        actorId: await requireWritableCase(repository, data.caseId),
      }),
    ),
  );

export const updateIncorporationCaseStatus = createServerFn({ method: "POST" })
  .validator(updateCaseStatusSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) =>
      repository.updateCaseStatus({
        ...data,
        actorId: await requireWritableCase(repository, data.caseId),
      }),
    ),
  );

export const completeIncorporationCase = createServerFn({ method: "POST" })
  .validator(completeCaseSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) =>
      repository.completeCase({
        ...data,
        actorId: await requireWritableCase(repository, data.caseId),
      }),
    ),
  );
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 3: Commit**

```bash
git add src/features/incorporation/server-fns.ts
git commit -m "feat: add incorporation intake server functions"
```

---

## Task 8: Create-case dialog

**Files:**
- Create: `src/components/incorporation/create-incorporation-case-dialog.tsx`
- Create: `src/components/incorporation/create-incorporation-case-dialog.test.tsx`

Read `src/components/clients/client-form-dialog.tsx` (owner/team select pattern)
and `src/features/annual-return/components/create-case-dialog.tsx` (loading/error
state pattern for options that come from a separate query) first.

- [x] **Step 1: Write the dialog**

```tsx
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createIncorporationCase } from "@/features/incorporation/server-fns";
import type { ClientAssignmentOptions } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owners: ClientAssignmentOptions["owners"];
  teams: ClientAssignmentOptions["teams"];
  isLoading: boolean;
  hasError: boolean;
  onCreated: (caseId: string) => void;
};

type FormState = {
  proposedCompanyNameEn: string;
  proposedCompanyNameZh: string;
  proposedRegisteredOffice: string;
  proposedCompanySecretary: string;
  registeredCapital: string;
  businessNature: string;
  ownerId: string;
  teamId: string;
  targetCompletionDate: string;
};

function emptyForm(owners: ClientAssignmentOptions["owners"], teams: ClientAssignmentOptions["teams"]): FormState {
  return {
    proposedCompanyNameEn: "",
    proposedCompanyNameZh: "",
    proposedRegisteredOffice: "",
    proposedCompanySecretary: "Kossilon Secretaries Ltd",
    registeredCapital: "10000",
    businessNature: "",
    ownerId: owners[0]?.id ?? "",
    teamId: teams[0]?.id ?? "",
    targetCompletionDate: "",
  };
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function CreateIncorporationCaseDialog({
  open,
  onOpenChange,
  owners,
  teams,
  isLoading,
  hasError,
  onCreated,
}: Props) {
  const [form, setForm] = useState<FormState>(() => emptyForm(owners, teams));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initializedRef = useRef(false);

  // Re-derives the form exactly once per open: not on the first render (data
  // is still loading, per isLoading), but the moment loading finishes. Further
  // background refetches while the dialog stays open do NOT re-run this, so a
  // user's in-progress edit is never clobbered — initializedRef only resets
  // when the dialog closes.
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (isLoading || initializedRef.current) return;
    setForm(emptyForm(owners, teams));
    setError(null);
    initializedRef.current = true;
  }, [open, isLoading, owners, teams]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedCapital = form.registeredCapital.trim();
    const parsedCapital = Number.parseInt(trimmedCapital, 10);

    if (!/^\d+$/.test(trimmedCapital) || parsedCapital <= 0) {
      setError("Enter a whole number of dollars greater than zero for registered capital.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const created = await createIncorporationCase({
        data: {
          proposedCompanyNameEn: form.proposedCompanyNameEn,
          proposedCompanyNameZh: form.proposedCompanyNameZh.trim() || null,
          proposedRegisteredOffice: form.proposedRegisteredOffice,
          proposedCompanySecretary: form.proposedCompanySecretary,
          registeredCapital: parsedCapital,
          businessNature: form.businessNature,
          ownerId: form.ownerId,
          teamId: form.teamId,
          targetCompletionDate: form.targetCompletionDate,
        },
      });
      toast.success("Incorporation case created.");
      onCreated(created.id);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the case.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start incorporation</DialogTitle>
          <DialogDescription>
            Track a new HK company's incorporation from intake through Companies Registry
            approval.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hasError ? (
          <p role="alert" className="text-sm text-destructive">
            Unable to load owner or team data. Try again shortly.
          </p>
        ) : owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active staff members are available to assign as owner. Ask an Admin to activate one
            before starting an incorporation case.
          </p>
        ) : teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No teams are configured. Ask an Admin to configure one before starting an incorporation
            case.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intake-name-en">
                  Proposed name (English)
                </label>
                <input
                  id="intake-name-en"
                  className={inputClass}
                  value={form.proposedCompanyNameEn}
                  onChange={(event) => set("proposedCompanyNameEn", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-name-zh">
                  Proposed name (Chinese)
                </label>
                <input
                  id="intake-name-zh"
                  className={inputClass}
                  value={form.proposedCompanyNameZh}
                  onChange={(event) => set("proposedCompanyNameZh", event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="intake-office">
                Proposed registered office
              </label>
              <input
                id="intake-office"
                className={inputClass}
                value={form.proposedRegisteredOffice}
                onChange={(event) => set("proposedRegisteredOffice", event.target.value)}
                required
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="intake-secretary">
                Proposed company secretary
              </label>
              <input
                id="intake-secretary"
                className={inputClass}
                value={form.proposedCompanySecretary}
                onChange={(event) => set("proposedCompanySecretary", event.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intake-capital">
                  Registered capital (HKD)
                </label>
                <input
                  id="intake-capital"
                  type="number"
                  min="1"
                  step="1"
                  className={inputClass}
                  value={form.registeredCapital}
                  onChange={(event) => set("registeredCapital", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-nature">
                  Business nature
                </label>
                <input
                  id="intake-nature"
                  className={inputClass}
                  value={form.businessNature}
                  onChange={(event) => set("businessNature", event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="intake-owner">
                  Owner
                </label>
                <select
                  id="intake-owner"
                  className={inputClass}
                  value={form.ownerId}
                  onChange={(event) => set("ownerId", event.target.value)}
                  required
                >
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-team">
                  Team
                </label>
                <select
                  id="intake-team"
                  className={inputClass}
                  value={form.teamId}
                  onChange={(event) => set("teamId", event.target.value)}
                  required
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="intake-target-date">
                  Target completion date
                </label>
                <input
                  id="intake-target-date"
                  type="date"
                  className={inputClass}
                  value={form.targetCompletionDate}
                  onChange={(event) => set("targetCompletionDate", event.target.value)}
                  required
                />
              </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

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
                {saving ? "Creating…" : "Start incorporation"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [x] **Step 2: Write the test file**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateIncorporationCaseDialog } from "./create-incorporation-case-dialog";

const serverFns = vi.hoisted(() => ({
  createIncorporationCase: vi.fn(),
}));

vi.mock("@/features/incorporation/server-fns", () => ({
  createIncorporationCase: serverFns.createIncorporationCase,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const owners = [{ id: "owner-1", name: "Amy Chan", teamId: "team-1" }];
const teams = [{ id: "team-1", name: "Team Alpha" }];

describe("CreateIncorporationCaseDialog", () => {
  beforeEach(() => {
    serverFns.createIncorporationCase.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a case with the entered fields", async () => {
    serverFns.createIncorporationCase.mockResolvedValue({ id: "case-1" });
    const onCreated = vi.fn();

    render(
      <CreateIncorporationCaseDialog
        open
        onOpenChange={() => {}}
        owners={owners}
        teams={teams}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText("Proposed name (English)"), {
      target: { value: "New Venture Limited" },
    });
    fireEvent.change(screen.getByLabelText("Proposed registered office"), {
      target: { value: "1 Test Street, Hong Kong" },
    });
    fireEvent.change(screen.getByLabelText("Business nature"), {
      target: { value: "Trading" },
    });
    fireEvent.change(screen.getByLabelText("Target completion date"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start incorporation" }));

    await waitFor(() =>
      expect(serverFns.createIncorporationCase).toHaveBeenCalledWith({
        data: {
          proposedCompanyNameEn: "New Venture Limited",
          proposedCompanyNameZh: null,
          proposedRegisteredOffice: "1 Test Street, Hong Kong",
          proposedCompanySecretary: "Kossilon Secretaries Ltd",
          registeredCapital: 10000,
          businessNature: "Trading",
          ownerId: "owner-1",
          teamId: "team-1",
          targetCompletionDate: "2026-09-01",
        },
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("case-1");
  });

  it("rejects a malformed registered capital without calling the server", async () => {
    render(
      <CreateIncorporationCaseDialog
        open
        onOpenChange={() => {}}
        owners={owners}
        teams={teams}
        isLoading={false}
        hasError={false}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Proposed name (English)"), {
      target: { value: "New Venture Limited" },
    });
    fireEvent.change(screen.getByLabelText("Proposed registered office"), {
      target: { value: "1 Test Street, Hong Kong" },
    });
    fireEvent.change(screen.getByLabelText("Business nature"), {
      target: { value: "Trading" },
    });
    fireEvent.change(screen.getByLabelText("Registered capital (HKD)"), {
      target: { value: "5e2" },
    });
    fireEvent.change(screen.getByLabelText("Target completion date"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start incorporation" }));

    expect(
      await screen.findByText(
        "Enter a whole number of dollars greater than zero for registered capital.",
      ),
    ).toBeTruthy();
    expect(serverFns.createIncorporationCase).not.toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.createIncorporationCase.mockRejectedValue(new Error("Owner not found or inactive."));

    render(
      <CreateIncorporationCaseDialog
        open
        onOpenChange={() => {}}
        owners={owners}
        teams={teams}
        isLoading={false}
        hasError={false}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Proposed name (English)"), {
      target: { value: "New Venture Limited" },
    });
    fireEvent.change(screen.getByLabelText("Proposed registered office"), {
      target: { value: "1 Test Street, Hong Kong" },
    });
    fireEvent.change(screen.getByLabelText("Business nature"), {
      target: { value: "Trading" },
    });
    fireEvent.change(screen.getByLabelText("Target completion date"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start incorporation" }));

    expect(await screen.findByText("Owner not found or inactive.")).toBeTruthy();
  });
});
```

- [x] **Step 3: Run the tests**

Run: `npx vitest run src/components/incorporation/create-incorporation-case-dialog.test.tsx`
Expected: all 3 pass.

- [x] **Step 4: Lint**

Run: `npx eslint --fix src/components/incorporation/create-incorporation-case-dialog.tsx src/components/incorporation/create-incorporation-case-dialog.test.tsx`

- [x] **Step 5: Commit**

```bash
git add src/components/incorporation/create-incorporation-case-dialog.tsx src/components/incorporation/create-incorporation-case-dialog.test.tsx
git commit -m "feat: add CreateIncorporationCaseDialog"
```

---

## Task 9: Demo notice component

**Files:**
- Create: `src/features/incorporation/components/demo-incorporation-notice.tsx`

Read `src/features/clients/components/demo-client-notice.tsx` first — this is a
near-identical copy for a second variant.

- [x] **Step 1: Write the component**

```tsx
import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "list" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  list: {
    title: "Incorporation",
    message:
      "Incorporation intake tracks live case data and has no demo fixtures. Sign in to a production environment to use it.",
  },
  detail: {
    title: "Incorporation case",
    message:
      "Incorporation case detail reads live case data and has no demo fixtures. Sign in to a production environment to view one.",
  },
};

export function DemoIncorporationNotice({ variant }: Props) {
  const copy = COPY[variant];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title={copy.title} />
      <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {copy.message}
      </section>
    </main>
  );
}
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 3: Commit**

```bash
git add src/features/incorporation/components/demo-incorporation-notice.tsx
git commit -m "feat: add incorporation demo-mode notice"
```

---

## Task 10: List page component and route

**Files:**
- Create: `src/features/incorporation/components/production-incorporation-list.tsx`
- Create: `src/routes/incorporation.tsx`

Read `src/components/deadline-pill.tsx` and `src/components/status-pill.tsx` for
the two shared components reused here, and
`src/features/clients/components/production-client-register.tsx` for the closest
existing list-screen structure (query + table + create dialog + navigate-on-create).

- [x] **Step 1: Write the list component**

```tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import type { StatusTone } from "@/lib/status";
import { CreateIncorporationCaseDialog } from "@/components/incorporation/create-incorporation-case-dialog";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";
import { listIncorporationCases } from "../server-fns";
import type { IncorporationStatus } from "../types";

const statusTone: Record<IncorporationStatus, StatusTone> = {
  Intake: "neutral",
  "Documents pending": "yellow",
  "Ready to file": "yellow",
  "Filed with Registrar": "yellow",
  Completed: "green",
};

export function ProductionIncorporationList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const casesQuery = useQuery({
    queryKey: ["incorporation-cases"],
    queryFn: () => listIncorporationCases(),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  if (casesQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        Loading incorporation cases
      </div>
    );
  }

  if (casesQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Operations" title="Incorporation" />
        <p role="alert" className="text-sm text-destructive">
          Incorporation case data is unavailable. Try again shortly.
        </p>
      </main>
    );
  }

  const cases = casesQuery.data ?? [];

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Operations"
        title="Incorporation"
        subtitle="New-HK-company intake, from case creation through Companies Registry approval."
        actions={
          optionsQuery.data ? (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Start incorporation
            </button>
          ) : null
        }
      />

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Owner and team options are unavailable. Starting a new case is disabled until this loads.
        </p>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="divide-y">
          {cases.map((incorporationCase) => (
            <div
              key={incorporationCase.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span className="min-w-0 truncate font-medium">
                {incorporationCase.proposedCompanyNameEn}
              </span>
              <StatusPill tone={statusTone[incorporationCase.status]}>
                {incorporationCase.status}
              </StatusPill>
              {incorporationCase.status !== "Completed" ? (
                <DeadlinePill dueDate={incorporationCase.targetCompletionDate} />
              ) : null}
              <span className="text-muted-foreground">{incorporationCase.ownerName}</span>
              <Link
                to="/incorporation/$id"
                params={{ id: incorporationCase.id }}
                className="rounded-md border px-2 py-1 text-xs"
              >
                Open
              </Link>
            </div>
          ))}
          {cases.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No incorporation cases yet.</p>
          ) : null}
        </div>
      </section>

      {optionsQuery.data ? (
        <CreateIncorporationCaseDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          owners={optionsQuery.data.owners}
          teams={optionsQuery.data.teams}
          isLoading={false}
          hasError={false}
          onCreated={(caseId) => {
            void queryClient.invalidateQueries({ queryKey: ["incorporation-cases"] });
            void navigate({ to: "/incorporation/$id", params: { id: caseId } });
          }}
        />
      ) : null}
    </main>
  );
}
```

- [x] **Step 2: Write the route**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationList } from "@/features/incorporation/components/production-incorporation-list";

export const Route = createFileRoute("/incorporation")({
  component: IncorporationRoute,
});

function IncorporationRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="list" />
  ) : (
    <ProductionIncorporationList />
  );
}
```

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: TanStack Router's file-based routing regenerates `routeTree.gen.ts`
automatically on dev-server start; if this typecheck is run without the dev
server having run at least once since this file was added, `/incorporation/$id`
(from Task 11, not yet created) will not yet be a known route type. This is
expected at this point in the plan — Task 11 adds that route file, and a
subsequent full typecheck (Task 12) will be clean once both exist.

- [x] **Step 4: Commit**

```bash
git add src/features/incorporation/components/production-incorporation-list.tsx src/routes/incorporation.tsx
git commit -m "feat: add /incorporation list route"
```

---

## Task 11: Detail page component and route

**Files:**
- Create: `src/features/incorporation/components/production-incorporation-detail.tsx`
- Create: `src/routes/incorporation.$id.tsx`

- [x] **Step 1: Write the detail component**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import {
  completeIncorporationCase,
  getIncorporationCase,
  updateIncorporationCaseStatus,
  updateIncorporationChecklistItem,
} from "../server-fns";
import { INCORPORATION_STATUSES } from "../types";
import type { ChecklistItemStatus, IncorporationStatus } from "../types";

const statusTone: Record<ChecklistItemStatus, StatusTone> = {
  Missing: "neutral",
  Received: "yellow",
  Verified: "green",
  Rejected: "red",
};

function nextStatus(current: IncorporationStatus): IncorporationStatus | null {
  const index = INCORPORATION_STATUSES.indexOf(current);
  return index >= 0 && index < INCORPORATION_STATUSES.length - 1
    ? INCORPORATION_STATUSES[index + 1]
    : null;
}

export function ProductionIncorporationDetail({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [completionForm, setCompletionForm] = useState({
    crNumber: "",
    brNumber: "",
    incorporationDate: "",
  });
  const [completionError, setCompletionError] = useState<string | null>(null);

  const caseQuery = useQuery({
    queryKey: ["incorporation-cases", caseId],
    queryFn: () => getIncorporationCase({ data: { id: caseId } }),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["incorporation-cases", caseId] });
    void queryClient.invalidateQueries({ queryKey: ["incorporation-cases"] });
  }

  const advanceStatus = useMutation({
    mutationFn: (status: IncorporationStatus) =>
      updateIncorporationCaseStatus({ data: { caseId, status } }),
    onSuccess: invalidate,
    onError: () => toast.error("Unable to update the case status. Try again."),
  });

  const updateItem = useMutation({
    mutationFn: (input: { itemId: string; status: ChecklistItemStatus; note: string | null }) =>
      updateIncorporationChecklistItem({ data: { caseId, ...input } }),
    onSuccess: invalidate,
    onError: () => toast.error("Unable to update the checklist item. Try again."),
  });

  const complete = useMutation({
    mutationFn: () =>
      completeIncorporationCase({
        data: {
          caseId,
          crNumber: completionForm.crNumber,
          brNumber: completionForm.brNumber,
          incorporationDate: completionForm.incorporationDate,
        },
      }),
    onSuccess: (result) => {
      toast.success("Incorporation complete — company created.");
      invalidate();
      if (result.companyId) {
        void navigate({ to: "/clients/$id", params: { id: result.companyId } });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to complete the case.";
      setCompletionError(message);
      toast.error(message);
    },
  });

  if (caseQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        Loading case
      </div>
    );
  }

  const incorporationCase = caseQuery.data;

  if (caseQuery.isError || !incorporationCase) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Incorporation" title="Case unavailable" />
        <p role="alert" className="text-sm text-destructive">
          Case data is unavailable. Try again shortly.
        </p>
      </main>
    );
  }

  const upcoming = nextStatus(incorporationCase.status);

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Incorporation"
        title={incorporationCase.proposedCompanyNameEn}
        subtitle={`Target completion ${incorporationCase.targetCompletionDate}`}
      />

      <section className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Status
          </p>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill tone={incorporationCase.status === "Completed" ? "green" : "yellow"}>
              {incorporationCase.status}
            </StatusPill>
            {upcoming ? (
              <button
                type="button"
                onClick={() => advanceStatus.mutate(upcoming)}
                disabled={advanceStatus.isPending}
                className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
              >
                Advance to {upcoming}
              </button>
            ) : null}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Owner / team
          </p>
          <p className="mt-1 text-sm">
            {incorporationCase.ownerName} · {incorporationCase.teamName}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Registered office
          </p>
          <p className="mt-1 text-sm">{incorporationCase.proposedRegisteredOffice}</p>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Checklist</h2>
        <div className="divide-y">
          {incorporationCase.checklist.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 truncate text-sm">{item.itemLabel}</span>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={statusTone[item.status]}>{item.status}</StatusPill>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  value={item.status}
                  onChange={(event) =>
                    updateItem.mutate({
                      itemId: item.id,
                      status: event.target.value as ChecklistItemStatus,
                      note: item.note,
                    })
                  }
                  disabled={updateItem.isPending}
                >
                  <option value="Missing">Missing</option>
                  <option value="Received">Received</option>
                  <option value="Verified">Verified</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>

      {incorporationCase.status === "Filed with Registrar" ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Complete intake</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();

              if (!completionForm.crNumber.trim() || !completionForm.brNumber.trim()) {
                setCompletionError("CR number and BR number are required.");
                return;
              }

              setCompletionError(null);
              complete.mutate();
            }}
            className="grid grid-cols-1 gap-4 md:grid-cols-3"
          >
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="complete-cr">
                CR number
              </label>
              <input
                id="complete-cr"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                value={completionForm.crNumber}
                onChange={(event) =>
                  setCompletionForm((current) => ({ ...current, crNumber: event.target.value }))
                }
                required
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="complete-br">
                BR number
              </label>
              <input
                id="complete-br"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                value={completionForm.brNumber}
                onChange={(event) =>
                  setCompletionForm((current) => ({ ...current, brNumber: event.target.value }))
                }
                required
              />
            </div>
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="complete-incorporation-date"
              >
                Incorporation date
              </label>
              <input
                id="complete-incorporation-date"
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                value={completionForm.incorporationDate}
                onChange={(event) =>
                  setCompletionForm((current) => ({
                    ...current,
                    incorporationDate: event.target.value,
                  }))
                }
                required
              />
            </div>
            {completionError && (
              <p className="text-xs text-destructive md:col-span-3">{completionError}</p>
            )}
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={complete.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {complete.isPending ? "Completing…" : "Complete intake"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
```

- [x] **Step 2: Write the route**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationDetail } from "@/features/incorporation/components/production-incorporation-detail";

export const Route = createFileRoute("/incorporation/$id")({
  component: IncorporationDetailRoute,
});

function IncorporationDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="detail" />
  ) : (
    <ProductionIncorporationDetail caseId={id} />
  );
}
```

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean now that both `/incorporation` and `/incorporation/$id` exist and
`routeTree.gen.ts` has regenerated (run `npm run dev` briefly and stop it, or
`npm run build`, if the generated route tree hasn't picked up the new files yet).

- [x] **Step 4: Commit**

```bash
git add src/features/incorporation/components/production-incorporation-detail.tsx src/routes/incorporation.\$id.tsx
git commit -m "feat: add /incorporation/\$id detail route"
```

---

## Task 12: Navigation entry

**Files:**
- Modify: `src/components/navigation.ts`

- [x] **Step 1: Add the nav item**

Add `Rocket` to the `lucide-react` import list (alongside `Building2` etc.), and
add a new entry to the `"Operations"` group's `items` array, immediately after
`{ to: "/clients", label: "Clients", icon: Building2 }`:

```ts
{ to: "/incorporation", label: "Incorporation", icon: Rocket },
```

- [x] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [x] **Step 3: Commit**

```bash
git add src/components/navigation.ts
git commit -m "feat: add Incorporation to the primary navigation"
```

---

## Task 13: Full verification sweep

**Files:** none (verification only)

- [x] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the repo.

- [x] **Step 2: Full lint**

Run: `npm run lint`
Expected: no new errors (the pre-existing `work-queue.tsx` fast-refresh warning
may remain).

- [x] **Step 3: Full test suite**

Run: `npm test`
Expected: all non-DB tests pass; DB-integration tests skip locally.

- [x] **Step 4: Offline pre-deploy gate**

Run: `npm run verify:firm -- --dry-run`
Expected: passes, including `migration-schema` for migration 0017.

- [x] **Step 5: Confirm the app's own page-header convention holds**

`src/components/page-header.convention.test.ts` scans all routes and enforces
every screen renders `<PageHeader>` as the first child of `<main>`. Both new
routes' components already do this (see Tasks 10-11); run the full suite (Step 3)
and confirm this test file specifically passes with no changes needed to it.

- [x] **Step 6: Manual smoke test in demo mode**

Start the dev server and confirm `/incorporation` and `/incorporation/$id` (any
id) both render their explanatory "no demo data" notices with no crash, and that
the new "Incorporation" nav entry appears and links correctly. This feature has
no fixture-backed demo tier by design (see Task 9); production-mode UI cannot be
exercised in this sandbox due to the pre-existing `NEON_AUTH_URL is required`
limitation documented in earlier roadmap work — disclose this rather than
claiming a full production-mode smoke test.

- [x] **Step 7: Dispatch a final holistic code review of the whole branch diff**

Compare the full diff against
`docs/superpowers/specs/2026-08-22-incorporation-intake-design.md` for spec
compliance. Specifically re-verify: (a) `completeCase`'s company insert matches
every `not null` column on `companies` with no gaps; (b) the `oneYearLater` leap-
year edge case is handled correctly and matches the statutory anniversary rule,
not an off-by-one; (c) no other file in the repo assumes `work_items`/`documents`
can represent a pre-company case (an adversarial grep for anything that might
have been quietly extended to reference `incorporation_cases` in a way this plan
didn't intend); (d) the new `incorporation_cases`/`incorporation_checklist_items`
tables' test cleanup ordering is correct, mirroring the lesson from
[[feedback_schema_migration_raw_sql_sweep]] and this session's repeated
`on delete restrict`-cleanup incidents.

- [x] **Step 8: Confirm CI is green in an actual CI run before merging**

After pushing and opening the PR, wait for the `verify` CI job (DB-integration
suite against a real database) to report `SUCCESS` before treating this item as
done.

---

## Self-Review Notes

- **Spec coverage**: schema (Task 1), types/workflow (Tasks 2-3), repository
  including the critical cleanup-ordering requirement (Tasks 4-5), authorization/
  server-fns (Tasks 6-7), UI including the no-demo-tier decision (Tasks 8-11),
  navigation (Task 12), and the CI-confirmation acceptance criterion (Task 13) all
  have a task. No gaps found against the design spec's five sections.
- **Placeholder scan**: no TBD/TODO; every step has real code.
- **Type consistency**: `IncorporationCase`, `IncorporationChecklistItem`,
  `IncorporationStatus`, `ChecklistItemStatus`, and the four input types are
  defined once in Task 2 and referenced identically (same field names) across
  Tasks 4, 7, 8, 10, 11 — checked for drift across all tasks. `registeredCapital`
  is consistently `number` (TS) / `integer` (SQL) end to end, matching the
  Task 1 fix from `numeric` to `integer`.
- **Post-writing addendum (found during Task 4's code-quality review, applied
  before Task 5 was dispatched)**: `completeCase` originally had no row lock
  guarding its check-then-act status transition — two concurrent completions of
  the same case could both pass the status guard and both create a `companies`
  row, exactly the class of bug this codebase already fixed twice
  (`appointOfficer`'s secretary/DR race, `annual-return/repository.ts`'s
  `createCase`). Fixed by adding `select id from incorporation_cases where id =
  ${input.caseId} for update` as the first statement inside `completeCase`'s
  transaction, and Task 5's test file now includes a genuine two-connection
  race test for it (added after Task 4 committed, before Task 1's constraint
  fix and Task 2's naming fix were also folded in) — both fixes are reflected
  in the Task 4/5 code blocks above, not just this note.
