# Checklist Templates Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give checklist templates a real, persisted, Admin-only production implementation (new
`checklist_templates` table + repository + server fns), and make demo mode's template editor
read-only like every other demo screen — closing the one exception ADR-0001 names by number.

**Architecture:** A new vertical-slice module `src/features/checklist-templates/` (`types.ts`,
`repository.ts`, `server-fns.ts`) following this codebase's established convention. One JSONB-array-
per-row table (mirroring `sla_policies.escalation_targets`), one patch-based update endpoint (not
thirteen). `src/lib/templates.ts` (the demo fixture) is trimmed to reads only, importing its types
from the new module instead of redeclaring them. `settings.tsx` branches on `dataMode`: demo reads
the static fixture with no mutating controls, production reads/writes through the new server fns.

**Tech Stack:** TypeScript strict, Vitest, TanStack Start server functions, TanStack Query,
Postgres via `postgres.js` (raw SQL, JSONB columns via `sql.json(...)`), React 19.

---

## Context you need before task 1

**Source of truth:** `docs/superpowers/specs/2026-08-18-checklist-templates-persistence-design.md`
— read it for full reasoning. This plan reproduces everything needed to implement it.

**Work on branch `codex/checklist-templates-persistence`** (already created off `main`, already has
the design spec committed).

**The `*ForActor` convention**, used throughout this codebase: a `createServerFn` thin-wraps a
separately-exported, unit-testable `xForActor(actor, input, dependencies)` function containing the
actual authorization and business logic. `documents/server-fns.ts`'s `cleanupExpiredUploads` /
`withDefaultDocumentContext` pair is the closest precedent this plan mirrors — same
dynamic-import-then-`try/finally`-close shape, same "staff actor resolved, then narrowed to Admin"
two-step authorization your new `assertAdminAccess` will perform.

**`assertAdminAccess`** already exists once in this codebase, added in the P0-8 fix
(`src/features/notifications/runtime-dispatch.ts:83-86`):
```typescript
export function assertAdminAccess(actor: AuthenticatedActor): void {
  if (!actor.active || actor.role !== "Admin") throw new Error("Forbidden: Admin access is required.");
}
```
This plan defines a **second, local copy** of this exact function inside the new module rather than
extracting a shared helper into `src/features/auth/authorization.ts`. That's a deliberate, narrow
choice: extracting shared auth infrastructure was not part of the approved design spec, and this
codebase already has one precedent of near-identical logic living locally per-module
(`cleanupExpiredUploads`'s inline check in `documents/server-fns.ts` is a third variant of the same
idea). Do not deduplicate across files as part of this plan.

**JSONB columns**: this codebase writes JS values into `jsonb` columns via `sql.json(value)`
(`src/features/whatsapp/repository.ts:1065`) and reads them back with no manual parsing — postgres.js
auto-deserializes `jsonb` on `SELECT` (`src/features/work-items/repository.ts:345`,
`weeklySchedule: policy.weekly_schedule` used directly, no `JSON.parse`).

**Partial updates**: this codebase's convention for an optional patch field is
`coalesce(${newValue ?? null}, existing_column)` — if the caller didn't supply a value, `??` yields
`null`, and `coalesce` falls back to the existing column, leaving it unchanged. This correctly
handles `false` and `""` as legitimate new values (they are not `null`/`undefined`, so `??` does not
touch them) — see `src/features/whatsapp/repository.ts:541-543` for the same idiom (though used
there for "claim once" semantics rather than optional-patch semantics; the SQL shape is identical).

**Migration numbering**: the next free number is `0013` — `0012` was taken by
`annual_return_reminder_events`, merged to `main` after this branch was first planned. Every new
migration also updates `src/server/db/schema.sql` in the same commit (see `c30f8da` for the most
recent precedent of this).

All paths below are relative to the repo root.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `db/migrations/0013_checklist_templates.sql` | Create | New table + seed of the five current demo templates |
| `src/server/db/schema.sql` | Modify | Add the same table definition, kept in sync with the migration |
| `src/features/checklist-templates/types.ts` | Create | Canonical `ChecklistTemplate`/`DocumentItem`/`ReminderRule`/`RiskRule`/`ServiceType` types |
| `src/features/checklist-templates/repository.ts` | Create | `ChecklistTemplateRepository` — tagged-template SQL against `checklist_templates` |
| `src/features/checklist-templates/repository.test.ts` | Create | DB-integration tests, `describe.skipIf(!databaseUrl)` |
| `src/features/checklist-templates/server-fns.ts` | Create | `assertAdminAccess` + `*ForActor` functions + `createServerFn` wrappers |
| `src/features/checklist-templates/server-fns.test.ts` | Create | Mocked-repository unit tests |
| `src/lib/templates.ts` | Modify | Trimmed to a read-only fixture importing shared types; all 13 mutation methods deleted |
| `src/routes/-settings-sections.ts` | Modify | `checklistTemplates` becomes `true` unconditionally |
| `src/routes/-settings-sections.test.ts` | Modify | Update the two assertions that currently expect `checklistTemplates: false`/`true` split by mode |
| `src/routes/settings.tsx` | Modify | Template section branches on `dataMode`: read-only demo view, query/mutation-backed production view |
| `src/routes/-final-review-restorations.test.ts` | Modify | Update the source-text assertions that reference deleted `templatesStore.*` calls |
| `src/routes/-settings-templates.test.tsx` | Create | Route-level test: demo shows read-only rows, production Admin sees working controls |

---

## Task 1: Migration + schema

**Files:**
- Create: `db/migrations/0013_checklist_templates.sql`
- Modify: `src/server/db/schema.sql`

### Step 1: Read the current demo fixture data

Read `src/lib/templates.ts` in full (352 lines) — you need the exact five `initialTemplates` entries
(`tpl-ar-private`, `tpl-ar-public`, `tpl-incorp`, `tpl-cod`, `tpl-dereg`) to seed real rows with
equivalent data. Read `db/migrations/0008_client_register.sql` for the seeding precedent this task
mirrors (`insert ... on conflict (name) do nothing`).

### Step 2: Write the migration

Create `db/migrations/0013_checklist_templates.sql`:

