# Annual Return Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a database-backed Annual Return Control Center for Kossilon CoSec OS, with auto-generated 90-day annual-return cases, deadline-first views, strict completion gates, manual reminder logging, and audit timeline records.

**Architecture:** Keep the existing TanStack Start app and move annual-return workflows from mock data into a focused Neon/Postgres-backed feature module. Put pure workflow rules in `src/features/annual-return/`, Postgres access in `src/server/db/`, and route-facing server functions in `src/features/annual-return/server-fns.ts`. Update `/annual-returns`, `/annual-returns/$id`, and dashboard metrics to consume this backend slice while leaving unrelated prototype routes on mock data.

**Tech Stack:** TanStack Start, React 19, TypeScript, Bun, Neon/Postgres via `postgres`, Vitest for pure logic tests, raw SQL migrations.

---

## File Structure

- Create `src/features/annual-return/types.ts`: shared annual-return domain types and constants.
- Create `src/features/annual-return/workflow.ts`: deadline calculation, risk thresholds, status transitions, completion blocker logic, reminder draft builder.
- Create `src/features/annual-return/workflow.test.ts`: pure unit tests for workflow rules.
- Create `src/server/db/client.ts`: Neon SQL client factory with clear `DATABASE_URL` error.
- Create `src/server/db/schema.sql`: canonical schema text for local inspection.
- Create `db/migrations/0001_annual_return_control_center.sql`: initial database schema.
- Create `scripts/db-migrate.ts`: applies SQL migrations in order.
- Create `scripts/db-seed-annual-return.ts`: seeds users, teams, companies, and annual-return cases.
- Create `src/features/annual-return/repository.ts`: typed SQL reads/writes for annual-return data.
- Create `src/features/annual-return/repository.test.ts`: repository smoke tests gated by `TEST_DATABASE_URL`.
- Create `src/features/annual-return/server-fns.ts`: TanStack Start server functions for list, detail, status update, reminder log, checklist update, payment update, filing update, completion.
- Modify `src/routes/annual-returns.tsx`: deadline-first list with board toggle and filters.
- Modify `src/routes/annual-returns.$id.tsx`: real case workspace and server-backed actions.
- Modify `src/routes/index.tsx`: dashboard annual-return metrics read from server data.
- Modify `package.json`: add database and test scripts plus dependencies.

## Task 1: Add Test And Database Tooling

**Files:**
- Modify: `package.json`
- Create: `src/features/annual-return/types.ts`
- Create: `src/features/annual-return/workflow.ts`
- Create: `src/features/annual-return/workflow.test.ts`

- [ ] **Step 1: Install dependencies**

Run:

```bash
bun add postgres
bun add -d vitest dotenv
```

Expected: `package.json` and `bun.lock` update with `postgres`, `vitest`, and `dotenv`.

- [ ] **Step 2: Add scripts to `package.json`**

Add these scripts alongside the existing scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "db:migrate": "bun scripts/db-migrate.ts",
  "db:seed": "bun scripts/db-seed-annual-return.ts"
}
```

Expected: `bun run test` invokes Vitest.

- [ ] **Step 3: Create the domain types**

Create `src/features/annual-return/types.ts`:

```ts
export const ANNUAL_RETURN_STATUSES = [
  "Upcoming",
  "Client reminder sent",
  "Documents pending",
  "Documents received",
  "Payment pending",
  "Payment received",
  "NAR1 prepared",
  "Signature pending",
  "Ready to file",
  "Filed",
  "Completed",
] as const;

export type AnnualReturnStatus = (typeof ANNUAL_RETURN_STATUSES)[number];

export type RiskLevel = "green" | "yellow" | "orange" | "red";

export type PaymentStatus = "Not invoiced" | "Payment pending" | "Payment received" | "Overdue";

export type ChecklistStatus = "Missing" | "Received" | "Verified" | "Rejected";

export type AnnualReturnCompany = {
  id: string;
  companyName: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  status: "active" | "inactive";
  assignedOwnerId: string;
  assignedTeamId: string;
};

export type AnnualReturnChecklistItem = {
  id: string;
  caseId: string;
  itemLabel: string;
  required: boolean;
  status: ChecklistStatus;
  dueDate: string;
  receivedAt: string | null;
  verifiedAt: string | null;
  documentId: string | null;
};

export type AnnualReturnPayment = {
  id: string;
  caseId: string;
  invoiceNumber: string;
  amount: number;
  currency: "HKD";
  status: PaymentStatus;
  dueDate: string;
  paidAt: string | null;
  paymentProofDocumentId: string | null;
};

export type AnnualReturnCase = {
  id: string;
  companyId: string;
  companyName: string;
  returnYear: number;
  madeUpDate: string;
  filingDueDate: string;
  currentStatus: AnnualReturnStatus;
  riskLevel: RiskLevel;
  ownerId: string;
  ownerName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  remindersSent: number;
  filingReference: string | null;
  confirmationDocumentId: string | null;
  lockedAt: string | null;
  completedAt: string | null;
  checklist: AnnualReturnChecklistItem[];
  payment: AnnualReturnPayment | null;
};

export type CompletionBlocker = {
  code:
    | "required_checklist_unverified"
    | "payment_not_received"
    | "filing_reference_missing"
    | "confirmation_document_missing";
  message: string;
};
```

- [ ] **Step 4: Write failing workflow tests**

Create `src/features/annual-return/workflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ANNUAL_RETURN_STATUSES,
  buildReminderDraft,
  calculateFilingDueDate,
  completionBlockers,
  isAllowedStatusTransition,
  riskForCase,
  shouldGenerateCase,
} from "./workflow";
import type { AnnualReturnCase } from "./types";

const baseCase: AnnualReturnCase = {
  id: "case-1",
  companyId: "company-1",
  companyName: "Harbour Trading Ltd",
  returnYear: 2026,
  madeUpDate: "2026-07-01",
  filingDueDate: "2026-08-12",
  currentStatus: "Documents pending",
  riskLevel: "green",
  ownerId: "user-1",
  ownerName: "Amy Chan",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 0,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [
    {
      id: "item-1",
      caseId: "case-1",
      itemLabel: "Signed NAR1 form",
      required: true,
      status: "Missing",
      dueDate: "2026-08-05",
      receivedAt: null,
      verifiedAt: null,
      documentId: null,
    },
  ],
  payment: {
    id: "payment-1",
    caseId: "case-1",
    invoiceNumber: "INV-2026-001",
    amount: 3800,
    currency: "HKD",
    status: "Payment pending",
    dueDate: "2026-08-01",
    paidAt: null,
    paymentProofDocumentId: null,
  },
};

