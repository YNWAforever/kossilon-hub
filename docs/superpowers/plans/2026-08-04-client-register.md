# Client Register and Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/clients` and `/clients/$id` off mock data onto Postgres, and add staff-managed company contacts with full create/edit/remove support.

**Architecture:** A new `src/features/clients/` module mirroring `src/features/annual-return/` — a repository built by an overloaded factory that accepts an injected `sql` client for tests, wrapped by zod-validated `createServerFn` handlers. A new `src/features/session/actor.ts` consolidates the prototype actor env-var stopgap so the future login phase has one place to replace. Migration `0006` adds `service_packages`, `companies.service_package_id`, and `company_contacts`.

**Tech Stack:** TanStack Start/Router, React 19, TypeScript, `postgres` (postgres.js), Vitest, zod, react-hook-form, Radix dialogs via shadcn/ui, sonner.

**Spec:** `docs/superpowers/specs/2026-08-04-client-register-design.md`

---

## File Structure

**Created:**

- `db/migrations/0006_client_register.sql` — service packages, company package FK, company contacts.
- `src/features/session/actor.ts` — `getCurrentActorId()`, the single prototype actor resolver.
- `src/features/session/actor.test.ts` — env-var precedence tests.
- `src/features/clients/types.ts` — every client-facing type. No logic.
- `src/features/clients/errors.ts` — maps Postgres constraint violations to form field errors.
- `src/features/clients/errors.test.ts` — pure unit tests for the mapper.
- `src/features/clients/repository.ts` — all SQL for the client register.
- `src/features/clients/repository.test.ts` — integration tests against `TEST_DATABASE_URL`.
- `src/features/clients/server-fns.ts` — zod-validated server functions.
- `src/components/clients/client-form-dialog.tsx` — add-client and edit-company dialog.
- `src/components/clients/contact-form-dialog.tsx` — add-contact and edit-contact dialog.

**Modified:**

- `src/features/annual-return/session.ts` — re-export the shared resolver, no behaviour change.
- `src/routes/clients.tsx` — loader plus working filters.
- `src/routes/clients.$id.tsx` — loader plus real panels and contact controls.
- `src/components/convert-to-client-dialog.tsx` — call the real create server function.
- `src/routes/enquiries.tsx` — drop the `clients-store` import.

**Deleted:**

- `src/lib/clients-store.ts`

The repository is one file because every query shares the same row-mapping helpers and the hydration path; splitting reads from writes would duplicate the mappers. This matches `src/features/annual-return/repository.ts`.

---

### Task 1: Shared Actor Module

**Files:**
- Create: `src/features/session/actor.test.ts`
- Create: `src/features/session/actor.ts`
- Modify: `src/features/annual-return/session.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/session/actor.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentActorId } from "./actor";

describe("getCurrentActorId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers KOSSILON_ACTOR_ID", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "20000000-0000-0000-0000-000000000001");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", "20000000-0000-0000-0000-000000000002");

    expect(getCurrentActorId()).toBe("20000000-0000-0000-0000-000000000001");
  });

  it("falls back to KOSSILON_ANNUAL_RETURN_ACTOR_ID", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", "20000000-0000-0000-0000-000000000003");

    expect(getCurrentActorId()).toBe("20000000-0000-0000-0000-000000000003");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "  20000000-0000-0000-0000-000000000004  ");

    expect(getCurrentActorId()).toBe("20000000-0000-0000-0000-000000000004");
  });

  it("throws when neither variable is set", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", "");

    expect(() => getCurrentActorId()).toThrow(
      "KOSSILON_ACTOR_ID actor is not configured.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/session/actor.test.ts`
Expected: FAIL — cannot resolve `./actor`.

- [ ] **Step 3: Write the implementation**

Create `src/features/session/actor.ts`:

```ts
const ACTOR_ID_ENV_KEY = "KOSSILON_ACTOR_ID";
const LEGACY_ACTOR_ID_ENV_KEY = "KOSSILON_ANNUAL_RETURN_ACTOR_ID";

/**
 * Prototype actor resolver. Until real authentication lands, every server-side
 * write attributes itself to a single configured user. The login phase replaces
 * this with a session lookup — keep it the only source of actor identity.
 */
export function getCurrentActorId(): string {
  const actorId =
    process.env[ACTOR_ID_ENV_KEY]?.trim() || process.env[LEGACY_ACTOR_ID_ENV_KEY]?.trim();

  if (!actorId) {
    throw new Error(`${ACTOR_ID_ENV_KEY} actor is not configured.`);
  }

  return actorId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/session/actor.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Point the annual-return resolver at the shared module**

Replace the whole of `src/features/annual-return/session.ts`:

```ts
import { getCurrentActorId } from "@/features/session/actor";

/**
 * Retained so existing importers keep working. New code should call
 * getCurrentActorId() from @/features/session/actor directly.
 */
export function getCurrentAnnualReturnActorId(): string {
  return getCurrentActorId();
}
```

- [ ] **Step 6: Verify the existing annual-return tests still pass**

Run: `npx vitest run src/features/annual-return/session.test.ts`
Expected: PASS.

The existing test asserts the thrown message is `"KOSSILON_ANNUAL_RETURN_ACTOR_ID actor is not configured."` but the shared resolver now throws `"KOSSILON_ACTOR_ID actor is not configured."`. That test will fail on the message. Update only the expected string in `src/features/annual-return/session.test.ts` — do not change any other assertion, and do not change `src/features/dashboard/dashboard-data.test.ts`, which stubs the error itself rather than triggering it.

- [ ] **Step 7: Run the whole suite**

Run: `npm run test`
Expected: PASS. Integration suites skip without `TEST_DATABASE_URL`; that is fine.

- [ ] **Step 8: Commit**

```bash
git add src/features/session src/features/annual-return/session.ts src/features/annual-return/session.test.ts
git commit -m "refactor: extract shared prototype actor resolver"
```

---

### Task 2: Migration 0006

**Files:**
- Create: `db/migrations/0006_client_register.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/0006_client_register.sql`:

```sql
create table if not exists service_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_fee integer not null constraint service_packages_fee_positive_check check (default_fee > 0),
  currency text not null default 'HKD' constraint service_packages_currency_hkd_check check (currency = 'HKD'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into service_packages (id, name, default_fee, sort_order)
values
  ('30000000-0000-0000-0000-000000000001', 'Basic', 2800, 1),
  ('30000000-0000-0000-0000-000000000002', 'Standard', 3800, 2),
  ('30000000-0000-0000-0000-000000000003', 'Premium', 5200, 3)
on conflict (name) do nothing;

alter table companies
  add column if not exists service_package_id uuid references service_packages(id);

update companies
set service_package_id = '30000000-0000-0000-0000-000000000002'
where service_package_id is null;

create table if not exists company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  role text not null,
  email text,
  phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_contacts_reachable_check check (email is not null or phone is not null)
);

create index if not exists company_contacts_company_id_idx
  on company_contacts (company_id);

create unique index if not exists company_contacts_primary_uidx
  on company_contacts (company_id)
  where is_primary;
```

The fixed package UUIDs let tests and the backfill reference rows without a lookup. The backfill assigns Standard, matching the mock default in the dialog being replaced.

- [ ] **Step 2: Mirror the changes into the reference schema**

`src/server/db/schema.sql` is the full-schema reference for fresh databases. Append the same three blocks — `service_packages` with its seed insert, the `alter table companies`, and `company_contacts` with both indexes — to the end of that file, in the same order.

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: `Applied 0006_client_register.sql`, with earlier migrations reported as `Skipping`.

If `DATABASE_URL` is not configured locally, skip this step and verify during the manual pass in Task 12. Do not fabricate a result.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0006_client_register.sql src/server/db/schema.sql
git commit -m "feat: add service packages and company contacts schema"
```

---

### Task 3: Client Types

**Files:**
- Create: `src/features/clients/types.ts`

This task has no test of its own — it declares types with no runtime behaviour, and every later task's tests exercise them. Adding a test that asserts a type compiles would be noise.

- [ ] **Step 1: Write the types**

Create `src/features/clients/types.ts`:

```ts
export type CompanyStatus = "active" | "inactive";

export type ServicePackage = {
  id: string;
  name: string;
  defaultFee: number;
  currency: "HKD";
  active: boolean;
  sortOrder: number;
};

export type CompanyContact = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

/** Latest annual-return payment status, mirroring the payments.status check constraint. */
export type ClientPaymentStatus =
  | "Not invoiced"
  | "Payment pending"
  | "Payment received"
  | "Overdue";

export type ClientSummary = {
  id: string;
  companyName: string;
  crNumber: string;
  brNumber: string;
  status: CompanyStatus;
  packageId: string | null;
  packageName: string | null;
  ownerId: string;
  ownerName: string;
  ownerInitials: string;
  teamId: string;
  teamName: string;
  /** Filing due date of the most recent annual-return case, or null when none exists. */
  arDueDate: string | null;
  paymentStatus: ClientPaymentStatus | null;
  invoiceAmount: number | null;
};

export type ClientTimelineEntry = {
  id: string;
  eventType: string;
  actorType: "system" | "user";
  actorName: string | null;
  description: string;
  createdAt: string;
};

export type ClientAnnualReturnEntry = {
  id: string;
  returnYear: number;
  madeUpDate: string;
  filingDueDate: string;
  currentStatus: string;
};

export type ClientDocument = {
  id: string;
  fileName: string;
  fileType: string;
  verificationStatus: "pending" | "verified" | "rejected";
  uploadedAt: string;
};

export type ClientDetail = ClientSummary & {
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  contacts: CompanyContact[];
  timeline: ClientTimelineEntry[];
  annualReturnHistory: ClientAnnualReturnEntry[];
  documents: ClientDocument[];
};

/** Owner, team, and package choices for the create and edit forms. */
export type ClientAssignmentOptions = {
  owners: { id: string; name: string; teamId: string | null }[];
  teams: { id: string; name: string }[];
  packages: ServicePackage[];
};

export type ClientContactInput = {
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type CreateClientInput = {
  companyName: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  ownerId: string;
  teamId: string;
  packageId: string | null;
  contacts: ClientContactInput[];
  actorId: string;
};

export type UpdateClientInput = {
  id: string;
  companyName: string;
  registeredOffice: string;
  companySecretary: string;
  status: CompanyStatus;
  ownerId: string;
  teamId: string;
  packageId: string | null;
  actorId: string;
};

export type AddContactInput = ClientContactInput & {
  companyId: string;
  actorId: string;
};

export type UpdateContactInput = ClientContactInput & {
  companyId: string;
  contactId: string;
  actorId: string;
};

export type RemoveContactInput = {
  companyId: string;
  contactId: string;
  actorId: string;
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/clients/types.ts
git commit -m "feat: add client register types"
```

---

### Task 4: Constraint Error Mapper

Postgres rejects duplicate CR/BR numbers and unreachable contacts at the database level. Without translation those surface as raw driver errors and reach the user as a 500. This maps them back to the form field that caused them.