```sql
create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  service_type text not null check (service_type in (
    'Annual Return — Private Ltd', 'Annual Return — Public Ltd',
    'Incorporation — HK Ltd', 'Change of Director', 'Deregistration'
  )),
  description text not null default '',
  active boolean not null default true,
  documents jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '[]'::jsonb,
  risk_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_templates_service_type_idx on checklist_templates (service_type) where active;

insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
values
  (
    'Annual return — Private Ltd',
    'Annual Return — Private Ltd',
    'Standard checklist for a Hong Kong private limited company annual return (NAR1).',
    true,
    '[
      {"id": "doc-ar-priv-1", "label": "Signed NAR1 form", "required": true, "daysBeforeDue": 7},
      {"id": "doc-ar-priv-2", "label": "Register of members (updated)", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-priv-3", "label": "Register of directors", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-priv-4", "label": "Register of secretaries", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-priv-5", "label": "Business registration certificate copy", "required": true, "daysBeforeDue": 30},
      {"id": "doc-ar-priv-6", "label": "Proof of registered office address", "required": true, "daysBeforeDue": 30},
      {"id": "doc-ar-priv-7", "label": "ID copies of all directors", "required": true, "daysBeforeDue": 30}
    ]'::jsonb,
    '[
      {"id": "rem-ar-priv-1", "label": "First reminder", "daysBeforeDue": 30, "channel": "WhatsApp"},
      {"id": "rem-ar-priv-2", "label": "Second reminder", "daysBeforeDue": 14, "channel": "WhatsApp"},
      {"id": "rem-ar-priv-3", "label": "Third reminder", "daysBeforeDue": 7, "channel": "WhatsApp"},
      {"id": "rem-ar-priv-4", "label": "Final reminder", "daysBeforeDue": 2, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-ar-priv-1", "label": "Deadline critical", "severity": "High", "trigger": "Deadline < 3 days & docs incomplete", "enabled": true},
      {"id": "risk-ar-priv-2", "label": "Client silent", "severity": "Medium", "trigger": "No client reply after 3 reminders", "enabled": true},
      {"id": "risk-ar-priv-3", "label": "Payment overdue", "severity": "Medium", "trigger": "Invoice unpaid > 14 days", "enabled": true}
    ]'::jsonb
  ),
  (
    'Annual return — Public Ltd',
    'Annual Return — Public Ltd',
    'Public company AR with auditor''s report and additional disclosures.',
    true,
    '[
      {"id": "doc-ar-pub-1", "label": "Signed NAR1 form", "required": true, "daysBeforeDue": 7},
      {"id": "doc-ar-pub-2", "label": "Audited financial statements", "required": true, "daysBeforeDue": 21},
      {"id": "doc-ar-pub-3", "label": "Auditor''s report", "required": true, "daysBeforeDue": 21},
      {"id": "doc-ar-pub-4", "label": "Register of members", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-pub-5", "label": "Register of directors", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-pub-6", "label": "Directors'' report", "required": true, "daysBeforeDue": 14}
    ]'::jsonb,
    '[
      {"id": "rem-ar-pub-1", "label": "First reminder", "daysBeforeDue": 45, "channel": "Email"},
      {"id": "rem-ar-pub-2", "label": "Second reminder", "daysBeforeDue": 21, "channel": "WhatsApp"},
      {"id": "rem-ar-pub-3", "label": "Final reminder", "daysBeforeDue": 7, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-ar-pub-1", "label": "Auditor delay", "severity": "High", "trigger": "Audit report outstanding < 21 days to due", "enabled": true},
      {"id": "risk-ar-pub-2", "label": "Deadline critical", "severity": "High", "trigger": "Deadline < 3 days & docs incomplete", "enabled": true}
    ]'::jsonb
  ),
  (
    'Incorporation — HK Ltd',
    'Incorporation — HK Ltd',
    'New Hong Kong private limited company incorporation.',
    true,
    '[
      {"id": "doc-incorp-1", "label": "NNC1 incorporation form", "required": true, "daysBeforeDue": 3},
      {"id": "doc-incorp-2", "label": "Articles of association", "required": true, "daysBeforeDue": 3},
      {"id": "doc-incorp-3", "label": "IRBR1 business registration notice", "required": true, "daysBeforeDue": 3},
      {"id": "doc-incorp-4", "label": "ID / passport of each director & shareholder", "required": true, "daysBeforeDue": 5},
      {"id": "doc-incorp-5", "label": "Proof of address for each director", "required": true, "daysBeforeDue": 5}
    ]'::jsonb,
    '[
      {"id": "rem-incorp-1", "label": "Docs kick-off", "daysBeforeDue": 7, "channel": "WhatsApp"},
      {"id": "rem-incorp-2", "label": "Signature reminder", "daysBeforeDue": 2, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-incorp-1", "label": "KYC incomplete", "severity": "High", "trigger": "Missing director ID > 3 days", "enabled": true}
    ]'::jsonb
  ),
  (
    'Change of director',
    'Change of Director',
    'Appointment or resignation of a company director (ND2A / ND2B).',
    true,
    '[
      {"id": "doc-cod-1", "label": "ND2A / ND2B form", "required": true, "daysBeforeDue": 5},
      {"id": "doc-cod-2", "label": "Board resolution", "required": true, "daysBeforeDue": 5},
      {"id": "doc-cod-3", "label": "Consent to act as director", "required": true, "daysBeforeDue": 5},
      {"id": "doc-cod-4", "label": "New director ID copy", "required": true, "daysBeforeDue": 5}
    ]'::jsonb,
    '[
      {"id": "rem-cod-1", "label": "Docs reminder", "daysBeforeDue": 7, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-cod-1", "label": "Statutory 15-day window", "severity": "High", "trigger": "Filing not submitted within 15 days of change", "enabled": true}
    ]'::jsonb
  ),
  (
    'Deregistration',
    'Deregistration',
    'Voluntary deregistration of a defunct solvent company (DR1).',
    false,
    '[
      {"id": "doc-dereg-1", "label": "DR1 deregistration form", "required": true, "daysBeforeDue": 14},
      {"id": "doc-dereg-2", "label": "IRD notice of no objection", "required": true, "daysBeforeDue": 30},
      {"id": "doc-dereg-3", "label": "Written consent from all directors", "required": true, "daysBeforeDue": 14}
    ]'::jsonb,
    '[
      {"id": "rem-dereg-1", "label": "IRD follow-up", "daysBeforeDue": 21, "channel": "Email"}
    ]'::jsonb,
    '[
      {"id": "risk-dereg-1", "label": "Outstanding tax", "severity": "High", "trigger": "IRD clearance not received", "enabled": true}
    ]'::jsonb
  )
on conflict (name) do nothing;
```

### Step 2: Mirror the table into schema.sql

Add the identical `create table if not exists checklist_templates (...)` block **and** the
`checklist_templates_service_type_idx` index (without the `insert`) to `src/server/db/schema.sql`,
near the other standalone/config tables (e.g. next to `sla_policies`/`business_calendars`). Both
must come from the migration itself, not be introduced here for the first time — `schema.sql` is a
reference document only (it says so at its own top, and only `db/migrations` is ever applied; see
`schema.sql`'s "Reconciled with db/migrations/" banner for the prior incident this exact mistake
would repeat, in mirror image: a table/index that exists in `schema.sql` but that no migration ever
creates is a real database drift, not a documentation nicety). The index is the lookup shape a
future `templateForService`-equivalent will use, matching this schema's existing convention of
indexing the columns things actually filter on.

### Step 3: Apply the migration locally and verify