describe("annual return workflow", () => {
  it("calculates the filing due date as 42 days after the basis date", () => {
    expect(calculateFilingDueDate("2026-07-01")).toBe("2026-08-12");
  });

  it("generates cases inside the 90-day window only", () => {
    expect(shouldGenerateCase("2026-08-12", "2026-05-14")).toBe(false);
    expect(shouldGenerateCase("2026-08-12", "2026-05-15")).toBe(true);
    expect(shouldGenerateCase("2026-08-12", "2026-08-13")).toBe(true);
  });

  it("uses yellow, orange, and red risk thresholds", () => {
    expect(riskForCase(baseCase, "2026-07-13")).toBe("yellow");
    expect(riskForCase(baseCase, "2026-07-30")).toBe("orange");
    expect(riskForCase(baseCase, "2026-08-06")).toBe("red");
    expect(riskForCase(baseCase, "2026-08-13")).toBe("red");
  });

  it("allows only forward lifecycle transitions for normal staff flow", () => {
    expect(isAllowedStatusTransition("Upcoming", "Client reminder sent")).toBe(true);
    expect(isAllowedStatusTransition("Payment pending", "Payment received")).toBe(true);
    expect(isAllowedStatusTransition("Payment received", "Documents pending")).toBe(false);
    expect(isAllowedStatusTransition("Completed", "Filed")).toBe(false);
  });

  it("exposes the approved status lifecycle in order", () => {
    expect(ANNUAL_RETURN_STATUSES).toEqual([
      "Upcoming",
      "Client reminder sent",
      "Documents pending",
      "Documents received",
      "Payment pending",
      "Payment received",
      "NAR1 prepared",
      "Signature pending",
      "Ready to file",
      "Filed",
      "Completed",
    ]);
  });

  it("blocks completion until evidence is present", () => {
    expect(completionBlockers(baseCase).map((b) => b.code)).toEqual([
      "required_checklist_unverified",
      "payment_not_received",
      "filing_reference_missing",
      "confirmation_document_missing",
    ]);
  });

  it("allows completion when required evidence is present", () => {
    const ready: AnnualReturnCase = {
      ...baseCase,
      currentStatus: "Filed",
      filingReference: "CR-NAR1-2026-0001",
      confirmationDocumentId: "doc-confirmation",
      checklist: [
        {
          ...baseCase.checklist[0],
          status: "Verified",
          receivedAt: "2026-07-20T09:00:00.000Z",
          verifiedAt: "2026-07-21T09:00:00.000Z",
          documentId: "doc-1",
        },
      ],
      payment: {
        ...baseCase.payment!,
        status: "Payment received",
        paidAt: "2026-07-21T10:00:00.000Z",
        paymentProofDocumentId: "doc-proof",
      },
    };

    expect(completionBlockers(ready)).toEqual([]);
  });

  it("builds a staff-copyable WhatsApp reminder draft", () => {
    expect(buildReminderDraft(baseCase)).toContain("Harbour Trading Ltd");
    expect(buildReminderDraft(baseCase)).toContain("2026-08-12");
    expect(buildReminderDraft(baseCase)).toContain("Signed NAR1 form");
  });
});
```

- [ ] **Step 5: Run the tests and verify they fail**

Run:

```bash
bun run test src/features/annual-return/workflow.test.ts
```

Expected: FAIL because `src/features/annual-return/workflow.ts` does not export the required functions yet.

- [ ] **Step 6: Implement workflow helpers**

Create `src/features/annual-return/workflow.ts`:

```ts
import {
  ANNUAL_RETURN_STATUSES,
  type AnnualReturnCase,
  type AnnualReturnStatus,
  type CompletionBlocker,
  type RiskLevel,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(date: string): Date {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
}

export function calculateFilingDueDate(annualReturnBasisDate: string): string {
  const due = parseDateOnly(annualReturnBasisDate);
  due.setUTCDate(due.getUTCDate() + 42);
  return formatDateOnly(due);
}

export function shouldGenerateCase(filingDueDate: string, today: string): boolean {
  return daysBetween(today, filingDueDate) <= 90;
}

export function riskForCase(case_: AnnualReturnCase, today: string): RiskLevel {
  const daysLeft = daysBetween(today, case_.filingDueDate);
  const missingRequired = case_.checklist.some(
    (item) => item.required && item.status !== "Verified",
  );
  const paymentIncomplete = case_.payment?.status !== "Payment received";
  const filingIncomplete = !case_.filingReference || !case_.confirmationDocumentId;

  if (daysLeft < 0) return "red";
  if (daysLeft <= 7 && (missingRequired || paymentIncomplete || filingIncomplete)) return "red";
  if (daysLeft <= 14 && missingRequired) return "orange";
  if (daysLeft <= 30 && (missingRequired || paymentIncomplete)) return "yellow";
  return "green";
}

export function isAllowedStatusTransition(
  from: AnnualReturnStatus,
  to: AnnualReturnStatus,
): boolean {
  const fromIndex = ANNUAL_RETURN_STATUSES.indexOf(from);
  const toIndex = ANNUAL_RETURN_STATUSES.indexOf(to);
  return toIndex === fromIndex + 1;
}

export function completionBlockers(case_: AnnualReturnCase): CompletionBlocker[] {
  const blockers: CompletionBlocker[] = [];
  const unverifiedRequired = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  );

  if (unverifiedRequired.length > 0) {
    blockers.push({
      code: "required_checklist_unverified",
      message: `${unverifiedRequired.length} required checklist item${
        unverifiedRequired.length === 1 ? " is" : "s are"
      } not verified.`,
    });
  }

  if (case_.payment?.status !== "Payment received") {
    blockers.push({
      code: "payment_not_received",
      message: "Payment must be marked as received.",
    });
  }

  if (!case_.filingReference) {
    blockers.push({
      code: "filing_reference_missing",
      message: "Filing reference is required.",
    });
  }

  if (!case_.confirmationDocumentId) {
    blockers.push({
      code: "confirmation_document_missing",
      message: "Filing confirmation document is required.",
    });
  }

  return blockers;
}

export function buildReminderDraft(case_: AnnualReturnCase): string {
  const missingItems = case_.checklist
    .filter((item) => item.required && item.status !== "Verified")
    .map((item) => `- ${item.itemLabel}`)
    .join("\n");

  const missingSection =
    missingItems.length > 0
      ? `We are still waiting for:\n${missingItems}`
      : "All required documents are recorded. We will continue preparing the filing.";

  return [
    `Hello, this is Kossilon following up on the annual return for ${case_.companyName}.`,
    `The filing deadline is ${case_.filingDueDate}.`,
    missingSection,
    "Please send the outstanding items as soon as possible so we can avoid late filing risk.",
    "Thank you.",
  ].join("\n\n");
}
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
bun run test src/features/annual-return/workflow.test.ts
```

Expected: PASS.

Commit:

```bash
git add package.json bun.lock src/features/annual-return/types.ts src/features/annual-return/workflow.ts src/features/annual-return/workflow.test.ts
git commit -m "feat: add annual return workflow rules"
```

## Task 2: Add Database Schema And Migration Runner

**Files:**
- Create: `db/migrations/0001_annual_return_control_center.sql`
- Create: `src/server/db/schema.sql`
- Create: `src/server/db/client.ts`
- Create: `scripts/db-migrate.ts`

- [ ] **Step 1: Create migration SQL**

Create `db/migrations/0001_annual_return_control_center.sql`:

```sql
create extension if not exists pgcrypto;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manager_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('Admin', 'Manager', 'Staff')),
  team_id uuid references teams(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table teams
  add constraint teams_manager_id_fkey
  foreign key (manager_id) references users(id)
  deferrable initially deferred;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  cr_number text not null unique,
  br_number text not null unique,
  incorporation_date date not null,
  annual_return_basis_date date not null,
  registered_office text not null,
  company_secretary text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  assigned_owner_id uuid not null references users(id),
  assigned_team_id uuid not null references teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  case_id uuid,
  file_type text not null,
  file_name text not null,
  storage_url text not null,
  upload_source text not null check (upload_source in ('staff', 'client', 'system')),
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now(),
  verified_by uuid references users(id),
  verified_at timestamptz
);