**Files:**
- Create: `src/features/clients/errors.test.ts`
- Create: `src/features/clients/errors.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/clients/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ClientWriteError, toClientWriteError } from "./errors";

function postgresError(code: string, constraint: string): Error {
  const error = new Error("postgres rejected the statement") as Error & {
    code: string;
    constraint_name: string;
  };
  error.code = code;
  error.constraint_name = constraint;
  return error;
}

describe("toClientWriteError", () => {
  it("maps a duplicate CR number to the crNumber field", () => {
    const mapped = toClientWriteError(postgresError("23505", "companies_cr_number_key"));

    expect(mapped).toBeInstanceOf(ClientWriteError);
    expect(mapped?.field).toBe("crNumber");
    expect(mapped?.message).toBe("A company with this CR number already exists.");
  });

  it("maps a duplicate BR number to the brNumber field", () => {
    const mapped = toClientWriteError(postgresError("23505", "companies_br_number_key"));

    expect(mapped?.field).toBe("brNumber");
    expect(mapped?.message).toBe("A company with this BR number already exists.");
  });

  it("maps an unreachable contact to the contact field", () => {
    const mapped = toClientWriteError(
      postgresError("23514", "company_contacts_reachable_check"),
    );

    expect(mapped?.field).toBe("contact");
    expect(mapped?.message).toBe("Provide an email or a phone number.");
  });

  it("maps a duplicate primary contact to the isPrimary field", () => {
    const mapped = toClientWriteError(
      postgresError("23505", "company_contacts_primary_uidx"),
    );

    expect(mapped?.field).toBe("isPrimary");
    expect(mapped?.message).toBe("This company already has a primary contact.");
  });

  it("returns null for an unrelated constraint", () => {
    expect(toClientWriteError(postgresError("23505", "teams_name_key"))).toBeNull();
  });

  it("returns null for a non-postgres error", () => {
    expect(toClientWriteError(new Error("network down"))).toBeNull();
    expect(toClientWriteError("not an error")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/clients/errors.test.ts`
Expected: FAIL — cannot resolve `./errors`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clients/errors.ts`:

```ts
export type ClientWriteField = "crNumber" | "brNumber" | "contact" | "isPrimary";

/** A database constraint violation translated into a message for a specific form field. */
export class ClientWriteError extends Error {
  readonly field: ClientWriteField;

  constructor(field: ClientWriteField, message: string) {
    super(message);
    this.name = "ClientWriteError";
    this.field = field;
  }
}

const CONSTRAINT_FIELDS: Record<string, { field: ClientWriteField; message: string }> = {
  companies_cr_number_key: {
    field: "crNumber",
    message: "A company with this CR number already exists.",
  },
  companies_br_number_key: {
    field: "brNumber",
    message: "A company with this BR number already exists.",
  },
  company_contacts_reachable_check: {
    field: "contact",
    message: "Provide an email or a phone number.",
  },
  company_contacts_primary_uidx: {
    field: "isPrimary",
    message: "This company already has a primary contact.",
  },
};

const HANDLED_CODES = new Set(["23505", "23514"]);

export function toClientWriteError(error: unknown): ClientWriteError | null {
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

  return new ClientWriteError(mapping.field, mapping.message);
}

/** Rethrows a recognised constraint violation as a ClientWriteError, otherwise rethrows as-is. */
export function rethrowClientWriteError(error: unknown): never {
  const mapped = toClientWriteError(error);

  if (mapped) {
    throw mapped;
  }

  throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/clients/errors.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/errors.ts src/features/clients/errors.test.ts
git commit -m "feat: map client constraint violations to form fields"
```

---

### Task 5: Repository Read Paths

**Files:**
- Create: `src/features/clients/repository.test.ts`
- Create: `src/features/clients/repository.ts`

These are integration tests against a real database, matching `src/features/annual-return/repository.test.ts`. They skip when `TEST_DATABASE_URL` is unset. The existing annual-return seed (`npm run db:seed`) provides the teams and users these fixtures reference.

- [ ] **Step 1: Write the failing read tests**

Create `src/features/clients/repository.test.ts`:

```ts
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createClientRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

const USER_AMY_ID = "20000000-0000-0000-0000-000000000001";
const USER_KEN_ID = "20000000-0000-0000-0000-000000000002";
const TEAM_ANNUAL_RETURN_ID = "10000000-0000-0000-0000-000000000001";
const PACKAGE_BASIC_ID = "30000000-0000-0000-0000-000000000001";
const PACKAGE_STANDARD_ID = "30000000-0000-0000-0000-000000000002";

const TEST_COMPANY_UUID_PREFIX = "97000000";
const TEST_CASE_UUID_PREFIX = "97100000";
const TEST_PAYMENT_UUID_PREFIX = "97200000";
const TEST_CONTACT_UUID_PREFIX = "97300000";
const TEST_FIXTURE_SEQUENCES = [1, 2, 3] as const;

type ClientRepositoryInstance = ReturnType<typeof createClientRepository>;

const repositories: ClientRepositoryInstance[] = [];
let testSql: SqlClient | undefined;

function testUuid(prefix: string, sequence: number): string {
  return `${prefix}-0000-0000-0000-${String(sequence).padStart(12, "0")}`;
}

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for client register integration tests.");
  }

  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

function repositoryForTests(): ClientRepositoryInstance {
  const repository = createClientRepository(databaseUrl!);
  repositories.push(repository);
  return repository;
}

async function cleanupClientFixtures() {
  if (!databaseUrl) return;

  const sql = sqlForTests();
  const companyIds = TEST_FIXTURE_SEQUENCES.map((sequence) =>
    testUuid(TEST_COMPANY_UUID_PREFIX, sequence),
  );

  // Companies cascade to contacts, cases, payments, and timeline events.
  await sql`delete from companies where id = any(${companyIds}::uuid[])`;
  // Companies created by createClient tests use generated ids, so match on the fixture prefix.
  await sql`delete from companies where cr_number like 'TEST-CR-%'`;
}

/**
 * Inserts a company with an optional latest annual-return case and payment.
 * Returns the company id.
 */
async function seedCompany(options: {
  sequence: number;
  companyName: string;
  packageId?: string | null;
  status?: "active" | "inactive";
  cases?: { returnYear: number; filingDueDate: string; paymentStatus?: string }[];
  contacts?: { name: string; role: string; email: string | null; phone: string | null; isPrimary: boolean }[];
}): Promise<string> {
  const sql = sqlForTests();
  const companyId = testUuid(TEST_COMPANY_UUID_PREFIX, options.sequence);

  await sql`
    insert into companies (
      id, company_name, cr_number, br_number, incorporation_date,
      annual_return_basis_date, registered_office, company_secretary,
      status, assigned_owner_id, assigned_team_id, service_package_id
    )
    values (
      ${companyId},
      ${options.companyName},
      ${`CR-${options.sequence}-${TEST_COMPANY_UUID_PREFIX}`},
      ${`BR-${options.sequence}-${TEST_COMPANY_UUID_PREFIX}`},
      '2020-01-15',
      '2026-01-15',
      'Unit 1, Test Tower, Hong Kong',
      'Kossilon Secretaries Ltd',
      ${options.status ?? "active"},
      ${USER_AMY_ID},
      ${TEAM_ANNUAL_RETURN_ID},
      ${options.packageId === undefined ? PACKAGE_STANDARD_ID : options.packageId}
    )
  `;

  for (const [index, case_] of (options.cases ?? []).entries()) {
    const caseId = testUuid(TEST_CASE_UUID_PREFIX, options.sequence * 10 + index);
    await sql`
      insert into annual_return_cases (
        id, company_id, return_year, made_up_date, filing_due_date,
        current_status, risk_level, owner_id, reminders_sent
      )
      values (
        ${caseId}, ${companyId}, ${case_.returnYear}, '2026-01-15',
        ${case_.filingDueDate}, 'Upcoming', 'green', ${USER_AMY_ID}, 0
      )
    `;

    if (case_.paymentStatus) {
      await sql`
        insert into payments (id, company_id, case_id, invoice_number, amount, status, due_date)
        values (
          ${testUuid(TEST_PAYMENT_UUID_PREFIX, options.sequence * 10 + index)},
          ${companyId}, ${caseId},
          ${`KOS-TEST-${options.sequence}-${index}`}, 3800,
          ${case_.paymentStatus}, ${case_.filingDueDate}
        )
      `;
    }
  }

  for (const [index, contact] of (options.contacts ?? []).entries()) {
    await sql`
      insert into company_contacts (id, company_id, name, role, email, phone, is_primary)
      values (
        ${testUuid(TEST_CONTACT_UUID_PREFIX, options.sequence * 10 + index)},
        ${companyId}, ${contact.name}, ${contact.role},
        ${contact.email}, ${contact.phone}, ${contact.isPrimary}
      )
    `;
  }

  return companyId;
}

afterAll(async () => {
  await Promise.all(repositories.map((repository) => repository.close()));
  await testSql?.end();
});