Run: `npm run db:migrate` (requires a local `DATABASE_URL` — do not run against any non-local
database without explicit approval, per this repo's `CLAUDE.md`).
Expected: migration applies cleanly, `checklist_templates` has 5 rows, and
`checklist_templates_service_type_idx` exists (confirm with `\d checklist_templates` or a query
against `pg_indexes` — the index must come from the migration itself, not only from `schema.sql`).

### Step 4: Commit

```bash
git add db/migrations/0013_checklist_templates.sql src/server/db/schema.sql
git commit -m "feat(checklist-templates): add checklist_templates table"
```

---

## Task 2: Shared types module

**Files:**
- Create: `src/features/checklist-templates/types.ts`

### Step 1: Write the types

```typescript
export const SERVICE_TYPES = [
  "Annual Return — Private Ltd",
  "Annual Return — Public Ltd",
  "Incorporation — HK Ltd",
  "Change of Director",
  "Deregistration",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export type DocumentItem = {
  id: string;
  label: string;
  required: boolean;
  daysBeforeDue: number;
  note?: string;
};

export type ReminderRule = {
  id: string;
  label: string;
  daysBeforeDue: number;
  channel: "WhatsApp" | "Email" | "SMS";
};

export type RiskRule = {
  id: string;
  label: string;
  severity: "Low" | "Medium" | "High";
  trigger: string;
  enabled: boolean;
};

export type ChecklistTemplate = {
  id: string;
  name: string;
  serviceType: ServiceType;
  description: string;
  active: boolean;
  documents: DocumentItem[];
  reminders: ReminderRule[];
  riskRules: RiskRule[];
  updatedAt: string;
};

export type ChecklistTemplatePatch = Partial<
  Pick<
    ChecklistTemplate,
    "name" | "serviceType" | "description" | "active" | "documents" | "reminders" | "riskRules"
  >
>;
```

This is the exact shape `src/lib/templates.ts` already declares today — copied here as the single
canonical source. Task 5 deletes the duplicate declarations from `templates.ts` and imports these
instead.

### Step 2: Commit

```bash
git add src/features/checklist-templates/types.ts
git commit -m "feat(checklist-templates): add shared types module"
```

---

## Task 3: Repository

**Files:**
- Create: `src/features/checklist-templates/repository.ts`
- Create: `src/features/checklist-templates/repository.test.ts`
- Create: `src/features/checklist-templates/errors.ts`

### Step 1: Write the failing tests

Read `src/features/documents/repository.ts` lines 1-60 and 217-240 first (the `createDocumentRepository`
factory-with-injectable-client pattern this task mirrors), and read
`src/features/annual-return/repository.test.ts` lines 1-90 (the `TEST_DATABASE_URL` /
`createSqlClient` / `describe.skipIf` harness this task's tests mirror).

Create `src/features/checklist-templates/repository.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createChecklistTemplateRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

let testSql: SqlClient | undefined;

async function cleanup() {
  if (!testSql) return;
  // 'Untitled template' is createTemplate's hardcoded default name (name is unique), so a test
  // that creates a template without renaming it must still be cleaned up between runs.
  await testSql`delete from checklist_templates where name like 'Test template%' or name = 'Untitled template'`;
}

afterAll(async () => {
  await testSql?.end();
});

describe.skipIf(!databaseUrl)("checklist template repository", () => {
  beforeEach(async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for this suite.");
    testSql ??= createSqlClient(databaseUrl, { max: 1 });
    await cleanup();
  });

  it("creates a template with empty lists and reads it back", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });

    const created = await repository.createTemplate("Annual Return — Private Ltd");
    const all = await repository.listTemplates();
    const found = all.find((t) => t.id === created.id);

    expect(found).toMatchObject({
      name: "Untitled template",
      documents: [],
      reminders: [],
      riskRules: [],
    });

    await repository.close();
  });

  it("round-trips documents/reminders/riskRules through jsonb without losing shape", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    const updated = await repository.updateTemplate(created.id, {
      name: "Test template round-trip",
      documents: [{ id: "d1", label: "Doc one", required: true, daysBeforeDue: 5 }],
      reminders: [{ id: "r1", label: "Rem one", daysBeforeDue: 10, channel: "Email" }],
      riskRules: [{ id: "k1", label: "Risk one", severity: "High", trigger: "x", enabled: true }],
    });

    expect(updated?.documents).toEqual([
      { id: "d1", label: "Doc one", required: true, daysBeforeDue: 5 },
    ]);
    expect(updated?.reminders).toEqual([
      { id: "r1", label: "Rem one", daysBeforeDue: 10, channel: "Email" },
    ]);
    expect(updated?.riskRules).toEqual([
      { id: "k1", label: "Risk one", severity: "High", trigger: "x", enabled: true },
    ]);

    await repository.close();
  });

  it("leaves unpatched fields untouched", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    const updated = await repository.updateTemplate(created.id, { active: false });

    expect(updated?.name).toBe("Untitled template");
    expect(updated?.active).toBe(false);

    await repository.close();
  });

  it("duplicates a template with fresh item ids", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");
    await repository.updateTemplate(created.id, {
      name: "Test template dup-source",
      documents: [{ id: "orig-1", label: "Doc", required: true, daysBeforeDue: 1 }],
    });

    const duplicated = await repository.duplicateTemplate(created.id);

    expect(duplicated?.name).toBe("Test template dup-source (copy)");
    expect(duplicated?.documents[0]?.id).not.toBe("orig-1");
    expect(duplicated?.documents[0]?.label).toBe("Doc");

    await repository.close();
  });

  it("deletes a template", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    await repository.deleteTemplate(created.id);
    const all = await repository.listTemplates();

    expect(all.find((t) => t.id === created.id)).toBeUndefined();

    await repository.close();
  });

  it("returns updatedAt as a string, not a Date object", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");

    expect(typeof created.updatedAt).toBe("string");
    expect(() => new Date(created.updatedAt).toISOString()).not.toThrow();

    await repository.close();
  });
});
```

The five `createTemplate` calls above that don't care about the created row's `name`/`serviceType`
all use the valid literal `"Annual Return — Private Ltd"` rather than an arbitrary string — the
`service_type` column is check-constrained to the 5 real `ServiceType` values (Task 1's migration),
so an invalid string fails at the database, not just the type system; a `some string as never` cast
would compile but throw at runtime against a real database. `cleanup()` also deletes rows named
`'Untitled template'` (`createTemplate`'s hardcoded default), not just `'Test template%'` ones, since
tests 1/3/4/6 below never rename the row they create and `name` is `unique` — without this a second
run would fail on a leftover row from the first, not the assertion under test. The 6th test
(`"returns updatedAt as a string, not a Date object"`) exists because `postgres.js` returns real
`Date` objects for `timestamptz` columns by default; `mapTemplate`'s `iso()` conversion (Step 2
below) is what makes this pass — omitting it would return a `Date`, silently violating
`ChecklistTemplate.updatedAt: string`'s contract with no type error anywhere, since nothing in this
file's own types would catch a repository lying about its return type at runtime.

Run: `TEST_DATABASE_URL=<local test db> npm run test -- src/features/checklist-templates/repository.test.ts`
Expected: FAIL — `./repository` does not exist yet.

### Step 2: Implement the repository

Create `src/features/checklist-templates/repository.ts`:

```typescript
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import type {
  ChecklistTemplate,
  ChecklistTemplatePatch,
  DocumentItem,
  ReminderRule,
  RiskRule,
  ServiceType,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;

type TemplateRow = {
  id: string;
  name: string;
  service_type: ServiceType;
  description: string;
  active: boolean;
  documents: DocumentItem[];
  reminders: ReminderRule[];
  risk_rules: RiskRule[];
  updated_at: string | Date;
};

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function mapTemplate(row: TemplateRow): ChecklistTemplate {
  return {
    id: row.id,
    name: row.name,
    serviceType: row.service_type,
    description: row.description,
    active: row.active,
    documents: row.documents,
    reminders: row.reminders,
    riskRules: row.risk_rules,
    updatedAt: iso(row.updated_at),
  };
}

export type ChecklistTemplateRepository = {
  listTemplates(): Promise<ChecklistTemplate[]>;
  createTemplate(serviceType: ServiceType): Promise<ChecklistTemplate>;
  updateTemplate(id: string, patch: ChecklistTemplatePatch): Promise<ChecklistTemplate | null>;
  duplicateTemplate(id: string): Promise<ChecklistTemplate | null>;
  deleteTemplate(id: string): Promise<void>;
  close(): Promise<void>;
};

export function createChecklistTemplateRepository(
  options?: CreateSqlClientOptions & { sql?: QueryClient },
): ChecklistTemplateRepository;
export function createChecklistTemplateRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): ChecklistTemplateRepository;
export function createChecklistTemplateRepository(
  databaseUrlOrOptions: string | (CreateSqlClientOptions & { sql?: QueryClient }) = {},
  maybeOptions: CreateSqlClientOptions = {},
): ChecklistTemplateRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    async listTemplates() {
      const rows = await sql<TemplateRow[]>`
        select * from checklist_templates order by created_at asc
      `;
      return rows.map(mapTemplate);
    },

    async createTemplate(serviceType) {
      const rows = await sql<TemplateRow[]>`
        insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
        values ('Untitled template', ${serviceType}, '', true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
        returning *
      `;
      return mapTemplate(rows[0]!);
    },

    async updateTemplate(id, patch) {
      const rows = await sql<TemplateRow[]>`
        update checklist_templates
        set
          name = coalesce(${patch.name ?? null}, name),
          service_type = coalesce(${patch.serviceType ?? null}, service_type),
          description = coalesce(${patch.description ?? null}, description),
          active = coalesce(${patch.active ?? null}, active),
          documents = coalesce(${patch.documents ? sql.json(patch.documents) : null}, documents),
          reminders = coalesce(${patch.reminders ? sql.json(patch.reminders) : null}, reminders),
          risk_rules = coalesce(${patch.riskRules ? sql.json(patch.riskRules) : null}, risk_rules),
          updated_at = now()
        where id = ${id}
        returning *
      `;
      return rows[0] ? mapTemplate(rows[0]) : null;
    },

    async duplicateTemplate(id) {
      const source = await sql<TemplateRow[]>`select * from checklist_templates where id = ${id}`;
      const template = source[0];
      if (!template) return null;

      const freshen = <T extends { id: string }>(items: T[]) =>
        items.map((item) => ({ ...item, id: crypto.randomUUID() }));

      const rows = await sql<TemplateRow[]>`
        insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
        values (
          ${`${template.name} (copy)`},
          ${template.service_type},
          ${template.description},
          ${template.active},
          ${sql.json(freshen(template.documents))},
          ${sql.json(freshen(template.reminders))},
          ${sql.json(freshen(template.risk_rules))}
        )
        returning *
      `;
      return mapTemplate(rows[0]!);
    },

    async deleteTemplate(id) {
      await sql`delete from checklist_templates where id = ${id}`;
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
```

### Step 3: Translate unique-name constraint violations into a friendly error

`createTemplate` always inserts the hardcoded name `'Untitled template'`, and `duplicateTemplate`
always inserts `"${source.name} (copy)"` — both write to `name`, which is `unique` (Task 1's
migration). An Admin clicking "New template" twice, or "Duplicate" the same template twice, without
renaming in between, hits that constraint. Without translation, the raw Postgres error
(`PostgresError code=23505 ... duplicate key value violates unique constraint
"checklist_templates_name_key"`) would propagate unhandled all the way to the client. This codebase
already has an established, on-point precedent for exactly this: `src/features/clients/errors.ts`'s
`ClientWriteError`/`rethrowClientWriteError`, used at the repository layer in
`src/features/clients/repository.ts` (every mutating method wraps its write in
`try { ... } catch (error) { rethrowClientWriteError(error); }`).

Read `src/features/clients/errors.ts` in full (67 lines) — it's short and exactly the shape to
mirror. Create `src/features/checklist-templates/errors.ts`:

```typescript
export type ChecklistTemplateWriteField = "name";

/** A database constraint violation translated into a message for a specific form field. */
export class ChecklistTemplateWriteError extends Error {
  readonly field: ChecklistTemplateWriteField;

  constructor(field: ChecklistTemplateWriteField, message: string) {
    super(message);
    this.name = "ChecklistTemplateWriteError";
    this.field = field;
  }
}

const CONSTRAINT_FIELDS: Record<string, { field: ChecklistTemplateWriteField; message: string }> = {
  checklist_templates_name_key: {
    field: "name",
    message: "A checklist template with this name already exists.",
  },
};

const HANDLED_CODES = new Set(["23505"]);

export function toChecklistTemplateWriteError(error: unknown): ChecklistTemplateWriteError | null {
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

  return new ChecklistTemplateWriteError(mapping.field, mapping.message);
}

/** Rethrows a recognised constraint violation as a ChecklistTemplateWriteError, otherwise rethrows as-is. */
export function rethrowChecklistTemplateWriteError(error: unknown): never {
  const mapped = toChecklistTemplateWriteError(error);

  if (mapped) {
    throw mapped;
  }

  throw error;
}
```

In `repository.ts`, import `rethrowChecklistTemplateWriteError` from `./errors`, and wrap the SQL
statement inside `createTemplate`, `updateTemplate`, and `duplicateTemplate` (its `insert` half only,
not the `select`) in `try { ... } catch (error) { rethrowChecklistTemplateWriteError(error); }` —
`updateTemplate` carries the identical risk (an Admin renaming a template to an existing name) even
though it wasn't the case that surfaced this gap first.

Add two tests to `repository.test.ts`, in the same `describe` block:

```typescript
  it("translates a duplicate name into a friendly ChecklistTemplateWriteError", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    await repository.createTemplate("Annual Return — Private Ltd");

    await expect(repository.createTemplate("Annual Return — Private Ltd")).rejects.toMatchObject({
      name: "ChecklistTemplateWriteError",
      field: "name",
      message: "A checklist template with this name already exists.",
    });
  });

  it("translates a duplicate-of-a-duplicate name the same way", async () => {
    const repository = createChecklistTemplateRepository({ sql: testSql! });
    const created = await repository.createTemplate("Annual Return — Private Ltd");
    await repository.duplicateTemplate(created.id);

    await expect(repository.duplicateTemplate(created.id)).rejects.toMatchObject({
      name: "ChecklistTemplateWriteError",
      field: "name",
    });
  });
```

### Step 4: Run the tests

Run: `TEST_DATABASE_URL=<local test db> npm run test -- src/features/checklist-templates/repository.test.ts`
Expected: PASS, all 8 cases.

### Step 5: Verify

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run lint` — expect clean, exit code checked directly.

### Step 6: Commit

```bash
git add src/features/checklist-templates/repository.ts src/features/checklist-templates/repository.test.ts src/features/checklist-templates/errors.ts
git commit -m "feat(checklist-templates): add repository"
```

---

## Task 4: Server functions

**Files:**
- Create: `src/features/checklist-templates/server-fns.ts`
- Create: `src/features/checklist-templates/server-fns.test.ts`

### Step 1: Write the failing tests

Read `src/features/documents/server-fns.ts` lines 1-93 first (the `loadDefaultDocumentContext` /
`withDefaultDocumentContext` pattern this task's context loader mirrors), and read
`src/features/notifications/runtime-dispatch.test.ts`'s `dispatchDueNotificationsForActor` tests
(the `assertAdminAccess`-rejection test shape this task's tests mirror).

Create `src/features/checklist-templates/server-fns.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ChecklistTemplate } from "./types";
import {
  assertAdminAccess,
  createChecklistTemplateForActor,
  deleteChecklistTemplateForActor,
  duplicateChecklistTemplateForActor,
  listChecklistTemplatesForActor,
  updateChecklistTemplateForActor,
} from "./server-fns";

const adminActor: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Admin",
  teamId: null,
  active: true,
};
const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: "20000000-0000-0000-0000-000000000002",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};

const sampleTemplate: ChecklistTemplate = {
  id: "tpl-1",
  name: "Sample",
  serviceType: "Annual Return — Private Ltd",
  description: "",
  active: true,
  documents: [],
  reminders: [],
  riskRules: [],
  updatedAt: "2026-08-18T00:00:00.000Z",
};

function repositoryFor(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const repository = {
    listTemplates: vi.fn(async () => [sampleTemplate]),
    createTemplate: vi.fn(async () => sampleTemplate),
    updateTemplate: vi.fn(async () => sampleTemplate),
    duplicateTemplate: vi.fn(async () => sampleTemplate),
    deleteTemplate: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
  return { repository };
}

describe("assertAdminAccess", () => {
  it("rejects a non-admin actor", () => {
    expect(() => assertAdminAccess(staffActor)).toThrow("Forbidden: Admin access is required.");
  });

  it("rejects an inactive admin actor", () => {
    expect(() => assertAdminAccess({ ...adminActor, active: false })).toThrow(
      "Forbidden: Admin access is required.",
    );
  });

  it("allows an active admin actor", () => {
    expect(() => assertAdminAccess(adminActor)).not.toThrow();
  });
});

describe("listChecklistTemplatesForActor", () => {
  it("rejects a non-admin actor without calling the repository", async () => {
    const { repository } = repositoryFor();

    await expect(listChecklistTemplatesForActor(staffActor, {}, { repository })).rejects.toThrow(
      "Forbidden: Admin access is required.",
    );
    expect(repository.listTemplates).not.toHaveBeenCalled();
  });

  it("returns the repository's list for an admin actor", async () => {
    const { repository } = repositoryFor();

    const result = await listChecklistTemplatesForActor(adminActor, {}, { repository });

    expect(result).toEqual([sampleTemplate]);
  });
});

describe("createChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      createChecklistTemplateForActor(
        staffActor,
        { serviceType: "Annual Return — Private Ltd" },
        { repository },
      ),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.createTemplate).not.toHaveBeenCalled();
  });

  it("creates via the repository for an admin actor", async () => {
    const { repository } = repositoryFor();

    await createChecklistTemplateForActor(
      adminActor,
      { serviceType: "Annual Return — Private Ltd" },
      { repository },
    );

    expect(repository.createTemplate).toHaveBeenCalledWith("Annual Return — Private Ltd");
  });
});