create table if not exists annual_return_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  return_year integer not null,
  made_up_date date not null,
  filing_due_date date not null,
  current_status text not null check (
    current_status in (
      'Upcoming',
      'Client reminder sent',
      'Documents pending',
      'Documents received',
      'Payment pending',
      'Payment received',
      'NAR1 prepared',
      'Signature pending',
      'Ready to file',
      'Filed',
      'Completed'
    )
  ),
  risk_level text not null default 'green' check (risk_level in ('green', 'yellow', 'orange', 'red')),
  owner_id uuid not null references users(id),
  reviewer_id uuid references users(id),
  reminders_sent integer not null default 0,
  filing_reference text,
  confirmation_document_id uuid references documents(id),
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, return_year)
);

alter table documents
  add constraint documents_case_id_fkey
  foreign key (case_id) references annual_return_cases(id) on delete cascade
  deferrable initially deferred;

create table if not exists annual_return_checklist_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'Missing' check (status in ('Missing', 'Received', 'Verified', 'Rejected')),
  due_date date not null,
  received_at timestamptz,
  verified_at timestamptz,
  document_id uuid references documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  invoice_number text not null,
  amount integer not null,
  currency text not null default 'HKD',
  status text not null default 'Payment pending' check (status in ('Not invoiced', 'Payment pending', 'Payment received', 'Overdue')),
  due_date date not null,
  paid_at timestamptz,
  payment_proof_document_id uuid references documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id)
);

create table if not exists timeline_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  case_id uuid references annual_return_cases(id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('system', 'user')),
  actor_id uuid references users(id),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reminder_logs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  channel text not null default 'WhatsApp',
  template_label text not null,
  recipient_name text not null,
  recipient_phone text not null,
  draft_body text not null,
  recorded_sent_at timestamptz not null,
  staff_actor_id uuid not null references users(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists annual_return_cases_due_idx on annual_return_cases (filing_due_date);
create index if not exists annual_return_cases_status_idx on annual_return_cases (current_status);
create index if not exists annual_return_cases_risk_idx on annual_return_cases (risk_level);
create index if not exists annual_return_cases_owner_idx on annual_return_cases (owner_id);
create index if not exists checklist_case_idx on annual_return_checklist_items (case_id);
create index if not exists timeline_case_created_idx on timeline_events (case_id, created_at desc);
```

- [ ] **Step 2: Copy schema for inspection**

Create `src/server/db/schema.sql` with the exact same SQL content as `db/migrations/0001_annual_return_control_center.sql`.

- [ ] **Step 3: Create database client**

Create `src/server/db/client.ts`:

```ts
import postgres, { type Sql } from "postgres";

export type SqlClient = Sql;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for Annual Return Control Center data access.");
  }
  return url;
}

export function createSqlClient(url = getDatabaseUrl()): SqlClient {
  return postgres(url, {
    ssl: "require",
    max: 1,
  });
}

export const sql = createSqlClient();
```

- [ ] **Step 4: Create migration runner**

Create `scripts/db-migrate.ts`:

```ts
import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
});
const migrationsDir = join(process.cwd(), "db", "migrations");

await sql`
  create table if not exists schema_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  )
`;

const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  const applied = await sql`
    select id from schema_migrations where id = ${file}
  `;

  if (applied.length > 0) {
    console.log(`Skipping ${file}`);
    continue;
  }

  const body = await readFile(join(migrationsDir, file), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into schema_migrations (id) values (${file})`;
  });
  console.log(`Applied ${file}`);
}

await sql.end();
```

- [ ] **Step 5: Run migration**

Run:

```bash
bun run db:migrate
```

Expected: `Applied 0001_annual_return_control_center.sql` on first run. A second run should print `Skipping 0001_annual_return_control_center.sql`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0001_annual_return_control_center.sql src/server/db/schema.sql src/server/db/client.ts scripts/db-migrate.ts package.json bun.lock
git commit -m "feat: add annual return database schema"
```

## Task 3: Seed Annual Return Data

**Files:**
- Create: `scripts/db-seed-annual-return.ts`

- [ ] **Step 1: Write seed script**

Create `scripts/db-seed-annual-return.ts`:

```ts
import "dotenv/config";
import postgres from "postgres";
import { calculateFilingDueDate } from "../src/features/annual-return/workflow";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed annual return data.");
}

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
});

const teams = [
  { id: "10000000-0000-0000-0000-000000000001", name: "Filing Team A" },
  { id: "10000000-0000-0000-0000-000000000002", name: "Filing Team B" },
];

const users = [
  {
    id: "20000000-0000-0000-0000-000000000001",
    name: "Amy Chan",
    email: "amy@kossilon.hk",
    role: "Admin",
    teamId: teams[0].id,
  },
  {
    id: "20000000-0000-0000-0000-000000000002",
    name: "Ken Wong",
    email: "ken@kossilon.hk",
    role: "Manager",
    teamId: teams[0].id,
  },
  {
    id: "20000000-0000-0000-0000-000000000003",
    name: "Mei Lam",
    email: "mei@kossilon.hk",
    role: "Staff",
    teamId: teams[0].id,
  },
  {
    id: "20000000-0000-0000-0000-000000000004",
    name: "Priya Singh",
    email: "priya@kossilon.hk",
    role: "Manager",
    teamId: teams[1].id,
  },
];

const companies = [
  {
    id: "30000000-0000-0000-0000-000000000001",
    companyName: "Harbour Trading Ltd",
    crNumber: "1200001",
    brNumber: "60000001",
    incorporationDate: "2021-07-01",
    basisDate: "2026-07-01",
    registeredOffice: "Room 1201, Central Plaza, Hong Kong",
    companySecretary: "Kossilon Corporate Services Limited",
    ownerId: users[0].id,
    teamId: teams[0].id,
    status: "Documents pending",
  },
  {
    id: "30000000-0000-0000-0000-000000000002",
    companyName: "Kowloon Textiles Ltd",
    crNumber: "1200042",
    brNumber: "60000138",
    incorporationDate: "2020-06-15",
    basisDate: "2026-06-15",
    registeredOffice: "Unit 8, Kwun Tong Industrial Centre, Hong Kong",
    companySecretary: "Kossilon Corporate Services Limited",
    ownerId: users[2].id,
    teamId: teams[0].id,
    status: "Payment pending",
  },
  {
    id: "30000000-0000-0000-0000-000000000003",
    companyName: "Victoria Peak Holdings",
    crNumber: "1200083",
    brNumber: "60000275",
    incorporationDate: "2019-05-20",
    basisDate: "2026-05-20",
    registeredOffice: "18/F, Admiralty Centre, Hong Kong",
    companySecretary: "Kossilon Corporate Services Limited",
    ownerId: users[3].id,
    teamId: teams[1].id,
    status: "Filed",
  },
];

const checklistLabels = [
  "Signed NAR1 form",
  "Register of members (updated)",
  "Register of directors",
  "Register of secretaries",
  "Business registration certificate copy",
  "Proof of registered office address",
  "ID copies of all directors",
];

await sql.begin(async (tx) => {
  for (const team of teams) {
    await tx`
      insert into teams (id, name)
      values (${team.id}, ${team.name})
      on conflict (id) do update set name = excluded.name
    `;
  }

  for (const user of users) {
    await tx`
      insert into users (id, name, email, role, team_id)
      values (${user.id}, ${user.name}, ${user.email}, ${user.role}, ${user.teamId})
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        role = excluded.role,
        team_id = excluded.team_id
    `;
  }

  await tx`update teams set manager_id = ${users[1].id} where id = ${teams[0].id}`;
  await tx`update teams set manager_id = ${users[3].id} where id = ${teams[1].id}`;
});