describe.skipIf(!databaseUrl)("client repository reads", () => {
  beforeEach(async () => {
    await cleanupClientFixtures();
  });

  afterEach(async () => {
    await cleanupClientFixtures();
  });

  it("lists seeded service packages in sort order", async () => {
    const repository = repositoryForTests();

    const packages = await repository.listServicePackages();

    expect(packages.map((servicePackage) => servicePackage.name)).toEqual([
      "Basic",
      "Standard",
      "Premium",
    ]);
    expect(packages[0]).toMatchObject({
      id: PACKAGE_BASIC_ID,
      defaultFee: 2800,
      currency: "HKD",
      active: true,
    });
  });

  it("returns owners, teams, and packages for assignment forms", async () => {
    const repository = repositoryForTests();

    const options = await repository.listAssignmentOptions();

    expect(options.owners.some((owner) => owner.id === USER_AMY_ID)).toBe(true);
    expect(options.teams.some((team) => team.id === TEAM_ANNUAL_RETURN_ID)).toBe(true);
    expect(options.packages).toHaveLength(3);
  });

  it("derives AR due date and payment status from the most recent case", async () => {
    await seedCompany({
      sequence: 1,
      companyName: "Aaa Lateral Test Ltd",
      cases: [
        { returnYear: 2025, filingDueDate: "2025-03-01", paymentStatus: "Payment received" },
        { returnYear: 2026, filingDueDate: "2026-09-30", paymentStatus: "Payment pending" },
      ],
    });
    const repository = repositoryForTests();

    const clients = await repository.listClients();
    const client = clients.find((row) => row.companyName === "Aaa Lateral Test Ltd");

    expect(client).toMatchObject({
      arDueDate: "2026-09-30",
      paymentStatus: "Payment pending",
      invoiceAmount: 3800,
      packageName: "Standard",
      ownerName: "Amy Chan",
      ownerInitials: "AC",
      status: "active",
    });
  });

  it("includes companies that have no annual return cases", async () => {
    await seedCompany({ sequence: 2, companyName: "Aab No Case Ltd" });
    const repository = repositoryForTests();

    const clients = await repository.listClients();
    const client = clients.find((row) => row.companyName === "Aab No Case Ltd");

    expect(client).toBeDefined();
    expect(client?.arDueDate).toBeNull();
    expect(client?.paymentStatus).toBeNull();
    expect(client?.invoiceAmount).toBeNull();
  });

  it("includes inactive companies so the directory can filter on status", async () => {
    await seedCompany({ sequence: 3, companyName: "Aac Inactive Ltd", status: "inactive" });
    const repository = repositoryForTests();

    const clients = await repository.listClients();

    expect(
      clients.find((row) => row.companyName === "Aac Inactive Ltd")?.status,
    ).toBe("inactive");
  });

  it("hydrates a client with contacts ordered primary first", async () => {
    const companyId = await seedCompany({
      sequence: 1,
      companyName: "Aaa Hydrate Test Ltd",
      cases: [{ returnYear: 2026, filingDueDate: "2026-09-30", paymentStatus: "Overdue" }],
      contacts: [
        { name: "Zoe Ng", role: "Accountant", email: "zoe@example.hk", phone: null, isPrimary: false },
        { name: "Alan Ho", role: "Director", email: null, phone: "+85290000001", isPrimary: true },
      ],
    });
    const repository = repositoryForTests();

    const detail = await repository.getClient(companyId);

    expect(detail?.contacts.map((contact) => contact.name)).toEqual(["Alan Ho", "Zoe Ng"]);
    expect(detail?.contacts[0]).toMatchObject({
      isPrimary: true,
      phone: "+85290000001",
      email: null,
    });
    expect(detail?.annualReturnHistory).toHaveLength(1);
    expect(detail?.annualReturnHistory[0]).toMatchObject({
      returnYear: 2026,
      filingDueDate: "2026-09-30",
    });
    expect(detail?.registeredOffice).toBe("Unit 1, Test Tower, Hong Kong");
    expect(detail?.incorporationDate).toBe("2020-01-15");
    expect(detail?.paymentStatus).toBe("Overdue");
  });

  it("returns null for an unknown client id", async () => {
    const repository = repositoryForTests();

    await expect(
      repository.getClient("99999999-0000-0000-0000-000000000000"),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/clients/repository.test.ts`
Expected: FAIL — cannot resolve `./repository`. Without `TEST_DATABASE_URL` the suite reports as skipped; set that variable before running this task, otherwise the tests prove nothing.

- [ ] **Step 3: Write the read implementation**

Create `src/features/clients/repository.ts`:

```ts
import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type {
  AddContactInput,
  ClientAnnualReturnEntry,
  ClientAssignmentOptions,
  ClientDetail,
  ClientDocument,
  ClientPaymentStatus,
  ClientSummary,
  ClientTimelineEntry,
  CompanyContact,
  CompanyStatus,
  CreateClientInput,
  RemoveContactInput,
  ServicePackage,
  UpdateClientInput,
  UpdateContactInput,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type CreateClientRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type ClientRepository = {
  listServicePackages(): Promise<ServicePackage[]>;
  listAssignmentOptions(): Promise<ClientAssignmentOptions>;
  listClients(): Promise<ClientSummary[]>;
  getClient(id: string): Promise<ClientDetail | null>;
  createClient(input: CreateClientInput): Promise<ClientDetail>;
  updateClient(input: UpdateClientInput): Promise<ClientDetail>;
  addContact(input: AddContactInput): Promise<ClientDetail>;
  updateContact(input: UpdateContactInput): Promise<ClientDetail>;
  removeContact(input: RemoveContactInput): Promise<ClientDetail>;
  close(): Promise<void>;
};

type SummaryRow = {
  id: string;
  company_name: string;
  cr_number: string;
  br_number: string;
  status: CompanyStatus;
  service_package_id: string | null;
  package_name: string | null;
  owner_id: string;
  owner_name: string;
  team_id: string;
  team_name: string;
  filing_due_date: string | Date | null;
  payment_status: ClientPaymentStatus | null;
  payment_amount: number | null;
};

type DetailRow = SummaryRow & {
  incorporation_date: string | Date;
  annual_return_basis_date: string | Date;
  registered_office: string;
  company_secretary: string;
};

type ContactRow = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};

type PackageRow = {
  id: string;
  name: string;
  default_fee: number;
  currency: "HKD";
  active: boolean;
  sort_order: number;
};

function dateOnly(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** "Amy Chan" -> "AC". Single-word names fall back to their first two letters. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "??";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function mapPackage(row: PackageRow): ServicePackage {
  return {
    id: row.id,
    name: row.name,
    defaultFee: row.default_fee,
    currency: row.currency,
    active: row.active,
    sortOrder: row.sort_order,
  };
}

function mapContact(row: ContactRow): CompanyContact {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary,
  };
}

function mapSummary(row: SummaryRow): ClientSummary {
  return {
    id: row.id,
    companyName: row.company_name,
    crNumber: row.cr_number,
    brNumber: row.br_number,
    status: row.status,
    packageId: row.service_package_id,
    packageName: row.package_name,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerInitials: initialsFor(row.owner_name),
    teamId: row.team_id,
    teamName: row.team_name,
    arDueDate: row.filing_due_date ? dateOnly(row.filing_due_date) : null,
    paymentStatus: row.payment_status,
    invoiceAmount: row.payment_amount,
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

export function createClientRepository(
  options?: CreateClientRepositoryOptions,
): ClientRepository;
export function createClientRepository(
  databaseUrl: string | undefined,
  options?: CreateClientRepositoryOptions,
): ClientRepository;
export function createClientRepository(
  databaseUrlOrOptions?: string | CreateClientRepositoryOptions,
  maybeOptions?: CreateClientRepositoryOptions,
): ClientRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function listServicePackages(): Promise<ServicePackage[]> {
    const rows = await sql<PackageRow[]>`
      select id, name, default_fee, currency, active, sort_order
      from service_packages
      order by sort_order asc, name asc
    `;

    return rows.map(mapPackage);
  }

  async function listAssignmentOptions(): Promise<ClientAssignmentOptions> {
    const [owners, teams, packages] = await Promise.all([
      sql<{ id: string; name: string; team_id: string | null }[]>`
        select id, name, team_id
        from users
        where active
        order by name asc
      `,
      sql<{ id: string; name: string }[]>`
        select id, name
        from teams
        where active
        order by name asc
      `,
      listServicePackages(),
    ]);

    return {
      owners: owners.map((owner) => ({
        id: owner.id,
        name: owner.name,
        teamId: owner.team_id,
      })),
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      packages,
    };
  }

  async function listClients(): Promise<ClientSummary[]> {
    const rows = await sql<SummaryRow[]>`
      select
        c.id,
        c.company_name,
        c.cr_number,
        c.br_number,
        c.status,
        c.service_package_id,
        sp.name as package_name,
        u.id as owner_id,
        u.name as owner_name,
        t.id as team_id,
        t.name as team_name,
        latest.filing_due_date,
        latest.payment_status,
        latest.payment_amount
      from companies c
      join users u on u.id = c.assigned_owner_id
      join teams t on t.id = c.assigned_team_id
      left join service_packages sp on sp.id = c.service_package_id
      left join lateral (
        select
          arc.filing_due_date,
          p.status as payment_status,
          p.amount as payment_amount
        from annual_return_cases arc
        left join payments p on p.case_id = arc.id
        where arc.company_id = c.id
        order by arc.return_year desc, arc.filing_due_date desc
        limit 1
      ) latest on true
      order by c.company_name asc
    `;

    return rows.map(mapSummary);
  }

  async function hydrateClient(
    client: QueryClient,
    id: string,
  ): Promise<ClientDetail | null> {
    const detailRows = await client<DetailRow[]>`
      select
        c.id,
        c.company_name,
        c.cr_number,
        c.br_number,
        c.status,
        c.incorporation_date,
        c.annual_return_basis_date,
        c.registered_office,
        c.company_secretary,
        c.service_package_id,
        sp.name as package_name,
        u.id as owner_id,
        u.name as owner_name,
        t.id as team_id,
        t.name as team_name,
        latest.filing_due_date,
        latest.payment_status,
        latest.payment_amount
      from companies c
      join users u on u.id = c.assigned_owner_id
      join teams t on t.id = c.assigned_team_id
      left join service_packages sp on sp.id = c.service_package_id
      left join lateral (
        select
          arc.filing_due_date,
          p.status as payment_status,
          p.amount as payment_amount
        from annual_return_cases arc
        left join payments p on p.case_id = arc.id
        where arc.company_id = c.id
        order by arc.return_year desc, arc.filing_due_date desc
        limit 1
      ) latest on true
      where c.id = ${id}
      limit 1
    `;

    const [detailRow] = detailRows;

    if (!detailRow) {
      return null;
    }

    const [contacts, timeline, history, documents] = await Promise.all([
      client<ContactRow[]>`
        select id, company_id, name, role, email, phone, is_primary
        from company_contacts
        where company_id = ${id}
        order by is_primary desc, name asc
      `,
      client<
        {
          id: string;
          event_type: string;
          actor_type: "system" | "user";
          actor_name: string | null;
          description: string;
          created_at: string | Date;
        }[]
      >`
        select te.id, te.event_type, te.actor_type, u.name as actor_name,
               te.description, te.created_at
        from timeline_events te
        left join users u on u.id = te.actor_id
        where te.company_id = ${id}
        order by te.created_at desc
        limit 50
      `,
      client<
        {
          id: string;
          return_year: number;
          made_up_date: string | Date;
          filing_due_date: string | Date;
          current_status: string;
        }[]
      >`
        select id, return_year, made_up_date, filing_due_date, current_status
        from annual_return_cases
        where company_id = ${id}
        order by return_year desc
      `,
      client<
        {
          id: string;
          file_name: string;
          file_type: string;
          verification_status: ClientDocument["verificationStatus"];
          uploaded_at: string | Date;
        }[]
      >`
        select id, file_name, file_type, verification_status, uploaded_at
        from documents
        where company_id = ${id}
        order by uploaded_at desc
      `,
    ]);

    return {
      ...mapSummary(detailRow),
      incorporationDate: dateOnly(detailRow.incorporation_date),
      annualReturnBasisDate: dateOnly(detailRow.annual_return_basis_date),
      registeredOffice: detailRow.registered_office,
      companySecretary: detailRow.company_secretary,
      contacts: contacts.map(mapContact),
      timeline: timeline.map(
        (row): ClientTimelineEntry => ({
          id: row.id,
          eventType: row.event_type,
          actorType: row.actor_type,
          actorName: row.actor_name,
          description: row.description,
          createdAt: timestampString(row.created_at),
        }),
      ),
      annualReturnHistory: history.map(
        (row): ClientAnnualReturnEntry => ({
          id: row.id,
          returnYear: row.return_year,
          madeUpDate: dateOnly(row.made_up_date),
          filingDueDate: dateOnly(row.filing_due_date),
          currentStatus: row.current_status,
        }),
      ),
      documents: documents.map(
        (row): ClientDocument => ({
          id: row.id,
          fileName: row.file_name,
          fileType: row.file_type,
          verificationStatus: row.verification_status,
          uploadedAt: timestampString(row.uploaded_at),
        }),
      ),
    };
  }

  async function getClient(id: string): Promise<ClientDetail | null> {
    return hydrateClient(sql, id);
  }

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) {
      await sql.end();
    }
  }

  return {
    listServicePackages,
    listAssignmentOptions,
    listClients,
    getClient,
    createClient: async () => {
      throw new Error("createClient is implemented in Task 6.");
    },
    updateClient: async () => {
      throw new Error("updateClient is implemented in Task 6.");
    },
    addContact: async () => {
      throw new Error("addContact is implemented in Task 7.");
    },
    updateContact: async () => {
      throw new Error("updateContact is implemented in Task 7.");
    },
    removeContact: async () => {
      throw new Error("removeContact is implemented in Task 7.");
    },
    close,
  };
}
```

The write methods throw deliberately so Task 5 compiles and its tests run in isolation. Tasks 6 and 7 replace them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/clients/repository.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/repository.ts src/features/clients/repository.test.ts
git commit -m "feat: read client register from postgres"
```

---

### Task 6: Repository Company Writes

**Files:**
- Modify: `src/features/clients/repository.test.ts`
- Modify: `src/features/clients/repository.ts`

- [ ] **Step 1: Write the failing write tests**

Append to `src/features/clients/repository.test.ts`, after the existing `describe` block:

```ts
const CREATE_INPUT_BASE = {
  incorporationDate: "2021-06-01",
  annualReturnBasisDate: "2026-06-01",
  registeredOffice: "Room 8, Test Plaza, Hong Kong",
  companySecretary: "Kossilon Secretaries Ltd",
  ownerId: USER_AMY_ID,
  teamId: TEAM_ANNUAL_RETURN_ID,
  packageId: PACKAGE_BASIC_ID,
  actorId: USER_KEN_ID,
};

describe.skipIf(!databaseUrl)("client repository company writes", () => {
  beforeEach(async () => {
    await cleanupClientFixtures();
  });

  afterEach(async () => {
    await cleanupClientFixtures();
  });

  it("creates a company with its initial contact and a client_created timeline entry", async () => {
    const repository = repositoryForTests();

    const created = await repository.createClient({
      ...CREATE_INPUT_BASE,
      companyName: "Test Create Ltd",
      crNumber: "TEST-CR-0001",
      brNumber: "TEST-BR-0001",
      contacts: [
        {
          name: "Alan Ho",
          role: "Director",
          email: "alan@example.hk",
          phone: null,
          isPrimary: true,
        },
      ],
    });

    expect(created).toMatchObject({
      companyName: "Test Create Ltd",
      crNumber: "TEST-CR-0001",
      status: "active",
      packageName: "Basic",
      ownerName: "Amy Chan",
    });
    expect(created.contacts).toHaveLength(1);
    expect(created.contacts[0]).toMatchObject({ name: "Alan Ho", isPrimary: true });
    expect(created.timeline[0]).toMatchObject({
      eventType: "client_created",
      actorType: "user",
      actorName: "Ken Wong",
    });
  });

  it("creates a company with no contacts", async () => {
    const repository = repositoryForTests();

    const created = await repository.createClient({
      ...CREATE_INPUT_BASE,
      companyName: "Test No Contact Ltd",
      crNumber: "TEST-CR-0002",
      brNumber: "TEST-BR-0002",
      contacts: [],
    });

    expect(created.contacts).toEqual([]);
  });

  it("rejects a duplicate CR number, identifying the field", async () => {
    const repository = repositoryForTests();
    await repository.createClient({
      ...CREATE_INPUT_BASE,
      companyName: "Test Dup One Ltd",
      crNumber: "TEST-CR-0003",
      brNumber: "TEST-BR-0003",
      contacts: [],
    });

    await expect(
      repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test Dup Two Ltd",
        crNumber: "TEST-CR-0003",
        brNumber: "TEST-BR-0004",
        contacts: [],
      }),
    ).rejects.toMatchObject({
      name: "ClientWriteError",
      field: "crNumber",
      message: "A company with this CR number already exists.",
    });
  });

  it("rejects a duplicate BR number, identifying the field", async () => {
    const repository = repositoryForTests();
    await repository.createClient({
      ...CREATE_INPUT_BASE,
      companyName: "Test Dup Br One Ltd",
      crNumber: "TEST-CR-0005",
      brNumber: "TEST-BR-0005",
      contacts: [],
    });

    await expect(
      repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test Dup Br Two Ltd",
        crNumber: "TEST-CR-0006",
        brNumber: "TEST-BR-0005",
        contacts: [],
      }),
    ).rejects.toMatchObject({ field: "brNumber" });
  });

  it("rejects an initial contact with neither email nor phone", async () => {
    const repository = repositoryForTests();

    await expect(
      repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test Unreachable Ltd",
        crNumber: "TEST-CR-0007",
        brNumber: "TEST-BR-0007",
        contacts: [
          { name: "Ghost", role: "Director", email: null, phone: null, isPrimary: true },
        ],
      }),
    ).rejects.toMatchObject({ field: "contact" });
  });

  it("rolls the company back when its initial contact is rejected", async () => {
    const repository = repositoryForTests();

    await expect(
      repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test Rollback Ltd",
        crNumber: "TEST-CR-0008",
        brNumber: "TEST-BR-0008",
        contacts: [
          { name: "Ghost", role: "Director", email: null, phone: null, isPrimary: true },
        ],
      }),
    ).rejects.toThrow();

    const rows = await sqlForTests()`
      select id from companies where cr_number = 'TEST-CR-0008'
    `;
    expect(rows).toHaveLength(0);
  });

  it("rejects an unknown actor before writing anything", async () => {
    const repository = repositoryForTests();

    await expect(
      repository.createClient({
        ...CREATE_INPUT_BASE,
        actorId: "99999999-0000-0000-0000-000000000000",
        companyName: "Test Bad Actor Ltd",
        crNumber: "TEST-CR-0009",
        brNumber: "TEST-BR-0009",
        contacts: [],
      }),
    ).rejects.toThrow("Client actor not found or inactive.");

    const rows = await sqlForTests()`
      select id from companies where cr_number = 'TEST-CR-0009'
    `;
    expect(rows).toHaveLength(0);
  });

  it("records changed field names when updating a company", async () => {
    const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Update Test Ltd" });
    const repository = repositoryForTests();

    const updated = await repository.updateClient({
      id: companyId,
      companyName: "Aaa Update Test Ltd",
      registeredOffice: "New Office, Central, Hong Kong",
      companySecretary: "Kossilon Secretaries Ltd",
      status: "inactive",
      ownerId: USER_KEN_ID,
      teamId: TEAM_ANNUAL_RETURN_ID,
      packageId: PACKAGE_BASIC_ID,
      actorId: USER_AMY_ID,
    });

    expect(updated).toMatchObject({
      status: "inactive",
      ownerName: "Ken Wong",
      packageName: "Basic",
      registeredOffice: "New Office, Central, Hong Kong",
    });
    expect(updated.timeline[0]).toMatchObject({
      eventType: "client_updated",
      actorType: "user",
    });
    expect(updated.timeline[0].description).toContain("registeredOffice");
    expect(updated.timeline[0].description).toContain("status");
    expect(updated.timeline[0].description).not.toContain("companyName");
  });

  it("rejects updating an unknown company", async () => {
    const repository = repositoryForTests();

    await expect(
      repository.updateClient({
        id: "99999999-0000-0000-0000-000000000000",
        companyName: "Nowhere Ltd",
        registeredOffice: "Nowhere",
        companySecretary: "Nobody",
        status: "active",
        ownerId: USER_AMY_ID,
        teamId: TEAM_ANNUAL_RETURN_ID,
        packageId: null,
        actorId: USER_AMY_ID,
      }),
    ).rejects.toThrow("Client not found.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/clients/repository.test.ts`
Expected: FAIL with "createClient is implemented in Task 6."

- [ ] **Step 3: Add the shared write helpers**

In `src/features/clients/repository.ts`, add to the import block at the top:

```ts
import { rethrowClientWriteError } from "./errors";
```

Then, inside `createClientRepository` and immediately after the `hydrateClient` function, add:

```ts
  async function assertActor(tx: TransactionSqlClient, actorId: string): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from users where id = ${actorId} and active limit 1
    `;

    if (rows.length === 0) {
      throw new Error("Client actor not found or inactive.");
    }
  }

  async function writeTimelineEvent(
    tx: TransactionSqlClient,
    input: { companyId: string; eventType: string; actorId: string; description: string },
  ): Promise<void> {
    await tx`
      insert into timeline_events (company_id, event_type, actor_type, actor_id, description)
      values (${input.companyId}, ${input.eventType}, 'user', ${input.actorId}, ${input.description})
    `;
  }

  async function insertContact(
    tx: TransactionSqlClient,
    companyId: string,
    contact: { name: string; role: string; email: string | null; phone: string | null; isPrimary: boolean },
  ): Promise<void> {
    if (contact.isPrimary) {
      await tx`
        update company_contacts set is_primary = false, updated_at = now()
        where company_id = ${companyId} and is_primary
      `;
    }

    await tx`
      insert into company_contacts (company_id, name, role, email, phone, is_primary)
      values (
        ${companyId}, ${contact.name}, ${contact.role},
        ${contact.email}, ${contact.phone}, ${contact.isPrimary}
      )
    `;
  }

  /** Re-reads the company inside the transaction so callers get post-write state. */
  async function hydrateOrThrow(
    tx: TransactionSqlClient,
    companyId: string,
  ): Promise<ClientDetail> {
    const detail = await hydrateClient(tx, companyId);

    if (!detail) {
      throw new Error("Client not found.");
    }

    return detail;
  }
```

- [ ] **Step 4: Implement createClient and updateClient**

Still inside `createClientRepository`, add after the helpers from Step 3:

```ts
  async function createClient(input: CreateClientInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);

        const rows = await tx<{ id: string }[]>`
          insert into companies (
            company_name, cr_number, br_number, incorporation_date,
            annual_return_basis_date, registered_office, company_secretary,
            status, assigned_owner_id, assigned_team_id, service_package_id
          )
          values (
            ${input.companyName}, ${input.crNumber}, ${input.brNumber},
            ${input.incorporationDate}, ${input.annualReturnBasisDate},
            ${input.registeredOffice}, ${input.companySecretary},
            'active', ${input.ownerId}, ${input.teamId}, ${input.packageId}
          )
          returning id
        `;

        const companyId = rows[0].id;

        for (const contact of input.contacts) {
          await insertContact(tx, companyId, contact);
        }

        await writeTimelineEvent(tx, {
          companyId,
          eventType: "client_created",
          actorId: input.actorId,
          description: `Client ${input.companyName} added to the register.`,
        });

        return hydrateOrThrow(tx, companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  /** Field names whose values changed, for the timeline entry. */
  function changedFields(
    before: ClientDetail,
    input: UpdateClientInput,
  ): string[] {
    const comparisons: [string, unknown, unknown][] = [
      ["companyName", before.companyName, input.companyName],
      ["registeredOffice", before.registeredOffice, input.registeredOffice],
      ["companySecretary", before.companySecretary, input.companySecretary],
      ["status", before.status, input.status],
      ["ownerId", before.ownerId, input.ownerId],
      ["teamId", before.teamId, input.teamId],
      ["packageId", before.packageId, input.packageId],
    ];

    return comparisons
      .filter(([, previous, next]) => previous !== next)
      .map(([field]) => field);
  }

  async function updateClient(input: UpdateClientInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);

        const before = await hydrateOrThrow(tx, input.id);
        const changed = changedFields(before, input);

        await tx`
          update companies
          set company_name = ${input.companyName},
              registered_office = ${input.registeredOffice},
              company_secretary = ${input.companySecretary},
              status = ${input.status},
              assigned_owner_id = ${input.ownerId},
              assigned_team_id = ${input.teamId},
              service_package_id = ${input.packageId},
              updated_at = now()
          where id = ${input.id}
        `;

        if (changed.length > 0) {
          await writeTimelineEvent(tx, {
            companyId: input.id,
            eventType: "client_updated",
            actorId: input.actorId,
            description: `Updated ${changed.join(", ")}.`,
          });
        }

        return hydrateOrThrow(tx, input.id);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }
```

- [ ] **Step 5: Replace the placeholder entries in the returned object**

In the object returned at the end of `createClientRepository`, replace the two throwing placeholders:

```ts
    createClient: async () => {
      throw new Error("createClient is implemented in Task 6.");
    },
    updateClient: async () => {
      throw new Error("updateClient is implemented in Task 6.");
    },
```

with:

```ts
    createClient,
    updateClient,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/features/clients/repository.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 7: Commit**

```bash
git add src/features/clients/repository.ts src/features/clients/repository.test.ts
git commit -m "feat: create and update companies in the client register"
```

---

### Task 7: Repository Contact Writes

**Files:**
- Modify: `src/features/clients/repository.test.ts`
- Modify: `src/features/clients/repository.ts`

- [ ] **Step 1: Write the failing contact tests**

Append to `src/features/clients/repository.test.ts`:

```ts
describe.skipIf(!databaseUrl)("client repository contact writes", () => {
  beforeEach(async () => {
    await cleanupClientFixtures();
  });

  afterEach(async () => {
    await cleanupClientFixtures();
  });

  it("adds a contact and records a timeline entry", async () => {
    const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Contact Add Ltd" });
    const repository = repositoryForTests();

    const detail = await repository.addContact({
      companyId,
      name: "Alan Ho",
      role: "Director",
      email: "alan@example.hk",
      phone: null,
      isPrimary: true,
      actorId: USER_AMY_ID,
    });

    expect(detail.contacts).toHaveLength(1);
    expect(detail.contacts[0]).toMatchObject({ name: "Alan Ho", isPrimary: true });
    expect(detail.timeline[0]).toMatchObject({ eventType: "contact_added" });
    expect(detail.timeline[0].description).toContain("Alan Ho");
  });

  it("demotes the previous primary when a new contact is promoted", async () => {
    const companyId = await seedCompany({
      sequence: 1,
      companyName: "Aaa Primary Swap Ltd",
      contacts: [
        { name: "Alan Ho", role: "Director", email: "alan@example.hk", phone: null, isPrimary: true },
      ],
    });
    const repository = repositoryForTests();

    const detail = await repository.addContact({
      companyId,
      name: "Bella Sit",
      role: "Company Secretary",
      email: null,
      phone: "+85290000002",
      isPrimary: true,
      actorId: USER_AMY_ID,
    });

    const primaries = detail.contacts.filter((contact) => contact.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].name).toBe("Bella Sit");
  });

  it("promotes an existing contact and demotes the previous primary", async () => {
    const companyId = await seedCompany({
      sequence: 1,
      companyName: "Aaa Promote Ltd",
      contacts: [
        { name: "Alan Ho", role: "Director", email: "alan@example.hk", phone: null, isPrimary: true },
        { name: "Zoe Ng", role: "Accountant", email: "zoe@example.hk", phone: null, isPrimary: false },
      ],
    });
    const repository = repositoryForTests();
    const before = await repository.getClient(companyId);
    const zoe = before!.contacts.find((contact) => contact.name === "Zoe Ng")!;

    const detail = await repository.updateContact({
      companyId,
      contactId: zoe.id,
      name: "Zoe Ng",
      role: "Accountant",
      email: "zoe@example.hk",
      phone: null,
      isPrimary: true,
      actorId: USER_AMY_ID,
    });

    const primaries = detail.contacts.filter((contact) => contact.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].name).toBe("Zoe Ng");
    expect(detail.timeline[0]).toMatchObject({ eventType: "contact_updated" });
  });

  it("rejects a contact with neither email nor phone", async () => {
    const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Unreachable Ltd" });
    const repository = repositoryForTests();

    await expect(
      repository.addContact({
        companyId,
        name: "Ghost",
        role: "Director",
        email: null,
        phone: null,
        isPrimary: false,
        actorId: USER_AMY_ID,
      }),
    ).rejects.toMatchObject({ field: "contact" });
  });

  it("removes the primary contact without error, leaving none", async () => {
    const companyId = await seedCompany({
      sequence: 1,
      companyName: "Aaa Remove Primary Ltd",
      contacts: [
        { name: "Alan Ho", role: "Director", email: "alan@example.hk", phone: null, isPrimary: true },
        { name: "Zoe Ng", role: "Accountant", email: "zoe@example.hk", phone: null, isPrimary: false },
      ],
    });
    const repository = repositoryForTests();
    const before = await repository.getClient(companyId);
    const alan = before!.contacts.find((contact) => contact.name === "Alan Ho")!;

    const detail = await repository.removeContact({
      companyId,
      contactId: alan.id,
      actorId: USER_AMY_ID,
    });

    expect(detail.contacts).toHaveLength(1);
    expect(detail.contacts.some((contact) => contact.isPrimary)).toBe(false);
    expect(detail.timeline[0]).toMatchObject({ eventType: "contact_removed" });
  });

  it("rejects removing a contact that belongs to another company", async () => {
    const companyId = await seedCompany({
      sequence: 1,
      companyName: "Aaa Owner Ltd",
      contacts: [
        { name: "Alan Ho", role: "Director", email: "alan@example.hk", phone: null, isPrimary: true },
      ],
    });
    const otherCompanyId = await seedCompany({ sequence: 2, companyName: "Aab Other Ltd" });
    const repository = repositoryForTests();
    const before = await repository.getClient(companyId);
    const alan = before!.contacts[0];

    await expect(
      repository.removeContact({
        companyId: otherCompanyId,
        contactId: alan.id,
        actorId: USER_AMY_ID,
      }),
    ).rejects.toThrow("Contact not found for this company.");
  });

  it("rejects an inactive actor", async () => {
    const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Inactive Actor Ltd" });
    const sql = sqlForTests();
    await sql`update users set active = false where id = ${USER_KEN_ID}`;
    const repository = repositoryForTests();

    try {
      await expect(
        repository.addContact({
          companyId,
          name: "Alan Ho",
          role: "Director",
          email: "alan@example.hk",
          phone: null,
          isPrimary: false,
          actorId: USER_KEN_ID,
        }),
      ).rejects.toThrow("Client actor not found or inactive.");
    } finally {
      await sql`update users set active = true where id = ${USER_KEN_ID}`;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/clients/repository.test.ts`
Expected: FAIL with "addContact is implemented in Task 7."

- [ ] **Step 3: Implement the contact operations**

In `src/features/clients/repository.ts`, add after `updateClient`:

```ts
  async function assertContactBelongsToCompany(
    tx: TransactionSqlClient,
    companyId: string,
    contactId: string,
  ): Promise<ContactRow> {
    const rows = await tx<ContactRow[]>`
      select id, company_id, name, role, email, phone, is_primary
      from company_contacts
      where id = ${contactId} and company_id = ${companyId}
      limit 1
    `;

    const [row] = rows;

    if (!row) {
      throw new Error("Contact not found for this company.");
    }

    return row;
  }

  async function addContact(input: AddContactInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await hydrateOrThrow(tx, input.companyId);

        await insertContact(tx, input.companyId, {
          name: input.name,
          role: input.role,
          email: input.email,
          phone: input.phone,
          isPrimary: input.isPrimary,
        });

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "contact_added",
          actorId: input.actorId,
          description: `Added contact ${input.name} (${input.role}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function updateContact(input: UpdateContactInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        await assertContactBelongsToCompany(tx, input.companyId, input.contactId);

        if (input.isPrimary) {
          await tx`
            update company_contacts set is_primary = false, updated_at = now()
            where company_id = ${input.companyId}
              and is_primary
              and id <> ${input.contactId}
          `;
        }

        await tx`
          update company_contacts
          set name = ${input.name},
              role = ${input.role},
              email = ${input.email},
              phone = ${input.phone},
              is_primary = ${input.isPrimary},
              updated_at = now()
          where id = ${input.contactId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "contact_updated",
          actorId: input.actorId,
          description: `Updated contact ${input.name} (${input.role}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }

  async function removeContact(input: RemoveContactInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const contact = await assertContactBelongsToCompany(
          tx,
          input.companyId,
          input.contactId,
        );

        await tx`
          delete from company_contacts
          where id = ${input.contactId} and company_id = ${input.companyId}
        `;

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "contact_removed",
          actorId: input.actorId,
          description: `Removed contact ${contact.name} (${contact.role}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }
```

- [ ] **Step 4: Replace the remaining placeholders in the returned object**

Replace:

```ts
    addContact: async () => {
      throw new Error("addContact is implemented in Task 7.");
    },
    updateContact: async () => {
      throw new Error("updateContact is implemented in Task 7.");
    },
    removeContact: async () => {
      throw new Error("removeContact is implemented in Task 7.");
    },
```

with:

```ts
    addContact,
    updateContact,
    removeContact,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/clients/repository.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/repository.ts src/features/clients/repository.test.ts
git commit -m "feat: manage company contacts in the client register"
```

---

### Task 8: Server Functions

**Files:**
- Create: `src/features/clients/server-fns.ts`

No test of its own. These are thin zod-validated wrappers with no branching beyond validation, and the repository behind them is covered by Tasks 5 to 7. The project has no route or component test harness, so testing these would mean adding one — out of scope for this phase.

- [ ] **Step 1: Write the server functions**

Create `src/features/clients/server-fns.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCurrentActorId } from "@/features/session/actor";
import { createClientRepository } from "./repository";

const contactSchema = z
  .object({
    name: z.string().min(1),
    role: z.string().min(1),
    email: z.string().email().nullable(),
    phone: z.string().min(3).nullable(),
    isPrimary: z.boolean(),
  })
  .refine((contact) => contact.email !== null || contact.phone !== null, {
    message: "Provide an email or a phone number.",
    path: ["email"],
  });

const createClientSchema = z.object({
  companyName: z.string().min(1),
  crNumber: z.string().min(1),
  brNumber: z.string().min(1),
  incorporationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  annualReturnBasisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  registeredOffice: z.string().min(1),
  companySecretary: z.string().min(1),
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
  contacts: z.array(contactSchema).default([]),
});

const updateClientSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string().min(1),
  registeredOffice: z.string().min(1),
  companySecretary: z.string().min(1),
  status: z.enum(["active", "inactive"]),
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
});

const addContactSchema = z.object({ companyId: z.string().uuid() }).and(contactSchema);

const updateContactSchema = z
  .object({ companyId: z.string().uuid(), contactId: z.string().uuid() })
  .and(contactSchema);

const removeContactSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid(),
});

export const listClients = createServerFn({ method: "GET" }).handler(async () =>
  createClientRepository().listClients(),
);

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () =>
  createClientRepository().listAssignmentOptions(),
);

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => createClientRepository().getClient(data.id));

export const createClient = createServerFn({ method: "POST" })
  .validator(createClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().createClient({ ...data, actorId: getCurrentActorId() }),
  );

export const updateClient = createServerFn({ method: "POST" })
  .validator(updateClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateClient({ ...data, actorId: getCurrentActorId() }),
  );

export const addClientContact = createServerFn({ method: "POST" })
  .validator(addContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().addContact({ ...data, actorId: getCurrentActorId() }),
  );

export const updateClientContact = createServerFn({ method: "POST" })
  .validator(updateContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateContact({ ...data, actorId: getCurrentActorId() }),
  );

export const removeClientContact = createServerFn({ method: "POST" })
  .validator(removeContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().removeContact({ ...data, actorId: getCurrentActorId() }),
  );
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/clients/server-fns.ts
git commit -m "feat: add client register server functions"
```

---

### Task 9: Client Form Dialogs

**Files:**
- Create: `src/components/clients/client-form-dialog.tsx`
- Create: `src/components/clients/contact-form-dialog.tsx`

These are built before the routes so the routes can import them and compile in one pass.

- [ ] **Step 1: Write the company dialog**

Create `src/components/clients/client-form-dialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient, updateClient } from "@/features/clients/server-fns";
import type { ClientAssignmentOptions, ClientDetail } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ClientAssignmentOptions;
  /** Omit to create a new client; supply to edit an existing one. */
  client?: ClientDetail;
  onSaved: (clientId: string) => void;
};

type FormState = {
  companyName: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  status: "active" | "inactive";
  ownerId: string;
  teamId: string;
  packageId: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
};

function emptyForm(options: ClientAssignmentOptions): FormState {
  return {
    companyName: "",
    crNumber: "",
    brNumber: "",
    incorporationDate: "",
    annualReturnBasisDate: "",
    registeredOffice: "",
    companySecretary: "Kossilon Secretaries Ltd",
    status: "active",
    ownerId: options.owners[0]?.id ?? "",
    teamId: options.teams[0]?.id ?? "",
    packageId: options.packages[0]?.id ?? "",
    contactName: "",
    contactRole: "Primary contact",
    contactEmail: "",
    contactPhone: "",
  };
}

function formFor(client: ClientDetail, options: ClientAssignmentOptions): FormState {
  return {
    companyName: client.companyName,
    crNumber: client.crNumber,
    brNumber: client.brNumber,
    incorporationDate: client.incorporationDate,
    annualReturnBasisDate: client.annualReturnBasisDate,
    registeredOffice: client.registeredOffice,
    companySecretary: client.companySecretary,
    status: client.status,
    ownerId: client.ownerId,
    teamId: client.teamId,
    packageId: client.packageId ?? options.packages[0]?.id ?? "",
    contactName: "",
    contactRole: "Primary contact",
    contactEmail: "",
    contactPhone: "",
  };
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function ClientFormDialog({ open, onOpenChange, options, client, onSaved }: Props) {
  const isEdit = Boolean(client);
  const [form, setForm] = useState<FormState>(() =>
    client ? formFor(client, options) : emptyForm(options),
  );
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(client ? formFor(client, options) : emptyForm(options));
      setFieldError(null);
    }
  }, [open, client, options]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldError(null);
    setSaving(true);

    try {
      if (client) {
        const saved = await updateClient({
          data: {
            id: client.id,
            companyName: form.companyName,
            registeredOffice: form.registeredOffice,
            companySecretary: form.companySecretary,
            status: form.status,
            ownerId: form.ownerId,
            teamId: form.teamId,
            packageId: form.packageId || null,
          },
        });
        toast.success("Client updated.");
        onSaved(saved.id);
      } else {
        const hasContact = form.contactName.trim().length > 0;
        const saved = await createClient({
          data: {
            companyName: form.companyName,
            crNumber: form.crNumber,
            brNumber: form.brNumber,
            incorporationDate: form.incorporationDate,
            annualReturnBasisDate: form.annualReturnBasisDate,
            registeredOffice: form.registeredOffice,
            companySecretary: form.companySecretary,
            ownerId: form.ownerId,
            teamId: form.teamId,
            packageId: form.packageId || null,
            contacts: hasContact
              ? [
                  {
                    name: form.contactName,
                    role: form.contactRole,
                    email: form.contactEmail.trim() || null,
                    phone: form.contactPhone.trim() || null,
                    isPrimary: true,
                  },
                ]
              : [],
          },
        });
        toast.success("Client added.");
        onSaved(saved.id);
      }

      onOpenChange(false);
    } catch (error) {
      const field = (error as { field?: string }).field;
      const message =
        error instanceof Error ? error.message : "Unable to save the client.";

      if (field) {
        setFieldError({ field, message });
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit client" : "Add client"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the company record. Changes are recorded on the company timeline."
              : "Create a company in the register. CR and BR numbers must be unique."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="client-name">
              Company name
            </label>
            <input
              id="client-name"
              className={inputClass}
              value={form.companyName}
              onChange={(event) => set("companyName", event.target.value)}
              required
            />
          </div>

          {!isEdit && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="client-cr">
                  CR number
                </label>
                <input
                  id="client-cr"
                  className={inputClass}
                  value={form.crNumber}
                  onChange={(event) => set("crNumber", event.target.value)}
                  required
                />
                {fieldError?.field === "crNumber" && (
                  <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
                )}
              </div>
              <div>
                <label className={labelClass} htmlFor="client-br">
                  BR number
                </label>
                <input
                  id="client-br"
                  className={inputClass}
                  value={form.brNumber}
                  onChange={(event) => set("brNumber", event.target.value)}
                  required
                />
                {fieldError?.field === "brNumber" && (
                  <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
                )}
              </div>
              <div>
                <label className={labelClass} htmlFor="client-incorporated">
                  Incorporation date
                </label>
                <input
                  id="client-incorporated"
                  type="date"
                  className={inputClass}
                  value={form.incorporationDate}
                  onChange={(event) => set("incorporationDate", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="client-basis">
                  Annual return basis date
                </label>
                <input
                  id="client-basis"
                  type="date"
                  className={inputClass}
                  value={form.annualReturnBasisDate}
                  onChange={(event) => set("annualReturnBasisDate", event.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="client-office">
              Registered office
            </label>
            <input
              id="client-office"
              className={inputClass}
              value={form.registeredOffice}
              onChange={(event) => set("registeredOffice", event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="client-owner">
                Owner
              </label>
              <select
                id="client-owner"
                className={inputClass}
                value={form.ownerId}
                onChange={(event) => set("ownerId", event.target.value)}
              >
                {options.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="client-team">
                Team
              </label>
              <select
                id="client-team"
                className={inputClass}
                value={form.teamId}
                onChange={(event) => set("teamId", event.target.value)}
              >
                {options.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="client-package">
                Package
              </label>
              <select
                id="client-package"
                className={inputClass}
                value={form.packageId}
                onChange={(event) => set("packageId", event.target.value)}
              >
                {options.packages.map((servicePackage) => (
                  <option key={servicePackage.id} value={servicePackage.id}>
                    {servicePackage.name} — HKD {servicePackage.defaultFee.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isEdit && (
            <div>
              <label className={labelClass} htmlFor="client-status">
                Status
              </label>
              <select
                id="client-status"
                className={inputClass}
                value={form.status}
                onChange={(event) => set("status", event.target.value as "active" | "inactive")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Clients are deactivated, never deleted — deleting a company would remove its
                annual return history.
              </p>
            </div>
          )}

          {!isEdit && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-xs font-medium text-foreground">
                Primary contact (optional)
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="contact-name">
                    Name
                  </label>
                  <input
                    id="contact-name"
                    className={inputClass}
                    value={form.contactName}
                    onChange={(event) => set("contactName", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-role">
                    Role
                  </label>
                  <input
                    id="contact-role"
                    className={inputClass}
                    value={form.contactRole}
                    onChange={(event) => set("contactRole", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-email">
                    Email
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    className={inputClass}
                    value={form.contactEmail}
                    onChange={(event) => set("contactEmail", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="contact-phone">
                    Phone
                  </label>
                  <input
                    id="contact-phone"
                    className={inputClass}
                    value={form.contactPhone}
                    onChange={(event) => set("contactPhone", event.target.value)}
                  />
                </div>
              </div>
              {fieldError?.field === "contact" && (
                <p className="mt-2 text-xs text-destructive">{fieldError.message}</p>
              )}
            </div>
          )}

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
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add client"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the contact dialog**

Create `src/components/clients/contact-form-dialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addClientContact, updateClientContact } from "@/features/clients/server-fns";
import type { CompanyContact } from "@/features/clients/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Omit to add a new contact; supply to edit an existing one. */
  contact?: CompanyContact;
  onSaved: () => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function ContactFormDialog({ open, onOpenChange, companyId, contact, onSaved }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setName(contact?.name ?? "");
    setRole(contact?.role ?? "Primary contact");
    setEmail(contact?.email ?? "");
    setPhone(contact?.phone ?? "");
    setIsPrimary(contact?.isPrimary ?? false);
    setError(null);
  }, [open, contact]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!email.trim() && !phone.trim()) {
      setError("Provide an email or a phone number.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const payload = {
        companyId,
        name,
        role,
        email: email.trim() || null,
        phone: phone.trim() || null,
        isPrimary,
      };

      if (contact) {
        await updateClientContact({ data: { ...payload, contactId: contact.id } });
        toast.success("Contact updated.");
      } else {
        await addClientContact({ data: payload });
        toast.success("Contact added.");
      }

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            A contact needs at least an email or a phone number.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="contact-form-name">
                Name
              </label>
              <input
                id="contact-form-name"
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-role">
                Role
              </label>
              <input
                id="contact-form-role"
                className={inputClass}
                value={role}
                onChange={(event) => setRole(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-email">
                Email
              </label>
              <input
                id="contact-form-email"
                type="email"
                className={inputClass}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="contact-form-phone">
                Phone
              </label>
              <input
                id="contact-form-phone"
                className={inputClass}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(event) => setIsPrimary(event.target.checked)}
            />
            Primary contact
          </label>
          <p className="text-xs text-muted-foreground">
            Marking this contact primary demotes the company&apos;s current primary contact.
          </p>

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
              {saving ? "Saving…" : "Save contact"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/clients
git commit -m "feat: add client and contact form dialogs"
```

---

### Task 10: Client Directory Route

**Files:**
- Modify: `src/routes/clients.tsx`

- [ ] **Step 1: Replace the route**

Replace the whole of `src/routes/clients.tsx`:

```tsx
import { useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { listClientAssignmentOptions, listClients } from "@/features/clients/server-fns";
import type { ClientAssignmentOptions, ClientSummary } from "@/features/clients/types";
import { formatDate } from "@/lib/mock-data";
import { Plus } from "lucide-react";

type ClientsLoaderData = {
  clients: ClientSummary[];
  options: ClientAssignmentOptions;
  available: boolean;
  error: string | null;
};

const EMPTY_OPTIONS: ClientAssignmentOptions = { owners: [], teams: [], packages: [] };

async function loadClientDirectory(): Promise<ClientsLoaderData> {
  try {
    const [clients, options] = await Promise.all([
      listClients(),
      listClientAssignmentOptions(),
    ]);

    return { clients, options, available: true, error: null };
  } catch {
    return {
      clients: [],
      options: EMPTY_OPTIONS,
      available: false,
      error: "The client directory is temporarily unavailable.",
    };
  }
}

function isClientsIndexPath(pathname: string) {
  return pathname === "/clients" || pathname === "/clients/";
}

export const Route = createFileRoute("/clients")({
  loader: ({ location }) =>
    isClientsIndexPath(location.pathname)
      ? loadClientDirectory()
      : { clients: [], options: EMPTY_OPTIONS, available: true, error: null },
  head: () => ({
    meta: [
      { title: "Clients — Kossilon CoSec OS" },
      {
        name: "description",
        content:
          "Client company directory with annual return deadlines, assigned team, and payment status.",
      },
    ],
  }),
  component: ClientsPage,
});

function paymentTone(status: ClientSummary["paymentStatus"]) {
  if (status === "Payment received") return "green" as const;
  if (status === "Overdue") return "red" as const;
  if (status === "Payment pending") return "yellow" as const;
  return "neutral" as const;
}

function ClientsPage() {
  const { clients, options, available, error } = Route.useLoaderData() as ClientsLoaderData;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [packageFilter, setPackageFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [addOpen, setAddOpen] = useState(false);

  const packageNames = useMemo(
    () =>
      Array.from(
        new Set(clients.map((client) => client.packageName).filter((name): name is string =>
          Boolean(name),
        )),
      ).sort(),
    [clients],
  );

  const teamNames = useMemo(
    () => Array.from(new Set(clients.map((client) => client.teamName))).sort(),
    [clients],
  );

  const visibleClients = useMemo(() => {
    const query = search.trim().toLowerCase();

    return clients.filter((client) => {
      if (statusFilter !== "all" && client.status !== statusFilter) return false;
      if (packageFilter !== "all" && client.packageName !== packageFilter) return false;
      if (teamFilter !== "all" && client.teamName !== teamFilter) return false;
      if (!query) return true;

      return (
        client.companyName.toLowerCase().includes(query) ||
        client.crNumber.toLowerCase().includes(query) ||
        client.brNumber.toLowerCase().includes(query) ||
        client.ownerName.toLowerCase().includes(query)
      );
    });
  }, [clients, search, packageFilter, teamFilter, statusFilter]);

  return (
    <>
      <TopBar
        title="Clients"
        subtitle={
          available
            ? `${visibleClients.length} of ${clients.length} companies under management`
            : "Directory unavailable"
        }
        actions={
          <button
            onClick={() => setAddOpen(true)}
            disabled={!available}
            className="hidden items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 md:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" /> Add client
          </button>
        }
      />
      <main className="flex-1 p-6">
        {!available ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="text-sm font-medium text-foreground">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The register could not be reached. Existing clients are unaffected.
            </p>
            <button
              onClick={() => router.invalidate()}
              className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search clients…"
                  className="min-w-40 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                />
                <select
                  value={packageFilter}
                  onChange={(event) => setPackageFilter(event.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="all">All packages</option>
                  {packageNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={teamFilter}
                  onChange={(event) => setTeamFilter(event.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="all">All teams</option>
                  {teamNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as "active" | "inactive" | "all")
                  }
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="all">All statuses</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Company</th>
                    <th className="px-5 py-3 font-medium">BR / CR</th>
                    <th className="px-5 py-3 font-medium">Package</th>
                    <th className="px-5 py-3 font-medium">AR deadline</th>
                    <th className="px-5 py-3 font-medium">Payment</th>
                    <th className="px-5 py-3 font-medium">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleClients.map((client) => (
                    <tr key={client.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <Link
                          to="/clients/$id"
                          params={{ id: client.id }}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {client.companyName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {client.teamName}
                          {client.status === "inactive" ? " · Inactive" : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">
                        BR {client.brNumber}
                        <br />
                        CR {client.crNumber}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill tone="neutral">{client.packageName ?? "—"}</StatusPill>
                      </td>
                      <td className="px-5 py-3">
                        {client.arDueDate ? (
                          <>
                            <DeadlinePill dueDate={client.arDueDate} />
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {formatDate(client.arDueDate)}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No case</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill tone={paymentTone(client.paymentStatus)}>
                          {client.paymentStatus ?? "Not invoiced"}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sand text-[10px] font-semibold text-white">
                            {client.ownerInitials}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {client.ownerName}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visibleClients.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                        No clients match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <ClientFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        options={options}
        onSaved={() => router.invalidate()}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/clients.tsx
git commit -m "feat: serve the client directory from postgres"
```

---

### Task 11: Client Profile Route

**Files:**
- Modify: `src/routes/clients.$id.tsx`

- [ ] **Step 1: Replace the route**

Replace the whole of `src/routes/clients.$id.tsx`:

```tsx
import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ContactFormDialog } from "@/components/clients/contact-form-dialog";
import {
  getClient,
  listClientAssignmentOptions,
  removeClientContact,
} from "@/features/clients/server-fns";
import type {
  ClientAssignmentOptions,
  ClientDetail,
  CompanyContact,
} from "@/features/clients/types";
import { formatDate, formatDateTime } from "@/lib/mock-data";
import { Building2, CreditCard, FileText, Mail, MapPin, Phone, Plus } from "lucide-react";

type ClientDetailLoaderData = {
  client: ClientDetail;
  options: ClientAssignmentOptions;
};

export const Route = createFileRoute("/clients/$id")({
  loader: async ({ params }): Promise<ClientDetailLoaderData> => {
    const [client, options] = await Promise.all([
      getClient({ data: { id: params.id } }),
      listClientAssignmentOptions(),
    ]);

    if (!client) {
      throw notFound();
    }

    return { client, options };
  },
  head: () => ({
    meta: [
      { title: "Client — Kossilon CoSec OS" },
      {
        name: "description",
        content: "Client profile, annual return history, documents, and payment status.",
      },
    ],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center text-muted-foreground">
      Client not found.{" "}
      <Link to="/clients" className="text-primary underline">
        Back to clients
      </Link>
    </div>
  ),
  component: ClientProfilePage,
});

function paymentTone(status: ClientDetail["paymentStatus"]) {
  if (status === "Payment received") return "green" as const;
  if (status === "Overdue") return "red" as const;
  if (status === "Payment pending") return "yellow" as const;
  return "neutral" as const;
}

function ClientProfilePage() {
  const { client, options } = Route.useLoaderData() as ClientDetailLoaderData;
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CompanyContact | undefined>(undefined);
  const [removingContactId, setRemovingContactId] = useState<string | null>(null);

  function openAddContact() {
    setEditingContact(undefined);
    setContactOpen(true);
  }

  function openEditContact(contact: CompanyContact) {
    setEditingContact(contact);
    setContactOpen(true);
  }

  async function handleRemoveContact(contact: CompanyContact) {
    setRemovingContactId(contact.id);

    try {
      await removeClientContact({ data: { companyId: client.id, contactId: contact.id } });
      toast.success("Contact removed.");
      await router.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove the contact.",
      );
    } finally {
      setRemovingContactId(null);
    }
  }

  return (
    <>
      <TopBar
        title={client.companyName}
        subtitle={`BR ${client.brNumber} · CR ${client.crNumber} · Incorporated ${formatDate(client.incorporationDate)}`}
        actions={
          <button
            onClick={() => setEditOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
          >
            Edit client
          </button>
        }
      />

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-display text-xl font-semibold text-foreground">
                    {client.companyName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {client.packageName ?? "No package"} · {client.teamName}
                    {client.status === "inactive" ? " · Inactive" : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={paymentTone(client.paymentStatus)}>
                  Payment · {client.paymentStatus ?? "Not invoiced"}
                </StatusPill>
                {client.arDueDate && <DeadlinePill dueDate={client.arDueDate} showDate />}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  AR deadline
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {client.arDueDate ? formatDate(client.arDueDate) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Owner</p>
                <p className="mt-1 font-medium text-foreground">{client.ownerName}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Invoice
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {client.invoiceAmount === null
                    ? "—"
                    : `HKD ${client.invoiceAmount.toLocaleString()}`}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Company secretary
                </p>
                <p className="mt-1 font-medium text-foreground">{client.companySecretary}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">Contacts</h2>
              <button
                onClick={openAddContact}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50"
              >
                <Plus className="h-3 w-3" /> Add contact
              </button>
            </div>
            <ul className="divide-y divide-border">
              {client.contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {contact.name}
                      {contact.isPrimary && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">
                          Primary
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{contact.role}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    {contact.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {contact.email}
                      </span>
                    )}
                    {contact.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {contact.phone}
                      </span>
                    )}
                    <button
                      onClick={() => openEditContact(contact)}
                      className="text-primary hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleRemoveContact(contact)}
                      disabled={removingContactId === contact.id}
                      className="text-destructive hover:underline disabled:opacity-60"
                    >
                      {removingContactId === contact.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
              {client.contacts.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No contacts recorded for this company.
                </li>
              )}
              <li className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {client.registeredOffice}
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">
                Annual return history
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {client.annualReturnHistory.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{formatDate(entry.filingDueDate)}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.returnYear} · made up {formatDate(entry.madeUpDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone="neutral">{entry.currentStatus}</StatusPill>
                    <Link
                      to="/annual-returns/$id"
                      params={{ id: entry.id }}
                      className="text-xs text-primary hover:underline"
                    >
                      Open case
                    </Link>
                  </div>
                </li>
              ))}
              {client.annualReturnHistory.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No annual return cases yet.
                </li>
              )}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">Documents</h3>
              </div>
              {client.documents.slice(0, 6).map((document) => (
                <div
                  key={document.id}
                  className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0"
                >
                  <span className="truncate text-foreground">{document.fileName}</span>
                  <StatusPill
                    tone={
                      document.verificationStatus === "verified"
                        ? "green"
                        : document.verificationStatus === "rejected"
                          ? "red"
                          : "yellow"
                    }
                  >
                    {document.verificationStatus}
                  </StatusPill>
                </div>
              ))}
              {client.documents.length === 0 && (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">Payment</h3>
              </div>
              <div className="text-sm">
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Invoice amount</span>
                  <span className="font-medium">
                    {client.invoiceAmount === null
                      ? "—"
                      : `HKD ${client.invoiceAmount.toLocaleString()}`}
                  </span>
                </div>
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Status</span>
                  <StatusPill tone={paymentTone(client.paymentStatus)}>
                    {client.paymentStatus ?? "Not invoiced"}
                  </StatusPill>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Basis date</span>
                  <span className="font-medium">
                    {formatDate(client.annualReturnBasisDate)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">
                Company timeline
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {client.timeline.map((entry) => (
                <li key={entry.id} className="px-5 py-3">
                  <p className="text-sm text-foreground">{entry.description}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {formatDateTime(entry.createdAt)} ·{" "}
                    {entry.actorName ?? (entry.actorType === "system" ? "System" : "Unknown")}
                  </p>
                </li>
              ))}
              {client.timeline.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No activity recorded yet.
                </li>
              )}
            </ul>
          </div>
        </div>
      </main>

      <ClientFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        options={options}
        client={client}
        onSaved={() => router.invalidate()}
      />

      <ContactFormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        companyId={client.id}
        contact={editingContact}
        onSaved={() => router.invalidate()}
      />
    </>
  );
}
```

The `Timeline` component is not reused here: it expects the mock `TimelineEvent` shape with a `kind` discriminator that `timeline_events` does not carry. Rendering the entries inline avoids bending either type to fit the other.

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/clients.\$id.tsx
git commit -m "feat: serve the client profile from postgres"
```

---

### Task 12: Retire the Mock Client Store

**Files:**
- Modify: `src/components/convert-to-client-dialog.tsx`
- Modify: `src/routes/enquiries.tsx`
- Delete: `src/lib/clients-store.ts`

- [ ] **Step 1: Rewire the convert dialog**

Replace the whole of `src/components/convert-to-client-dialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient, listClientAssignmentOptions } from "@/features/clients/server-fns";
import type { ClientAssignmentOptions } from "@/features/clients/types";
import type { Enquiry } from "@/lib/mock-data";
import { UserPlus } from "lucide-react";

type Props = {
  enquiry: Enquiry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

const EMPTY_OPTIONS: ClientAssignmentOptions = { owners: [], teams: [], packages: [] };

export function ConvertToClientDialog({ enquiry, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [options, setOptions] = useState<ClientAssignmentOptions>(EMPTY_OPTIONS);
  const [companyName, setCompanyName] = useState("");
  const [crNumber, setCrNumber] = useState("");
  const [brNumber, setBrNumber] = useState("");
  const [incorporationDate, setIncorporationDate] = useState("");
  const [basisDate, setBasisDate] = useState("");
  const [registeredOffice, setRegisteredOffice] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    listClientAssignmentOptions()
      .then((loaded) => {
        if (cancelled) return;
        setOptions(loaded);
        setOwnerId((current) => current || loaded.owners[0]?.id || "");
        setTeamId((current) => current || loaded.teams[0]?.id || "");
        setPackageId((current) => current || loaded.packages[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) toast.error("Unable to load owners and packages.");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !enquiry) return;

    setCompanyName(`${enquiry.contactName.split(" ")[0]} Company Ltd`);
    setCrNumber("");
    setBrNumber("");
    setIncorporationDate("");
    setBasisDate("");
    setRegisteredOffice("");
    setFieldError(null);
  }, [open, enquiry]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!enquiry) return;

    setFieldError(null);
    setSaving(true);

    try {
      const created = await createClient({
        data: {
          companyName,
          crNumber,
          brNumber,
          incorporationDate,
          annualReturnBasisDate: basisDate,
          registeredOffice,
          companySecretary: "Kossilon Secretaries Ltd",
          ownerId,
          teamId,
          packageId: packageId || null,
          contacts: [
            {
              name: enquiry.contactName,
              role: "Primary contact",
              email: null,
              phone: enquiry.phone,
              isPrimary: true,
            },
          ],
        },
      });

      toast.success(`${companyName} added to the register.`);
      onOpenChange(false);
      await navigate({ to: "/clients/$id", params: { id: created.id } });
    } catch (error) {
      const field = (error as { field?: string }).field;
      const message = error instanceof Error ? error.message : "Unable to convert the enquiry.";

      if (field) {
        setFieldError({ field, message });
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" /> Convert enquiry to client
          </DialogTitle>
          <DialogDescription>
            {enquiry
              ? `Creates a company record from the enquiry with ${enquiry.contactName} (${enquiry.phone}).`
              : "Select an enquiry to convert."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="convert-name">
              Company name
            </label>
            <input
              id="convert-name"
              className={inputClass}
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="convert-cr">
                CR number
              </label>
              <input
                id="convert-cr"
                className={inputClass}
                value={crNumber}
                onChange={(event) => setCrNumber(event.target.value)}
                required
              />
              {fieldError?.field === "crNumber" && (
                <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-br">
                BR number
              </label>
              <input
                id="convert-br"
                className={inputClass}
                value={brNumber}
                onChange={(event) => setBrNumber(event.target.value)}
                required
              />
              {fieldError?.field === "brNumber" && (
                <p className="mt-1 text-xs text-destructive">{fieldError.message}</p>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-incorporated">
                Incorporation date
              </label>
              <input
                id="convert-incorporated"
                type="date"
                className={inputClass}
                value={incorporationDate}
                onChange={(event) => setIncorporationDate(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-basis">
                Annual return basis date
              </label>
              <input
                id="convert-basis"
                type="date"
                className={inputClass}
                value={basisDate}
                onChange={(event) => setBasisDate(event.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="convert-office">
              Registered office
            </label>
            <input
              id="convert-office"
              className={inputClass}
              value={registeredOffice}
              onChange={(event) => setRegisteredOffice(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="convert-owner">
                Owner
              </label>
              <select
                id="convert-owner"
                className={inputClass}
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                {options.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-team">
                Team
              </label>
              <select
                id="convert-team"
                className={inputClass}
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
              >
                {options.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="convert-package">
                Package
              </label>
              <select
                id="convert-package"
                className={inputClass}
                value={packageId}
                onChange={(event) => setPackageId(event.target.value)}
              >
                {options.packages.map((servicePackage) => (
                  <option key={servicePackage.id} value={servicePackage.id}>
                    {servicePackage.name} — HKD {servicePackage.defaultFee.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
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
              disabled={saving || !enquiry}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Converting…" : "Convert to client"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Update the enquiries route**

In `src/routes/enquiries.tsx`, make four edits.

**1.** Delete this import line:

```tsx
import { useEnquiryConversion } from "@/lib/clients-store";
```

**2.** Delete this line from the component body:

```tsx
  const convertedClientId = useEnquiryConversion(active.id);
```

**3.** Replace this block:

```tsx
              {convertedClientId ? (
                <Link
                  to="/clients/$id"
                  params={{ id: convertedClientId }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-status-green/30 bg-status-green-soft px-3 py-1.5 text-xs font-medium text-foreground hover:bg-status-green-soft/80"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-status-green" /> View client →
                </Link>
              ) : (
                <button
                  onClick={() => setConvertOpen(true)}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  <span className="inline-flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Convert to client</span>
                </button>
              )}
```

with:

```tsx
              <button
                onClick={() => setConvertOpen(true)}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <span className="inline-flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Convert to client</span>
              </button>
```

**4.** Drop the `onConverted` prop from the dialog usage, leaving:

```tsx
      <ConvertToClientDialog
        enquiry={convertOpen ? active : null}
        open={convertOpen}
        onOpenChange={setConvertOpen}
      />
```

That removes the only uses of `CheckCircle2` and, if nothing else on the page uses it, `Link`. Delete whichever imports `npm run lint` reports as unused — do not guess at them.

- [ ] **Step 3: Delete the mock store**

```bash
git rm src/lib/clients-store.ts
```

- [ ] **Step 4: Verify nothing still imports it**

Run: `grep -rn "clients-store" src`
Expected: no output.

- [ ] **Step 5: Verify the build is clean**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all pass.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: convert enquiries into real client records"
```

---

### Task 13: Manual Verification

**Files:** none.

Requires `DATABASE_URL` pointing at a database with migrations `0001` through `0006` applied and `npm run db:seed` run.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Work through the checklist**

Confirm each, and report any that fail rather than marking the task complete:

- [ ] `/clients` lists the seeded companies with package, AR deadline, payment status, and owner.
- [ ] Typing in the search box narrows by company name, CR, BR, and owner name.
- [ ] The package, team, and status dropdowns each filter the table.
- [ ] "Add client" creates a company that appears in the directory.
- [ ] A duplicate CR number shows an inline field error, not a crash or a toast.
- [ ] `/clients/$id` shows contacts, timeline, annual return history, documents, and payment.
- [ ] Adding a contact, promoting it to primary, and removing it each update the page without a reload.
- [ ] Promoting a second contact to primary demotes the first.
- [ ] Editing owner, team, or package writes a visible "Updated …" timeline entry.
- [ ] Setting a company to Inactive removes it from the default Active filter.
- [ ] An unknown client id renders the not-found state, not a blank page.
- [ ] Converting an enquiry from `/enquiries` lands on a real client profile.
- [ ] `/annual-returns` and `/` still load correctly.

- [ ] **Step 3: Commit any fixes**

If any check fails, fix it, re-run `npm run test` and `npx tsc --noEmit`, and commit with a `fix:` message.

---

## Notes for the Implementer

- **Do not add a delete-client operation.** `annual_return_cases`, `documents`, `payments`, and `timeline_events` all cascade on `company_id`; deleting a company would destroy its statutory filing history. Deactivation is the intended path.
- **`src/lib/mock-data.ts` stays.** `enquiries`, `tasks`, `teamMembers`, `formatDate`, and `formatDateTime` still serve other routes. Only the client paths stop importing `companies` from it.
- **The `Timeline` component is not reused** on the client profile — it expects the mock `TimelineEvent` shape with a `kind` discriminator that `timeline_events` rows do not carry.
- **Repository tests need `TEST_DATABASE_URL`.** Without it they silently skip, and Tasks 5 to 7 prove nothing. Set it before starting those tasks.