describe("updateChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      updateChecklistTemplateForActor(
        staffActor,
        { id: "tpl-1", patch: { active: false } },
        { repository },
      ),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.updateTemplate).not.toHaveBeenCalled();
  });

  it("passes the patch straight through for an admin actor", async () => {
    const { repository } = repositoryFor();

    await updateChecklistTemplateForActor(
      adminActor,
      { id: "tpl-1", patch: { active: false } },
      { repository },
    );

    expect(repository.updateTemplate).toHaveBeenCalledWith("tpl-1", { active: false });
  });

  it("throws when the template does not exist", async () => {
    const { repository } = repositoryFor({ updateTemplate: vi.fn(async () => null) });

    await expect(
      updateChecklistTemplateForActor(
        adminActor,
        { id: "missing", patch: { active: false } },
        { repository },
      ),
    ).rejects.toThrow("Checklist template not found.");
  });
});

describe("duplicateChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      duplicateChecklistTemplateForActor(staffActor, { id: "tpl-1" }, { repository }),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.duplicateTemplate).not.toHaveBeenCalled();
  });
});

describe("deleteChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      deleteChecklistTemplateForActor(staffActor, { id: "tpl-1" }, { repository }),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.deleteTemplate).not.toHaveBeenCalled();
  });

  it("deletes via the repository for an admin actor", async () => {
    const { repository } = repositoryFor();

    await deleteChecklistTemplateForActor(adminActor, { id: "tpl-1" }, { repository });

    expect(repository.deleteTemplate).toHaveBeenCalledWith("tpl-1");
  });
});
```

Run: `npm run test -- src/features/checklist-templates/server-fns.test.ts`
Expected: FAIL — `./server-fns` does not exist yet.

### Step 2: Implement server-fns.ts

Create `src/features/checklist-templates/server-fns.ts`:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ChecklistTemplateRepository } from "./repository";
import { SERVICE_TYPES, type ChecklistTemplatePatch } from "./types";

export function assertAdminAccess(actor: AuthenticatedActor): void {
  if (!actor.active || actor.role !== "Admin") {
    throw new Error("Forbidden: Admin access is required.");
  }
}

export type ChecklistTemplateDependencies = {
  repository: ChecklistTemplateRepository;
};

export async function listChecklistTemplatesForActor(
  actor: AuthenticatedActor,
  _input: Record<string, never>,
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  return dependencies.repository.listTemplates();
}

export async function createChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { serviceType: (typeof SERVICE_TYPES)[number] },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  return dependencies.repository.createTemplate(input.serviceType);
}

export async function updateChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string; patch: ChecklistTemplatePatch },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  const updated = await dependencies.repository.updateTemplate(input.id, input.patch);
  if (!updated) throw new Error("Checklist template not found.");
  return updated;
}

export async function duplicateChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  const duplicated = await dependencies.repository.duplicateTemplate(input.id);
  if (!duplicated) throw new Error("Checklist template not found.");
  return duplicated;
}

export async function deleteChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  await dependencies.repository.deleteTemplate(input.id);
  return { deleted: true };
}

const loadDefaultChecklistTemplateContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createChecklistTemplateRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  const actor = await requireStaffActor(getRequest());
  return {
    actor,
    dependencies: {
      repository: createChecklistTemplateRepository(),
    } satisfies ChecklistTemplateDependencies,
  };
});

async function withDefaultChecklistTemplateContext<T>(
  handler: (actor: AuthenticatedActor, dependencies: ChecklistTemplateDependencies) => Promise<T>,
): Promise<T> {
  const { actor, dependencies } = await loadDefaultChecklistTemplateContext();
  try {
    return await handler(actor, dependencies);
  } finally {
    await dependencies.repository.close();
  }
}

const documentItemSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
    daysBeforeDue: z.number().int().min(0),
    note: z.string().optional(),
  })
  .strict();

const reminderRuleSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    daysBeforeDue: z.number().int().min(0),
    channel: z.enum(["WhatsApp", "Email", "SMS"]),
  })
  .strict();

const riskRuleSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    severity: z.enum(["Low", "Medium", "High"]),
    trigger: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

const serviceTypeSchema = z.enum(SERVICE_TYPES);
// No `as [string, ...string[]]` cast needed: SERVICE_TYPES is a readonly tuple (Task 2's
// `as const`), and Zod 3.24's `z.enum()` accepts a readonly tuple directly. The cast this plan
// originally showed fails `tsc` (TS2352, readonly-to-mutable) against that type.

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    serviceType: serviceTypeSchema.optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
    documents: z.array(documentItemSchema).optional(),
    reminders: z.array(reminderRuleSchema).optional(),
    riskRules: z.array(riskRuleSchema).optional(),
  })
  .strict();

export const listChecklistTemplates = createServerFn({ method: "GET" }).handler(() =>
  withDefaultChecklistTemplateContext((actor, dependencies) =>
    listChecklistTemplatesForActor(actor, {}, dependencies),
  ),
);

export const createChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ serviceType: serviceTypeSchema }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      createChecklistTemplateForActor(
        actor,
        { serviceType: data.serviceType as (typeof SERVICE_TYPES)[number] },
        dependencies,
      ),
    ),
  );

export const updateChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), patch: patchSchema }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      updateChecklistTemplateForActor(
        actor,
        { id: data.id, patch: data.patch as ChecklistTemplatePatch },
        dependencies,
      ),
    ),
  );

export const duplicateChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      duplicateChecklistTemplateForActor(actor, { id: data.id }, dependencies),
    ),
  );

export const deleteChecklistTemplate = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(({ data }) =>
    withDefaultChecklistTemplateContext((actor, dependencies) =>
      deleteChecklistTemplateForActor(actor, { id: data.id }, dependencies),
    ),
  );
```