for (const company of companies) {
  const dueDate = calculateFilingDueDate(company.basisDate);

  await sql.begin(async (tx) => {
    await tx`
      insert into companies (
        id,
        company_name,
        cr_number,
        br_number,
        incorporation_date,
        annual_return_basis_date,
        registered_office,
        company_secretary,
        assigned_owner_id,
        assigned_team_id
      )
      values (
        ${company.id},
        ${company.companyName},
        ${company.crNumber},
        ${company.brNumber},
        ${company.incorporationDate},
        ${company.basisDate},
        ${company.registeredOffice},
        ${company.companySecretary},
        ${company.ownerId},
        ${company.teamId}
      )
      on conflict (id) do update set
        company_name = excluded.company_name,
        annual_return_basis_date = excluded.annual_return_basis_date,
        assigned_owner_id = excluded.assigned_owner_id,
        assigned_team_id = excluded.assigned_team_id
    `;

    await tx`
      insert into annual_return_cases (
        id,
        company_id,
        return_year,
        made_up_date,
        filing_due_date,
        current_status,
        owner_id,
        reviewer_id,
        reminders_sent
      )
      values (
        gen_random_uuid(),
        ${company.id},
        2026,
        ${company.basisDate},
        ${dueDate},
        ${company.status},
        ${company.ownerId},
        ${users[1].id},
        1
      )
      on conflict (company_id, return_year) do update set
        current_status = excluded.current_status,
        filing_due_date = excluded.filing_due_date,
        owner_id = excluded.owner_id
    `;
  });

  const [caseRow] = await sql`
    select id from annual_return_cases
    where company_id = ${company.id} and return_year = 2026
  `;

  await sql.begin(async (tx) => {
    for (const [index, label] of checklistLabels.entries()) {
      await tx`
        insert into annual_return_checklist_items (
          case_id,
          item_label,
          required,
          status,
          due_date,
          received_at,
          verified_at
        )
        values (
          ${caseRow.id},
          ${label},
          true,
          ${index < 3 ? "Verified" : "Missing"},
          ${dueDate},
          ${index < 3 ? "2026-07-05T09:00:00.000Z" : null},
          ${index < 3 ? "2026-07-05T10:00:00.000Z" : null}
        )
      `;
    }

    await tx`
      insert into payments (company_id, case_id, invoice_number, amount, status, due_date)
      values (${company.id}, ${caseRow.id}, ${`INV-2026-${company.crNumber}`}, 3800, 'Payment pending', ${dueDate})
      on conflict (case_id) do nothing
    `;

    await tx`
      insert into timeline_events (company_id, case_id, event_type, actor_type, description, metadata)
      values (${company.id}, ${caseRow.id}, 'case_seeded', 'system', 'Annual return case seeded for Phase 1 validation.', '{}'::jsonb)
    `;
  });
}