### Step 3: Run the tests

Run: `npm run test -- src/features/checklist-templates/server-fns.test.ts`
Expected: PASS, all cases.

### Step 4: Verify

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run lint` — expect clean, exit code checked directly.

### Step 5: Commit

```bash
git add src/features/checklist-templates/server-fns.ts src/features/checklist-templates/server-fns.test.ts
git commit -m "feat(checklist-templates): add Admin-gated server functions"
```

---

## Task 5: Trim the demo fixture to read-only

**Files:**
- Modify: `src/lib/templates.ts`

### Step 1: Read the current file and every caller

Read `src/lib/templates.ts` in full (352 lines) and `src/routes/settings.tsx` in full (706 lines,
pre-Task-7-changes) so you know every one of the 23 `templatesStore.*` call sites you're about to
orphan — Task 7 rewires all of them, but this task runs first and will leave `settings.tsx`
temporarily broken (expected — do not try to fix `settings.tsx` in this task).

### Step 2: Rewrite templates.ts

Replace the file's contents with a read-only version: keep the five-entry `initialTemplates` array
(unchanged data) but type it from the shared module, delete every method on `templatesStore` except
none — delete `templatesStore` entirely — and export only reads:

```typescript
// Checklist template fixture for demo mode (read-only — see docs/adr/0001-demo-mode-is-read-only.md).
import { useSyncExternalStore } from "react";
import type { ChecklistTemplate, ServiceType } from "@/features/checklist-templates/types";

export type { ChecklistTemplate, DocumentItem, ReminderRule, RiskRule, ServiceType } from "@/features/checklist-templates/types";
export { SERVICE_TYPES } from "@/features/checklist-templates/types";

const nowIso = () => new Date("2026-07-04T09:00:00+08:00").toISOString();

const initialTemplates: ChecklistTemplate[] = [
  {
    id: "tpl-ar-private",
    name: "Annual return — Private Ltd",
    serviceType: "Annual Return — Private Ltd",
    description: "Standard checklist for a Hong Kong private limited company annual return (NAR1).",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-ar-priv-1", label: "Signed NAR1 form", required: true, daysBeforeDue: 7 },
      { id: "doc-ar-priv-2", label: "Register of members (updated)", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-priv-3", label: "Register of directors", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-priv-4", label: "Register of secretaries", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-priv-5", label: "Business registration certificate copy", required: true, daysBeforeDue: 30 },
      { id: "doc-ar-priv-6", label: "Proof of registered office address", required: true, daysBeforeDue: 30 },
      { id: "doc-ar-priv-7", label: "ID copies of all directors", required: true, daysBeforeDue: 30 },
    ],
    reminders: [
      { id: "rem-ar-priv-1", label: "First reminder", daysBeforeDue: 30, channel: "WhatsApp" },
      { id: "rem-ar-priv-2", label: "Second reminder", daysBeforeDue: 14, channel: "WhatsApp" },
      { id: "rem-ar-priv-3", label: "Third reminder", daysBeforeDue: 7, channel: "WhatsApp" },
      { id: "rem-ar-priv-4", label: "Final reminder", daysBeforeDue: 2, channel: "WhatsApp" },
    ],
    riskRules: [
      { id: "risk-ar-priv-1", label: "Deadline critical", severity: "High", trigger: "Deadline < 3 days & docs incomplete", enabled: true },
      { id: "risk-ar-priv-2", label: "Client silent", severity: "Medium", trigger: "No client reply after 3 reminders", enabled: true },
      { id: "risk-ar-priv-3", label: "Payment overdue", severity: "Medium", trigger: "Invoice unpaid > 14 days", enabled: true },
    ],
  },
  {
    id: "tpl-ar-public",
    name: "Annual return — Public Ltd",
    serviceType: "Annual Return — Public Ltd",
    description: "Public company AR with auditor's report and additional disclosures.",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-ar-pub-1", label: "Signed NAR1 form", required: true, daysBeforeDue: 7 },
      { id: "doc-ar-pub-2", label: "Audited financial statements", required: true, daysBeforeDue: 21 },
      { id: "doc-ar-pub-3", label: "Auditor's report", required: true, daysBeforeDue: 21 },
      { id: "doc-ar-pub-4", label: "Register of members", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-pub-5", label: "Register of directors", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-pub-6", label: "Directors' report", required: true, daysBeforeDue: 14 },
    ],
    reminders: [
      { id: "rem-ar-pub-1", label: "First reminder", daysBeforeDue: 45, channel: "Email" },
      { id: "rem-ar-pub-2", label: "Second reminder", daysBeforeDue: 21, channel: "WhatsApp" },
      { id: "rem-ar-pub-3", label: "Final reminder", daysBeforeDue: 7, channel: "WhatsApp" },
    ],
    riskRules: [
      { id: "risk-ar-pub-1", label: "Auditor delay", severity: "High", trigger: "Audit report outstanding < 21 days to due", enabled: true },
      { id: "risk-ar-pub-2", label: "Deadline critical", severity: "High", trigger: "Deadline < 3 days & docs incomplete", enabled: true },
    ],
  },
  {
    id: "tpl-incorp",
    name: "Incorporation — HK Ltd",
    serviceType: "Incorporation — HK Ltd",
    description: "New Hong Kong private limited company incorporation.",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-incorp-1", label: "NNC1 incorporation form", required: true, daysBeforeDue: 3 },
      { id: "doc-incorp-2", label: "Articles of association", required: true, daysBeforeDue: 3 },
      { id: "doc-incorp-3", label: "IRBR1 business registration notice", required: true, daysBeforeDue: 3 },
      { id: "doc-incorp-4", label: "ID / passport of each director & shareholder", required: true, daysBeforeDue: 5 },
      { id: "doc-incorp-5", label: "Proof of address for each director", required: true, daysBeforeDue: 5 },
    ],
    reminders: [
      { id: "rem-incorp-1", label: "Docs kick-off", daysBeforeDue: 7, channel: "WhatsApp" },
      { id: "rem-incorp-2", label: "Signature reminder", daysBeforeDue: 2, channel: "WhatsApp" },
    ],
    riskRules: [
      { id: "risk-incorp-1", label: "KYC incomplete", severity: "High", trigger: "Missing director ID > 3 days", enabled: true },
    ],
  },
  {
    id: "tpl-cod",
    name: "Change of director",
    serviceType: "Change of Director",
    description: "Appointment or resignation of a company director (ND2A / ND2B).",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-cod-1", label: "ND2A / ND2B form", required: true, daysBeforeDue: 5 },
      { id: "doc-cod-2", label: "Board resolution", required: true, daysBeforeDue: 5 },
      { id: "doc-cod-3", label: "Consent to act as director", required: true, daysBeforeDue: 5 },
      { id: "doc-cod-4", label: "New director ID copy", required: true, daysBeforeDue: 5 },
    ],
    reminders: [{ id: "rem-cod-1", label: "Docs reminder", daysBeforeDue: 7, channel: "WhatsApp" }],
    riskRules: [
      { id: "risk-cod-1", label: "Statutory 15-day window", severity: "High", trigger: "Filing not submitted within 15 days of change", enabled: true },
    ],
  },
  {
    id: "tpl-dereg",
    name: "Deregistration",
    serviceType: "Deregistration",
    description: "Voluntary deregistration of a defunct solvent company (DR1).",
    active: false,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-dereg-1", label: "DR1 deregistration form", required: true, daysBeforeDue: 14 },
      { id: "doc-dereg-2", label: "IRD notice of no objection", required: true, daysBeforeDue: 30 },
      { id: "doc-dereg-3", label: "Written consent from all directors", required: true, daysBeforeDue: 14 },
    ],
    reminders: [{ id: "rem-dereg-1", label: "IRD follow-up", daysBeforeDue: 21, channel: "Email" }],
    riskRules: [
      { id: "risk-dereg-1", label: "Outstanding tax", severity: "High", trigger: "IRD clearance not received", enabled: true },
    ],
  },
];

const state = initialTemplates;

export function useTemplates(): ChecklistTemplate[] {
  return useSyncExternalStore(
    () => () => {},
    () => state,
    () => state,
  );
}

export function templateForService(serviceType: ServiceType): ChecklistTemplate | undefined {
  return state.find((t) => t.active && t.serviceType === serviceType);
}
```

The item-level ids above (`doc-ar-priv-1`, `rem-ar-priv-1`, …) are the same fixed strings
Task 1's migration seed uses for the equivalent production rows — not a functional requirement
(demo and production are independent data sources that are never compared), just a convenience so
anyone reading both files side by side recognizes the same conceptual document/reminder/risk-rule
row. `useTemplates()` keeps its `useSyncExternalStore` shape (a no-op `subscribe` that never fires,
since `state` never changes) rather than becoming a bare constant, so its call sites in
`settings.tsx` don't need to change shape — only its writes disappear.

### Step 3: Verify nothing else breaks yet

Run: `npx tsc --noEmit`
Expected: **type errors in `src/routes/settings.tsx` only** (every reference to the now-deleted
`templatesStore`) — this is expected and fixed in Task 7. Do not attempt to fix `settings.tsx` here.
If `tsc` reports errors in any file other than `settings.tsx`, stop and investigate before
continuing — that would mean something unexpected imports the deleted API.

Separately, run `npm run test -- src/routes/-final-review-restorations.test.ts` — expect it to
**still pass** at this point in the plan, not fail. That test does `readFileSync` + string
`toContain` checks against `settings.tsx`'s own source text, not against `templates.ts` — since this
task doesn't touch `settings.tsx` at all, the literal substrings `"templatesStore.update"`/
`"templatesStore.addDocument"` are still physically present there, so the assertions still match.
It only starts failing once Task 7 rewires `settings.tsx` to stop calling `templatesStore.*` — that
task is what makes it fail, and Task 8 is what fixes it. Don't be surprised if it's green here.

### Step 4: Commit

```bash
git add src/lib/templates.ts
git commit -m "refactor(templates): trim the demo fixture to read-only"
```

Note: this commit leaves the build broken (`settings.tsx` won't typecheck) — that's fine, Task 7
fixes it in the same branch before the final verification sweep. Do not push or open a PR between
this commit and Task 7's completion.

---

## Task 6: `-settings-sections` becomes checklist-templates-aware

**Files:**
- Modify: `src/routes/-settings-sections.ts`
- Modify: `src/routes/-settings-sections.test.ts`

### Step 1: Update the failing test first

Read `src/routes/-settings-sections.test.ts` in full (35 lines). Change the two `toEqual`
assertions so `checklistTemplates` is `true` in both modes:

```typescript
describe("settingsSectionsForMode", () => {
  it("hides the remaining browser-store sections in production", () => {
    expect(settingsSectionsForMode("production")).toEqual({
      checklistTemplates: true,
      knowledgeBase: false,
      servicePackages: false,
      whatsappIntegration: true,
    });
  });

  it("shows every section in demo", () => {
    expect(settingsSectionsForMode("demo")).toEqual({
      checklistTemplates: true,
      knowledgeBase: true,
      servicePackages: true,
      whatsappIntegration: true,
    });
  });

  it("keeps the server-backed integration panel in both modes", () => {
    expect(settingsSectionsForMode("demo").whatsappIntegration).toBe(true);
    expect(settingsSectionsForMode("production").whatsappIntegration).toBe(true);
  });
});
```

Also rename the first test from `"hides the browser-store sections in production"` to `"hides the
remaining browser-store sections in production"` — checklist templates is no longer one of them.

Run: `npm run test -- src/routes/-settings-sections.test.ts`
Expected: FAIL — `checklistTemplates` is still `demo`-only in the source.

### Step 2: Update the implementation

Read `src/routes/-settings-sections.ts` in full (26 lines) — note its doc comment names checklist
templates as one of the sections with "no table... no repository... nothing in production reads
them." Update both the code and the comment:

```typescript
import type { DataMode } from "@/features/runtime/data-mode";

/**
 * Which sections this screen may show, by data mode.
 *
 * Checklist templates are now backed by a real `checklist_templates` table, repository,
 * and Admin-gated server functions (see `src/features/checklist-templates/`), so they show
 * in both modes — demo read-only, production with working controls.
 *
 * The knowledge base is still held in a browser store: there is no table, no repository, and
 * no production code reads it. Rendering its editor in production meant an Admin edited state
 * that was discarded on reload, with no persistence and no authorization, and that would not
 * have changed anything even if it had persisted. Service packages are hardcoded fee tiers,
 * which is worse than useless on a production screen someone might quote from.
 *
 * The WhatsApp panel stays in both modes: `getWhatsAppIntegrationStatus` is a real server
 * function, so it is the one part of this screen that reports production truth.
 */
export function settingsSectionsForMode(dataMode: DataMode) {
  const demo = dataMode === "demo";
  return {
    checklistTemplates: true,
    knowledgeBase: demo,
    servicePackages: demo,
    whatsappIntegration: true,
  };
}
```

### Step 3: Run the test

Run: `npm run test -- src/routes/-settings-sections.test.ts`
Expected: PASS, all 3 cases.

### Step 4: Verify

Run: `npx tsc --noEmit` — expect the same pre-existing `settings.tsx` errors from Task 5, nothing new.
Run: `npm run lint` — expect clean, exit code checked directly.

### Step 5: Commit

```bash
git add src/routes/-settings-sections.ts src/routes/-settings-sections.test.ts
git commit -m "feat(settings): show checklist templates in production"
```

---

## Task 7: Rewire `settings.tsx`

**Files:**
- Modify: `src/routes/settings.tsx`

This is the task that actually fixes the `tsc` errors left by Tasks 5-6.

### Step 1: Read the current file in full

Read `src/routes/settings.tsx` in full (706 lines) before changing anything. You need to preserve
every non-template section (`KnowledgeBaseSection`, service packages, the WOZTELL panel) exactly as
they are — only the "Checklist templates" section (`sections.checklistTemplates ? (...) : null`,
currently lines 99-205) and its supporting components (`TemplateEditor`, `DocumentsTab`,
`RemindersTab`, `RisksTab`) change.

### Step 2: Update imports

Replace:
```typescript
import {
  useTemplates,
  templatesStore,
  SERVICE_TYPES,
  type ChecklistTemplate,
  type ServiceType,
  type RiskRule,
  type ReminderRule,
} from "@/lib/templates";
```
with:
```typescript
import { useTemplates as useDemoTemplates } from "@/lib/templates";
import {
  SERVICE_TYPES,
  type ChecklistTemplate,
  type ChecklistTemplatePatch,
  type DocumentItem,
  type ServiceType,
  type RiskRule,
  type ReminderRule,
} from "@/features/checklist-templates/types";
import {
  createChecklistTemplate,
  deleteChecklistTemplate,
  duplicateChecklistTemplate,
  listChecklistTemplates,
  updateChecklistTemplate,
} from "@/features/checklist-templates/server-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
```
(`useQuery`/`useQueryClient` are likely already imported for `integrationQuery` — check the existing
import line from `@tanstack/react-query` and extend it rather than duplicating the import statement.)

### Step 3: Replace the template data source in `SettingsPage`

Replace:
```typescript
const templates = useTemplates();
```
with a branch on `dataMode`:
```typescript
const queryClient = useQueryClient();
const demoTemplates = useDemoTemplates();
const productionTemplatesQuery = useQuery({
  queryKey: ["checklist-templates"],
  queryFn: () => listChecklistTemplates(),
  enabled: dataMode === "production",
});
const templates = dataMode === "demo" ? demoTemplates : (productionTemplatesQuery.data ?? []);

function invalidateTemplates() {
  void queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
}

const createMutation = useMutation({
  mutationFn: (serviceType: ServiceType) => createChecklistTemplate({ data: { serviceType } }),
  onSuccess: (created) => {
    invalidateTemplates();
    setSelectedId(created.id);
    setTab("documents");
  },
});
const updateMutation = useMutation({
  mutationFn: (input: { id: string; patch: ChecklistTemplatePatch }) =>
    updateChecklistTemplate({ data: input }),
  onSuccess: invalidateTemplates,
});
const duplicateMutation = useMutation({
  mutationFn: (id: string) => duplicateChecklistTemplate({ data: { id } }),
  onSuccess: (duplicated) => {
    invalidateTemplates();
    setSelectedId(duplicated.id);
  },
});
const deleteMutation = useMutation({
  mutationFn: (id: string) => deleteChecklistTemplate({ data: { id } }),
  onSuccess: invalidateTemplates,
});
```
`(queryClient)` must be declared before any conditional return (it already sits below the existing
`const { dataMode } = Route.useRouteContext();` / `useAuth()` calls per the Rules-of-Hooks discipline
this codebase already follows in this exact component — see the `isCurrentUserAdmin` gate a few
lines below). Place all of the above between the existing `useQuery` for `integrationQuery` and the
existing `useState` calls, so every hook still runs unconditionally before the `if (dataMode ===
"production" && !isCurrentUserAdmin)` early return.

### Step 4: Branch the "New template" button and template list

The existing "New template" button currently calls `templatesStore.create()` synchronously and reads
the returned id immediately. Since production creation is now async, branch on `dataMode`:

```tsx
<button
  onClick={() => {
    if (dataMode === "demo") return; // read-only in demo; button is hidden entirely, see below
    createMutation.mutate("Annual Return — Private Ltd");
  }}
  ...
>
```

But per the design, demo shows **no** New/Duplicate/Delete/Add-row controls at all — don't just
disable the handler, omit the controls. Wrap the whole header actions area and every mutating
control in `{dataMode === "production" && (...)}` rather than a no-op branch inside the handler.
Concretely: the "New template" button, `TemplateEditor`'s Duplicate/Delete buttons, and every
`onChange`/`add`/`remove` control inside `DocumentsTab`/`RemindersTab`/`RisksTab` render only when
`dataMode === "production"`. Thread `dataMode` down as a prop to `TemplateEditor` and each tab
component (they currently take `t`, `tab`, `setTab`, `onDuplicate`, `onDelete` — add `dataMode:
DataMode` alongside, importing the `DataMode` type from `@/features/runtime/data-mode` matching how
`-settings-sections.ts` already imports it).

### Step 5: Replace every `templatesStore.*` call site

For each of the 23 call sites in `TemplateEditor`/`DocumentsTab`/`RemindersTab`/`RisksTab`, replace
the direct `templatesStore.update(...)`/`addDocument(...)`/etc. call with the equivalent local-state
computation + `updateMutation.mutate({ id, patch })` call. Two commit strategies, per the design:

- **Text inputs** (name, description, document/reminder label, risk trigger text): keep the
  input's value in local component state during typing (`useState` inside `TemplateEditor`/each tab,
  seeded from `t` and reset via the existing `key={selected.id}` remount pattern already in place),
  and fire the mutation `onBlur`, not `onChange`. Example for the name field:
  ```tsx
  const [name, setName] = useState(t.name);
  // ...
  <input
    value={name}
    onChange={(e) => setName(e.target.value)}
    onBlur={() => {
      if (name !== t.name) updateMutation.mutate({ id: t.id, patch: { name } });
    }}
    disabled={dataMode === "demo"}
    ...
  />
  ```
- **Checkboxes, selects, add/remove/duplicate/delete buttons**: commit immediately on the existing
  event, computing the new array value in JS before calling the mutation. Example for removing a
  document:
  ```tsx
  onClick={() => {
    if (dataMode === "demo") return;
    updateMutation.mutate({
      id: t.id,
      patch: { documents: t.documents.filter((d) => d.id !== docId) },
    });
  }}
  ```
  Example for adding a document (new item id generated client-side, matching the design's choice to
  use `crypto.randomUUID()` instead of the old `rid()` short-string generator):
  ```tsx
  onClick={() => {
    if (dataMode === "demo") return;
    updateMutation.mutate({
      id: t.id,
      patch: {
        documents: [
          ...t.documents,
          { id: crypto.randomUUID(), label: "New document", required: true, daysBeforeDue: 14 },
        ],
      },
    });
  }}
  ```