console.log(`Seeded ${companies.length} companies and annual return cases.`);
await sql.end();
```

- [ ] **Step 2: Run migration and seed**

Run:

```bash
bun run db:migrate
bun run db:seed
```

Expected: seed prints `Seeded 3 companies and annual return cases.`

- [ ] **Step 3: Commit**

```bash
git add scripts/db-seed-annual-return.ts package.json bun.lock
git commit -m "feat: seed annual return control data"
```

## Task 4: Add Repository Reads And Dashboard Metrics

**Files:**
- Create: `src/features/annual-return/repository.ts`
- Create: `src/features/annual-return/repository.test.ts`

- [ ] **Step 1: Write repository smoke test**

Create `src/features/annual-return/repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAnnualReturnRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("annual return repository", () => {
  it("lists annual return cases with company and owner data", async () => {
    const repo = createAnnualReturnRepository(databaseUrl!);
    const cases = await repo.listCases({});
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]).toHaveProperty("companyName");
    expect(cases[0]).toHaveProperty("filingDueDate");
    expect(cases[0]).toHaveProperty("ownerName");
  });

  it("returns dashboard metrics", async () => {
    const repo = createAnnualReturnRepository(databaseUrl!);
    const metrics = await repo.dashboardMetrics("2026-07-05", "20000000-0000-0000-0000-000000000001");
    expect(metrics).toHaveProperty("dueIn7");
    expect(metrics).toHaveProperty("dueIn30");
    expect(metrics).toHaveProperty("overdue");
    expect(metrics).toHaveProperty("paymentPending");
  });
});
```

- [ ] **Step 2: Run test and verify it fails when `TEST_DATABASE_URL` is set**

Run:

```bash
TEST_DATABASE_URL="$DATABASE_URL" bun run test src/features/annual-return/repository.test.ts
```

Expected: FAIL because `repository.ts` does not exist.

- [ ] **Step 3: Implement repository**

Create `src/features/annual-return/repository.ts`:

```ts
import postgres from "postgres";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { riskForCase } from "./workflow";
import type {
  AnnualReturnCase,
  AnnualReturnChecklistItem,
  AnnualReturnPayment,
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "./types";

type CaseRow = {
  id: string;
  company_id: string;
  company_name: string;
  return_year: number;
  made_up_date: string;
  filing_due_date: string;
  current_status: AnnualReturnStatus;
  risk_level: RiskLevel;
  owner_id: string;
  owner_name: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reminders_sent: number;
  filing_reference: string | null;
  confirmation_document_id: string | null;
  locked_at: string | null;
  completed_at: string | null;
};

type ChecklistRow = {
  id: string;
  case_id: string;
  item_label: string;
  required: boolean;
  status: ChecklistStatus;
  due_date: string;
  received_at: string | null;
  verified_at: string | null;
  document_id: string | null;
};

type PaymentRow = {
  id: string;
  case_id: string;
  invoice_number: string;
  amount: number;
  currency: "HKD";
  status: PaymentStatus;
  due_date: string;
  paid_at: string | null;
  payment_proof_document_id: string | null;
};

export type CaseFilters = {
  ownerId?: string;
  teamId?: string;
  reviewerId?: string;
  risk?: RiskLevel;
  status?: AnnualReturnStatus;
  missingDocuments?: boolean;
  paymentStatus?: PaymentStatus;
  overdueOnly?: boolean;
};

export type AnnualReturnDashboardMetrics = {
  dueIn7: number;
  dueIn30: number;
  overdue: number;
  highRisk: number;
  missingDocuments: number;
  paymentPending: number;
  assignedToMe: number;
};

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function mapChecklist(row: ChecklistRow): AnnualReturnChecklistItem {
  return {
    id: row.id,
    caseId: row.case_id,
    itemLabel: row.item_label,
    required: row.required,
    status: row.status,
    dueDate: dateOnly(row.due_date),
    receivedAt: row.received_at,
    verifiedAt: row.verified_at,
    documentId: row.document_id,
  };
}

function mapPayment(row: PaymentRow): AnnualReturnPayment {
  return {
    id: row.id,
    caseId: row.case_id,
    invoiceNumber: row.invoice_number,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    dueDate: dateOnly(row.due_date),
    paidAt: row.paid_at,
    paymentProofDocumentId: row.payment_proof_document_id,
  };
}

function hydrateCase(
  row: CaseRow,
  checklist: AnnualReturnChecklistItem[],
  payment: AnnualReturnPayment | null,
): AnnualReturnCase {
  const case_: AnnualReturnCase = {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    returnYear: row.return_year,
    madeUpDate: dateOnly(row.made_up_date),
    filingDueDate: dateOnly(row.filing_due_date),
    currentStatus: row.current_status,
    riskLevel: row.risk_level,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    remindersSent: row.reminders_sent,
    filingReference: row.filing_reference,
    confirmationDocumentId: row.confirmation_document_id,
    lockedAt: row.locked_at,
    completedAt: row.completed_at,
    checklist,
    payment,
  };

  return {
    ...case_,
    riskLevel: riskForCase(case_, new Date().toISOString().slice(0, 10)),
  };
}

export function createAnnualReturnRepository(databaseUrl?: string) {
  const sql: SqlClient = databaseUrl
    ? postgres(databaseUrl, { ssl: "require", max: 1 })
    : createSqlClient();

  async function listCases(filters: CaseFilters): Promise<AnnualReturnCase[]> {
    const rows = await sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.company_name,
        arc.return_year,
        arc.made_up_date::text,
        arc.filing_due_date::text,
        arc.current_status,
        arc.risk_level,
        arc.owner_id,
        owner.name as owner_name,
        arc.reviewer_id,
        reviewer.name as reviewer_name,
        arc.reminders_sent,
        arc.filing_reference,
        arc.confirmation_document_id,
        arc.locked_at::text,
        arc.completed_at::text
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      join users owner on owner.id = arc.owner_id
      left join users reviewer on reviewer.id = arc.reviewer_id
      left join payments p on p.case_id = arc.id
      where (${filters.ownerId ?? null}::uuid is null or arc.owner_id = ${filters.ownerId ?? null}::uuid)
        and (${filters.teamId ?? null}::uuid is null or c.assigned_team_id = ${filters.teamId ?? null}::uuid)
        and (${filters.reviewerId ?? null}::uuid is null or arc.reviewer_id = ${filters.reviewerId ?? null}::uuid)
        and (${filters.status ?? null}::text is null or arc.current_status = ${filters.status ?? null})
        and (${filters.risk ?? null}::text is null or arc.risk_level = ${filters.risk ?? null})
        and (${filters.paymentStatus ?? null}::text is null or p.status = ${filters.paymentStatus ?? null})
        and (${filters.overdueOnly ?? false}::boolean is false or arc.filing_due_date < current_date)
      order by arc.filing_due_date asc, c.company_name asc
    `;

    return hydrateCases(rows);
  }

  async function getCase(id: string): Promise<AnnualReturnCase | null> {
    const rows = await sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.company_name,
        arc.return_year,
        arc.made_up_date::text,
        arc.filing_due_date::text,
        arc.current_status,
        arc.risk_level,
        arc.owner_id,
        owner.name as owner_name,
        arc.reviewer_id,
        reviewer.name as reviewer_name,
        arc.reminders_sent,
        arc.filing_reference,
        arc.confirmation_document_id,
        arc.locked_at::text,
        arc.completed_at::text
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      join users owner on owner.id = arc.owner_id
      left join users reviewer on reviewer.id = arc.reviewer_id
      where arc.id = ${id}
      limit 1
    `;

    if (rows.length === 0) return null;
    const [case_] = await hydrateCases(rows);
    return case_;
  }

  async function hydrateCases(rows: CaseRow[]): Promise<AnnualReturnCase[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const checklistRows = await sql<ChecklistRow[]>`
      select
        id,
        case_id,
        item_label,
        required,
        status,
        due_date::text,
        received_at::text,
        verified_at::text,
        document_id
      from annual_return_checklist_items
      where case_id = any(${ids}::uuid[])
      order by due_date asc, item_label asc
    `;
    const paymentRows = await sql<PaymentRow[]>`
      select
        id,
        case_id,
        invoice_number,
        amount,
        currency,
        status,
        due_date::text,
        paid_at::text,
        payment_proof_document_id
      from payments
      where case_id = any(${ids}::uuid[])
    `;

    return rows.map((row) => {
      const checklist = checklistRows
        .filter((item) => item.case_id === row.id)
        .map(mapChecklist);
      const paymentRow = paymentRows.find((payment) => payment.case_id === row.id);
      return hydrateCase(row, checklist, paymentRow ? mapPayment(paymentRow) : null);
    });
  }

  async function dashboardMetrics(today: string, currentUserId: string): Promise<AnnualReturnDashboardMetrics> {
    const cases = await listCases({});
    return {
      dueIn7: cases.filter((case_) => {
        const days = Math.floor((Date.parse(case_.filingDueDate) - Date.parse(today)) / 86400000);
        return days >= 0 && days <= 7;
      }).length,
      dueIn30: cases.filter((case_) => {
        const days = Math.floor((Date.parse(case_.filingDueDate) - Date.parse(today)) / 86400000);
        return days >= 0 && days <= 30;
      }).length,
      overdue: cases.filter((case_) => case_.filingDueDate < today).length,
      highRisk: cases.filter((case_) => case_.riskLevel === "red").length,
      missingDocuments: cases.reduce(
        (sum, case_) => sum + case_.checklist.filter((item) => item.required && item.status !== "Verified").length,
        0,
      ),
      paymentPending: cases.filter((case_) => case_.payment?.status !== "Payment received").length,
      assignedToMe: cases.filter((case_) => case_.ownerId === currentUserId).length,
    };
  }

  return {
    listCases,
    getCase,
    dashboardMetrics,
  };
}
```

- [ ] **Step 4: Run repository tests**

Run:

```bash
TEST_DATABASE_URL="$DATABASE_URL" bun run test src/features/annual-return/repository.test.ts
```

Expected: PASS after migration and seed have run.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/repository.ts src/features/annual-return/repository.test.ts
git commit -m "feat: read annual return cases from database"
```

## Task 5: Add Server Functions For Case Actions

**Files:**
- Create: `src/features/annual-return/server-fns.ts`
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/repository.test.ts`

- [ ] **Step 1: Extend repository with writes**

Add these methods inside `createAnnualReturnRepository` before the `return` statement:

```ts
  async function updateStatus(caseId: string, nextStatus: AnnualReturnStatus, actorId: string): Promise<AnnualReturnCase> {
    const current = await getCase(caseId);
    if (!current) throw new Error("Annual return case not found.");
    if (current.lockedAt) throw new Error("Completed cases are locked.");

    await sql.begin(async (tx) => {
      await tx`
        update annual_return_cases
        set current_status = ${nextStatus}, updated_at = now()
        where id = ${caseId}
      `;

      await tx`
        insert into timeline_events (company_id, case_id, event_type, actor_type, actor_id, description, metadata)
        values (
          ${current.companyId},
          ${caseId},
          'status_changed',
          'user',
          ${actorId},
          ${`Status changed from ${current.currentStatus} to ${nextStatus}.`},
          ${JSON.stringify({ from: current.currentStatus, to: nextStatus })}::jsonb
        )
      `;
    });

    const updated = await getCase(caseId);
    if (!updated) throw new Error("Annual return case disappeared after status update.");
    return updated;
  }

  async function recordReminder(input: {
    caseId: string;
    actorId: string;
    templateLabel: string;
    recipientName: string;
    recipientPhone: string;
    draftBody: string;
    note: string;
  }): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);
    if (!current) throw new Error("Annual return case not found.");
    if (current.lockedAt) throw new Error("Completed cases are locked.");

    await sql.begin(async (tx) => {
      await tx`
        insert into reminder_logs (
          case_id,
          channel,
          template_label,
          recipient_name,
          recipient_phone,
          draft_body,
          recorded_sent_at,
          staff_actor_id,
          note
        )
        values (
          ${input.caseId},
          'WhatsApp',
          ${input.templateLabel},
          ${input.recipientName},
          ${input.recipientPhone},
          ${input.draftBody},
          now(),
          ${input.actorId},
          ${input.note}
        )
      `;

      await tx`
        update annual_return_cases
        set reminders_sent = reminders_sent + 1,
            current_status = case
              when current_status = 'Upcoming' then 'Client reminder sent'
              else current_status
            end,
            updated_at = now()
        where id = ${input.caseId}
      `;

      await tx`
        insert into timeline_events (company_id, case_id, event_type, actor_type, actor_id, description, metadata)
        values (
          ${current.companyId},
          ${input.caseId},
          'reminder_recorded',
          'user',
          ${input.actorId},
          ${`Manual WhatsApp reminder recorded for ${input.recipientName}.`},
          ${JSON.stringify({ templateLabel: input.templateLabel, recipientPhone: input.recipientPhone })}::jsonb
        )
      `;
    });

    const updated = await getCase(input.caseId);
    if (!updated) throw new Error("Annual return case disappeared after reminder logging.");
    return updated;
  }

  async function updateChecklistItem(input: {
    caseId: string;
    itemId: string;
    status: ChecklistStatus;
    documentId: string | null;
    actorId: string;
  }): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);
    if (!current) throw new Error("Annual return case not found.");
    if (current.lockedAt) throw new Error("Completed cases are locked.");

    await sql.begin(async (tx) => {
      await tx`
        update annual_return_checklist_items
        set status = ${input.status},
            document_id = ${input.documentId},
            received_at = case when ${input.status} in ('Received', 'Verified') then coalesce(received_at, now()) else received_at end,
            verified_at = case when ${input.status} = 'Verified' then coalesce(verified_at, now()) else verified_at end,
            updated_at = now()
        where id = ${input.itemId} and case_id = ${input.caseId}
      `;

      await tx`
        insert into timeline_events (company_id, case_id, event_type, actor_type, actor_id, description, metadata)
        values (
          ${current.companyId},
          ${input.caseId},
          'checklist_updated',
          'user',
          ${input.actorId},
          'Checklist item updated.',
          ${JSON.stringify({ itemId: input.itemId, status: input.status, documentId: input.documentId })}::jsonb
        )
      `;
    });

    const updated = await getCase(input.caseId);
    if (!updated) throw new Error("Annual return case disappeared after checklist update.");
    return updated;
  }

  async function updatePayment(input: {
    caseId: string;
    status: PaymentStatus;
    paymentProofDocumentId: string | null;
    actorId: string;
  }): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);
    if (!current) throw new Error("Annual return case not found.");
    if (current.lockedAt) throw new Error("Completed cases are locked.");

    await sql.begin(async (tx) => {
      await tx`
        update payments
        set status = ${input.status},
            payment_proof_document_id = ${input.paymentProofDocumentId},
            paid_at = case when ${input.status} = 'Payment received' then coalesce(paid_at, now()) else paid_at end,
            updated_at = now()
        where case_id = ${input.caseId}
      `;

      await tx`
        insert into timeline_events (company_id, case_id, event_type, actor_type, actor_id, description, metadata)
        values (
          ${current.companyId},
          ${input.caseId},
          'payment_updated',
          'user',
          ${input.actorId},
          ${`Payment status changed to ${input.status}.`},
          ${JSON.stringify({ status: input.status, paymentProofDocumentId: input.paymentProofDocumentId })}::jsonb
        )
      `;
    });

    const updated = await getCase(input.caseId);
    if (!updated) throw new Error("Annual return case disappeared after payment update.");
    return updated;
  }

  async function updateFilingProof(input: {
    caseId: string;
    filingReference: string;
    confirmationDocumentId: string;
    actorId: string;
  }): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);
    if (!current) throw new Error("Annual return case not found.");
    if (current.lockedAt) throw new Error("Completed cases are locked.");

    await sql.begin(async (tx) => {
      await tx`
        update annual_return_cases
        set filing_reference = ${input.filingReference},
            confirmation_document_id = ${input.confirmationDocumentId},
            updated_at = now()
        where id = ${input.caseId}
      `;

      await tx`
        insert into timeline_events (company_id, case_id, event_type, actor_type, actor_id, description, metadata)
        values (
          ${current.companyId},
          ${input.caseId},
          'filing_proof_updated',
          'user',
          ${input.actorId},
          'Filing reference and confirmation proof updated.',
          ${JSON.stringify({ filingReference: input.filingReference, confirmationDocumentId: input.confirmationDocumentId })}::jsonb
        )
      `;
    });

    const updated = await getCase(input.caseId);
    if (!updated) throw new Error("Annual return case disappeared after filing proof update.");
    return updated;
  }
```

Update the returned object:

```ts
  return {
    listCases,
    getCase,
    dashboardMetrics,
    updateStatus,
    recordReminder,
    updateChecklistItem,
    updatePayment,
    updateFilingProof,
  };
```

- [ ] **Step 2: Add server functions**

Create `src/features/annual-return/server-fns.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createAnnualReturnRepository } from "./repository";
import { buildReminderDraft, completionBlockers, isAllowedStatusTransition } from "./workflow";
import { ANNUAL_RETURN_STATUSES } from "./types";

const CURRENT_USER_ID = "20000000-0000-0000-0000-000000000001";

const statusSchema = z.enum(ANNUAL_RETURN_STATUSES);

export const listAnnualReturnCases = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    z
      .object({
        ownerId: z.string().optional(),
        teamId: z.string().optional(),
        reviewerId: z.string().optional(),
        risk: z.enum(["green", "yellow", "orange", "red"]).optional(),
        status: statusSchema.optional(),
        paymentStatus: z.enum(["Not invoiced", "Payment pending", "Payment received", "Overdue"]).optional(),
        overdueOnly: z.boolean().optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    return createAnnualReturnRepository().listCases(data);
  });

export const getAnnualReturnCase = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    return createAnnualReturnRepository().getCase(data.id);
  });

export const getAnnualReturnDashboardMetrics = createServerFn({ method: "GET" })
  .handler(async () => {
    return createAnnualReturnRepository().dashboardMetrics(
      new Date().toISOString().slice(0, 10),
      CURRENT_USER_ID,
    );
  });

export const updateAnnualReturnStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ caseId: z.string().uuid(), nextStatus: statusSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const repo = createAnnualReturnRepository();
    const current = await repo.getCase(data.caseId);
    if (!current) throw new Error("Annual return case not found.");
    if (data.nextStatus === "Completed") {
      const blockers = completionBlockers(current);
      if (blockers.length > 0) {
        throw new Error(blockers.map((blocker) => blocker.message).join(" "));
      }
    } else if (!isAllowedStatusTransition(current.currentStatus, data.nextStatus)) {
      throw new Error(`Cannot move from ${current.currentStatus} to ${data.nextStatus}.`);
    }
    return repo.updateStatus(data.caseId, data.nextStatus, CURRENT_USER_ID);
  });

export const recordAnnualReturnReminder = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        templateLabel: z.string().min(1),
        recipientName: z.string().min(1),
        recipientPhone: z.string().min(3),
        draftBody: z.string().min(1),
        note: z.string().default(""),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    return createAnnualReturnRepository().recordReminder({
      ...data,
      actorId: CURRENT_USER_ID,
    });
  });

export const updateAnnualReturnChecklistItem = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        itemId: z.string().uuid(),
        status: z.enum(["Missing", "Received", "Verified", "Rejected"]),
        documentId: z.string().uuid().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    return createAnnualReturnRepository().updateChecklistItem({
      ...data,
      actorId: CURRENT_USER_ID,
    });
  });