Apply the same two patterns across `RemindersTab` (label text → blur; daysBeforeDue number input →
blur, matching today's numeric-input pattern; channel select → immediate; add/remove → immediate)
and `RisksTab` (label/trigger text → blur; severity select/enabled checkbox → immediate; add/remove
→ immediate).

For `onDuplicate`/`onDelete` on `TemplateEditor` itself, replace:
```tsx
onDuplicate={() => {
  const id = templatesStore.duplicate(selected.id);
  if (id) setSelectedId(id);
}}
onDelete={() => {
  templatesStore.remove(selected.id);
  const next = templates.find((t) => t.id !== selected.id);
  if (next) setSelectedId(next.id);
}}
```
with:
```tsx
onDuplicate={() => duplicateMutation.mutate(selected.id)}
onDelete={() => {
  deleteMutation.mutate(selected.id);
  const next = templates.find((t) => t.id !== selected.id);
  if (next) setSelectedId(next.id);
}}
```
(`duplicateMutation`'s `onSuccess` already calls `setSelectedId(duplicated.id)`, so `onDuplicate`
itself needs no follow-up id handling, unlike today's synchronous version.)

### Step 6: Read-only rendering in demo

Every input/select/checkbox that remains visible in demo (the fields themselves, not the
add/remove/duplicate/delete controls, which are omitted per Step 4) gets `disabled={dataMode ===
"demo"}` so the existing list/detail view still renders the fixture data for browsing, but nothing
is editable. Confirm this against the design's acceptance criterion 3: "no create/edit/duplicate/
delete control is present or functional" in demo.

### Step 7: Typecheck and fix fallout

Run: `npx tsc --noEmit`
Expected: clean — this is the task that resolves every error Tasks 5-6 introduced.

### Step 8: Manual smoke check

Run `npm run dev`, sign in as a demo Admin persona, visit `/settings`, confirm the template list
renders read-only (no New/Duplicate/Delete, fields disabled). Switch to a production-mode session as
an Admin (per this session's earlier P0-7 work, non-Admin production sessions see a denied state
before reaching this section at all), confirm creating/editing/duplicating/deleting a template works
and survives a reload.

### Step 9: Commit

```bash
git add src/routes/settings.tsx
git commit -m "feat(settings): wire checklist templates to the real backend, make demo read-only"
```

---

## Task 8: Update existing tests, add new route-level coverage

**Files:**
- Modify: `src/routes/-final-review-restorations.test.ts`
- Create: `src/routes/-settings-templates.test.tsx`

### Step 1: Fix the brittle source-match test

Read `src/routes/-final-review-restorations.test.ts` in full (107 lines). Its `"restores editable
settings while retaining the knowledge base"` test currently asserts:
```typescript
expect(settingsSource).toContain("templatesStore.update");
expect(settingsSource).toContain("templatesStore.addDocument");
```
Both strings no longer exist in `settings.tsx` after Task 7. Replace them with assertions on the new
source shape that preserve the test's actual intent (confirming the templates section still renders
with real controls, not proving it was deleted):
```typescript
expect(settingsSource).toContain("updateChecklistTemplate");
expect(settingsSource).toContain("createChecklistTemplate");
```
Leave the rest of that test (`"Service packages"`, `"WOZTELL WhatsApp API"`, `"<KnowledgeBaseSection />"`)
unchanged — those sections aren't touched by this plan.

Run: `npm run test -- src/routes/-final-review-restorations.test.ts`
Expected: PASS.

### Step 2: Write the new route-level test

Read `src/routes/-settings-admin-guard.test.tsx` in full first — reuse its exact harness (`vi.mock`
on `../styles.css?url`, `@/features/auth/neon-auth-rpc`, `@/features/auth/auth-context-neon` with a
hoisted `mockIsAdmin` toggle; `createRouter` + `renderToString` + `RouterProvider`). This new test
additionally needs to mock `@/features/checklist-templates/server-fns`'s `listChecklistTemplates` so
the production case has something to render.

Create `src/routes/-settings-templates.test.tsx`:

```tsx
import { createElement, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "" }));

vi.mock("@/features/whatsapp/server-fns", () => ({
  getWhatsAppIntegrationStatus: vi.fn(async () => ({
    deliveryMode: "simulated",
    missingLiveEnvVars: [],
  })),
}));

vi.mock("@/features/checklist-templates/server-fns", () => ({
  listChecklistTemplates: vi.fn(async () => [
    {
      id: "tpl-prod-1",
      name: "Production template",
      serviceType: "Annual Return — Private Ltd",
      description: "",
      active: true,
      documents: [],
      reminders: [],
      riskRules: [],
      updatedAt: "2026-08-18T00:00:00.000Z",
    },
  ]),
  createChecklistTemplate: vi.fn(),
  updateChecklistTemplate: vi.fn(),
  duplicateChecklistTemplate: vi.fn(),
  deleteChecklistTemplate: vi.fn(),
}));

const mockIsAdmin = vi.hoisted(() => ({ value: true }));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session: {
        id: "test-user",
        name: "Test User",
        email: "user@example.test",
        role: mockIsAdmin.value ? ("Admin" as const) : ("Staff" as const),
        initials: "TU",
        team: "Operations",
        signedInAt: "2026-07-11T00:00:00.000Z",
      },
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: mockIsAdmin.value,
      login: vi.fn(),
      loginWithMagicLink: vi.fn(),
      loginWithGoogle: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

import { routeTree } from "../routeTree.gen";

afterEach(() => {
  mockIsAdmin.value = true;
});

async function renderSettings(dataMode: "demo" | "production" = "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
    context: { queryClient: new QueryClient(), dataMode, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("/settings checklist templates, by data mode", () => {
  it("shows the fixture read-only in demo — no mutating controls", async () => {
    const html = await renderSettings("demo");

    expect(html).toContain("Annual return — Private Ltd");
    expect(html).not.toContain("New template");
  });

  it("shows the real backend's data with working controls in production for an admin", async () => {
    mockIsAdmin.value = true;

    const html = await renderSettings("production");

    expect(html).toContain("Production template");
    expect(html).toContain("New template");
  });
});
```

Run: `npm run test -- src/routes/-settings-templates.test.tsx`
Expected: PASS, both cases.

### Step 3: Verify

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run lint` — expect clean, exit code checked directly.

### Step 4: Commit

```bash
git add src/routes/-final-review-restorations.test.ts src/routes/-settings-templates.test.tsx
git commit -m "test(settings): cover checklist templates read-only demo vs. real production"
```

---

## Task 9: Full verification sweep

**Files:** none modified.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. Confirm the exit code directly (run it unpiped, or check `$?` immediately after).

- [ ] **Step 3: Full suite**

Run: `npm run test`
Expected: PASS, with a total no lower than this branch's baseline before Task 1.

- [ ] **Step 4: Repository integration suite**

Run: `TEST_DATABASE_URL=<local test db> npm run test -- src/features/checklist-templates/repository.test.ts`
Expected: PASS, all 6 cases (this suite is skipped in the plain `npm run test` run from Step 3 unless
`TEST_DATABASE_URL` is set — confirm it actually ran here, not silently skipped).

- [ ] **Step 5: Confirm no other `templatesStore` reference survives**

Run: `grep -rn "templatesStore" src/ --include=*.ts --include=*.tsx`
Expected: **zero hits**. If anything remains, it's a caller Task 7 missed.

- [ ] **Step 6: Push**

```bash
git push -u origin codex/checklist-templates-persistence
```

---

## Acceptance: what "done" means

1. An Admin actor in production can create, edit (name, description, service type, active flag,
   documents, reminders, risk rules), duplicate, and delete checklist templates, and the changes
   survive a reload.
2. A non-Admin actor's call to any of the five new server fns is rejected with a `Forbidden:` error,
   independent of the page-level gate.
3. Demo mode renders the same five templates read-only — no create/edit/duplicate/delete control is
   present or functional.
4. `templatesStore` no longer exists anywhere in the codebase.
5. `ChecklistTemplate` and its related types are defined in exactly one place
   (`checklist-templates/types.ts`), imported by both the demo fixture and the production module.

## Out of scope

- Wiring templates into actual case creation — P1-1's job.
- Any change to the automated reminder cadence or a risk-scoring engine.
- The demo screen's cosmetic per-template "usage count" badge.
- A uniqueness constraint preventing two `active` templates for the same `service_type`.
- Extracting a shared `assertAdminAccess` helper into `src/features/auth/authorization.ts`.