export const updateAnnualReturnPayment = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        status: z.enum(["Not invoiced", "Payment pending", "Payment received", "Overdue"]),
        paymentProofDocumentId: z.string().uuid().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    return createAnnualReturnRepository().updatePayment({
      ...data,
      actorId: CURRENT_USER_ID,
    });
  });

export const updateAnnualReturnFilingProof = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        filingReference: z.string().min(1),
        confirmationDocumentId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    return createAnnualReturnRepository().updateFilingProof({
      ...data,
      actorId: CURRENT_USER_ID,
    });
  });

export const buildAnnualReturnReminderDraft = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ caseId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const case_ = await createAnnualReturnRepository().getCase(data.caseId);
    if (!case_) throw new Error("Annual return case not found.");
    return { draftBody: buildReminderDraft(case_) };
  });
```

- [ ] **Step 3: Run tests and build**

Run:

```bash
bun run test src/features/annual-return/workflow.test.ts
bun run build
```

Expected: tests pass and build exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/annual-return/repository.ts src/features/annual-return/repository.test.ts src/features/annual-return/server-fns.ts
git commit -m "feat: add annual return server actions"
```

## Task 6: Convert Annual Returns List To Deadline-First Data

**Files:**
- Modify: `src/routes/annual-returns.tsx`

- [ ] **Step 1: Replace mock loader with server loader**

In `src/routes/annual-returns.tsx`, import server function and status constants:

```ts
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { DeadlinePill } from "@/components/deadline-pill";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { ANNUAL_RETURN_STATUSES, type AnnualReturnCase } from "@/features/annual-return/types";
import { listAnnualReturnCases } from "@/features/annual-return/server-fns";
import { caseStatusTone, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
```

Update route definition:

```ts
export const Route = createFileRoute("/annual-returns")({
  loader: () => listAnnualReturnCases({ data: {} }),
  head: () => ({
    meta: [
      { title: "Annual Returns Board — Kossilon CoSec OS" },
      { name: "description", content: "Deadline-first annual return control center with status board view." },
    ],
  }),
  component: AnnualReturnsPage,
});
```

- [ ] **Step 2: Add deadline list and board toggle**

Replace `AnnualReturnsPage` with:

```tsx
function AnnualReturnsPage() {
  const cases = Route.useLoaderData() as AnnualReturnCase[];
  const [view, setView] = useState<"deadline" | "board">("deadline");
  const [risk, setRisk] = useState("all");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(
    () =>
      cases.filter((case_) => {
        const riskMatch = risk === "all" || case_.riskLevel === risk;
        const statusMatch = status === "all" || case_.currentStatus === status;
        return riskMatch && statusMatch;
      }),
    [cases, risk, status],
  );

  return (
    <>
      <TopBar title="Annual Return Control Center" subtitle={`${filtered.length} cases sorted by statutory deadline`} />
      <main className="flex-1 space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={risk} onChange={(event) => setRisk(event.target.value)} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm">
              <option value="all">All risks</option>
              <option value="red">Red risk</option>
              <option value="orange">Orange risk</option>
              <option value="yellow">Yellow risk</option>
              <option value="green">Green risk</option>
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm">
              <option value="all">All statuses</option>
              {ANNUAL_RETURN_STATUSES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="inline-flex rounded-md border border-border bg-card p-1">
            <Button variant={view === "deadline" ? "default" : "ghost"} size="sm" onClick={() => setView("deadline")}>Deadline list</Button>
            <Button variant={view === "board" ? "default" : "ghost"} size="sm" onClick={() => setView("board")}>Status board</Button>
          </div>
        </div>
        {view === "deadline" ? <DeadlineList cases={filtered} /> : <StatusBoard cases={filtered} />}
      </main>
    </>
  );
}
```

Add helper components in the same file:

```tsx
function DeadlineList({ cases }: { cases: AnnualReturnCase[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 font-medium">Company</th>
            <th className="px-5 py-3 font-medium">Deadline</th>
            <th className="px-5 py-3 font-medium">Risk</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Missing</th>
            <th className="px-5 py-3 font-medium">Payment</th>
            <th className="px-5 py-3 font-medium">Owner</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {cases.map((case_) => {
            const missing = case_.checklist.filter((item) => item.required && item.status !== "Verified").length;
            return (
              <tr key={case_.id} className="hover:bg-muted/30">
                <td className="px-5 py-3">
                  <Link to="/annual-returns/$id" params={{ id: case_.id }} className="font-medium text-foreground hover:text-primary">
                    {case_.companyName}
                  </Link>
                  <div className="text-xs text-muted-foreground">Return year {case_.returnYear}</div>
                </td>
                <td className="px-5 py-3"><DeadlinePill dueDate={case_.filingDueDate} /></td>
                <td className="px-5 py-3"><RiskPill risk={case_.riskLevel} /></td>
                <td className="px-5 py-3"><StatusPill tone={caseStatusTone(case_.currentStatus)}>{case_.currentStatus}</StatusPill></td>
                <td className="px-5 py-3 text-muted-foreground">{missing}</td>
                <td className="px-5 py-3"><StatusPill tone={case_.payment?.status === "Payment received" ? "green" : "yellow"}>{case_.payment?.status ?? "Not invoiced"}</StatusPill></td>
                <td className="px-5 py-3 text-muted-foreground">{case_.ownerName}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBoard({ cases }: { cases: AnnualReturnCase[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-4">
        {ANNUAL_RETURN_STATUSES.map((status) => {
          const items = cases.filter((case_) => case_.currentStatus === status);
          const tone = caseStatusTone(status);
          const t = toneClasses[tone];
          return (
            <div key={status} className="w-72 shrink-0">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", t.dot)} />
                  <h2 className="text-sm font-semibold text-foreground">{status}</h2>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No cases</div>
                ) : (
                  items.map((case_) => <BoardCaseCard key={case_.id} case_={case_} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskPill({ risk }: { risk: AnnualReturnCase["riskLevel"] }) {
  const tone = risk === "red" ? "red" : risk === "orange" ? "orange" : risk === "yellow" ? "yellow" : "green";
  return <StatusPill tone={tone}>{risk} risk</StatusPill>;
}

function BoardCaseCard({ case_ }: { case_: AnnualReturnCase }) {
  const missing = case_.checklist.filter((item) => item.required && item.status !== "Verified").length;
  return (
    <Link to="/annual-returns/$id" params={{ id: case_.id }} className="block rounded-lg border border-border bg-card p-3 hover:bg-accent">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{case_.companyName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Owner: {case_.ownerName}</p>
        </div>
        <RiskPill risk={case_.riskLevel} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <DeadlinePill dueDate={case_.filingDueDate} />
        <span className="text-muted-foreground">{missing} missing</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Run build**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/annual-returns.tsx src/routeTree.gen.ts
git commit -m "feat: make annual returns deadline first"
```

## Task 7: Convert Case Detail To Real Data And Manual Reminder Logging

**Files:**
- Modify: `src/routes/annual-returns.$id.tsx`

- [ ] **Step 1: Update loader to fetch real case**

In `src/routes/annual-returns.$id.tsx`, replace the existing loader body with:

```ts
  loader: async ({ params }) => {
    const c = await getAnnualReturnCase({ data: { id: params.id } });
    if (!c) throw notFound();
    return { c };
  },
```

Add imports:

```ts
import {
  buildAnnualReturnReminderDraft,
  getAnnualReturnCase,
  recordAnnualReturnReminder,
  updateAnnualReturnChecklistItem,
  updateAnnualReturnFilingProof,
  updateAnnualReturnPayment,
  updateAnnualReturnStatus,
} from "@/features/annual-return/server-fns";
import { completionBlockers } from "@/features/annual-return/workflow";
import type { AnnualReturnCase, AnnualReturnChecklistItem } from "@/features/annual-return/types";
```

- [ ] **Step 2: Update component data shape**

In `CaseDetailPage`, use:

```ts
const { c } = Route.useLoaderData() as { c: AnnualReturnCase };
const blockers = completionBlockers(c);
const missing = c.checklist.filter((item) => item.required && item.status !== "Verified").length;
const received = c.checklist.length - missing;
```

- [ ] **Step 3: Add manual reminder action**

Add this function inside `CaseDetailPage`:

```ts
async function recordReminder() {
  const draft = await buildAnnualReturnReminderDraft({ data: { caseId: c.id } });
  await navigator.clipboard.writeText(draft.draftBody);
  await recordAnnualReturnReminder({
    data: {
      caseId: c.id,
      templateLabel: "Annual return manual reminder",
      recipientName: c.companyName,
      recipientPhone: "+85200000000",
      draftBody: draft.draftBody,
      note: "Draft copied and reminder recorded by staff.",
    },
  });
  window.location.reload();
}
```

Use it on the reminder button:

```tsx
<button onClick={recordReminder} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
  Copy draft & record reminder
</button>
```

- [ ] **Step 4: Add blocker-clearing staff actions**

Add these functions inside `CaseDetailPage`:

```ts
async function markChecklistItemVerified(item: AnnualReturnChecklistItem) {
  await updateAnnualReturnChecklistItem({
    data: {
      caseId: c.id,
      itemId: item.id,
      status: "Verified",
      documentId: item.documentId,
    },
  });
  window.location.reload();
}

async function markPaymentReceived() {
  await updateAnnualReturnPayment({
    data: {
      caseId: c.id,
      status: "Payment received",
      paymentProofDocumentId: c.payment?.paymentProofDocumentId ?? null,
    },
  });
  window.location.reload();
}

async function saveFilingProof() {
  const filingReference = window.prompt("Filing reference");
  const confirmationDocumentId = window.prompt("Confirmation document UUID");
  if (!filingReference || !confirmationDocumentId) return;
  await updateAnnualReturnFilingProof({
    data: {
      caseId: c.id,
      filingReference,
      confirmationDocumentId,
    },
  });
  window.location.reload();
}
```

Add these buttons near the relevant panels:

```tsx
<button onClick={markPaymentReceived} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">
  Mark payment received
</button>

<button onClick={saveFilingProof} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">
  Save filing proof
</button>
```

For each checklist row, add this action when the item is not verified:

```tsx
{i.status !== "Verified" && (
  <button onClick={() => markChecklistItemVerified(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent">
    Mark verified
  </button>
)}
```

- [ ] **Step 5: Add completion blocker panel**

Add this panel near the top summary:

```tsx
{blockers.length > 0 ? (
  <div className="rounded-xl border border-status-orange/30 bg-status-orange-soft p-4">
    <p className="font-display text-sm font-semibold text-foreground">Completion blockers</p>
    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
      {blockers.map((blocker) => (
        <li key={blocker.code}>{blocker.message}</li>
      ))}
    </ul>
  </div>
) : (
  <div className="rounded-xl border border-status-green/30 bg-status-green-soft p-4">
    <p className="font-display text-sm font-semibold text-foreground">Ready to complete</p>
    <p className="mt-1 text-xs text-muted-foreground">All required checklist items, payment, filing reference, and confirmation proof are present.</p>
  </div>
)}
```

- [ ] **Step 6: Add guarded status advance**

Add:

```ts
async function markCompleted() {
  await updateAnnualReturnStatus({ data: { caseId: c.id, nextStatus: "Completed" } });
  window.location.reload();
}
```

Render:

```tsx
<button
  onClick={markCompleted}
  disabled={blockers.length > 0}
  className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
>
  Mark completed
</button>
```

- [ ] **Step 7: Run build and commit**

Run:

```bash
bun run build
```

Expected: PASS.

Commit:

```bash
git add 'src/routes/annual-returns.$id.tsx' src/routeTree.gen.ts
git commit -m "feat: connect annual return case detail"
```

## Task 8: Wire Dashboard Metrics To Real Annual Return Counts

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Add loader**

In `src/routes/index.tsx`, import the server function:

```ts
import { getAnnualReturnDashboardMetrics } from "@/features/annual-return/server-fns";
```

Update route definition:

```ts
export const Route = createFileRoute("/")({
  loader: () => getAnnualReturnDashboardMetrics(),
  head: () => ({
    meta: [
      { title: "Dashboard — Kossilon CoSec OS" },
      { name: "description", content: "Deadlines, overdue cases, pending documents, payments, WhatsApp enquiries, and team workload at a glance." },
    ],
  }),
  component: DashboardPage,
});
```

- [ ] **Step 2: Merge real metrics with existing display**

Inside `DashboardPage`, replace `const m = dashboardMetrics();` with:

```ts
const realMetrics = Route.useLoaderData() as Awaited<ReturnType<typeof getAnnualReturnDashboardMetrics>>;
const m = {
  ...dashboardMetrics(),
  dueIn7: realMetrics.dueIn7,
  dueIn30: realMetrics.dueIn30,
  overdue: realMetrics.overdue,
  missingDocs: realMetrics.missingDocuments,
  paymentPending: realMetrics.paymentPending,
  myCases: realMetrics.assignedToMe,
};
```

- [ ] **Step 3: Run build and commit**

Run:

```bash
bun run build
```

Expected: PASS.

Commit:

```bash
git add src/routes/index.tsx src/routeTree.gen.ts
git commit -m "feat: show real annual return dashboard metrics"
```

## Task 9: Final Verification

**Files:**
- Modify only if verification exposes defects in files changed by earlier tasks.

- [ ] **Step 1: Run all unit tests**

Run:

```bash
bun run test
```

Expected: PASS. Repository tests skip unless `TEST_DATABASE_URL` is set.

- [ ] **Step 2: Run repository tests against Neon**

Run:

```bash
TEST_DATABASE_URL="$DATABASE_URL" bun run test src/features/annual-return/repository.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run migration and seed**

Run:

```bash
bun run db:migrate
bun run db:seed
```

Expected: migration skips if already applied; seed prints `Seeded 3 companies and annual return cases.`

- [ ] **Step 4: Build production bundle**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 5: Manual browser check**

Run:

```bash
bun run dev
```

Open the local URL and verify:

- `/annual-returns` loads the deadline-first list by default.
- Risk and status filters change the visible rows.
- The board toggle shows lifecycle columns.
- `/annual-returns/$id` loads a seeded database case.
- Completion blockers show exact missing proof.
- Manual reminder button copies a draft and records a reminder.
- Completed case button is disabled until blockers are cleared.

- [ ] **Step 6: Commit final fixes**

If final verification required fixes:

```bash
git add src/features/annual-return src/routes/annual-returns.tsx 'src/routes/annual-returns.$id.tsx' src/routes/index.tsx src/routeTree.gen.ts package.json bun.lock db/migrations/0001_annual_return_control_center.sql src/server/db scripts/db-migrate.ts scripts/db-seed-annual-return.ts
git commit -m "fix: polish annual return control center"
```

If no fixes were required, do not create an empty commit.
