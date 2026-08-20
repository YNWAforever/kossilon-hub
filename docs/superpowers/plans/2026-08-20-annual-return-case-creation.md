# Annual Return Case Creation (P1-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a real "New case" flow on `/annual-returns` — pick a company, pick an active
checklist template, confirm the owner, enter an invoice number and fee — that creates a persisted
`annual_return_cases` row with checklist items instantiated from the template, a payments row, and a
linked work item, all in one transaction. Closes the roadmap's #1 GA blocker: today only
`scripts/db-seed-annual-return.ts` can create a case.

**Architecture:** One new repository method (`createCase`, plus a small `listCompaniesEligibleForCase`
read), one new server-fn pair, one new dialog component wired into the existing production command
center. A small, narrowly-scoped addition to the already-shipped `checklist-templates` module gives
non-Admin staff a way to read active templates (the only existing read path is Admin-only). Every
change is additive — no existing exported function's signature or behavior changes.

**Tech Stack:** TanStack Start (`createServerFn`), TypeScript 5.8 strict, Postgres via `postgres`
(raw SQL, no ORM), Zod, React 19, TanStack Query, Vitest 4.

---

## Context for every task below

- Design spec: `docs/superpowers/specs/2026-08-20-annual-return-case-creation-design.md` — read this
  first if anything below is unclear about *why*. It records two real gaps found while writing this
  plan (every case needs a payments row; the only template-read path is Admin-only) and one
  correction to the original brainstormed design (a case has no `team_id` column of its own — team
  is always derived live from its company, so it can't be overridden the way owner can).
- **No changes to any existing exported function's signature or behavior anywhere in this plan.**
  Every task is additive: new functions, new types, new files, or narrow, backward-compatible
  widenings (e.g. `writeAuditEvent`'s `case_` parameter narrows from a concrete type to a `Pick` that
  every existing caller already satisfies).
- Every edit below is given as an exact "Replace this / with this" pair, copied verbatim from the
  files as they exist right now. Apply with the Edit tool (`old_string`/`new_string`) — read the file
  first, then match `old_string` exactly.
- Tasks are ordered by dependency: Task 4 needs Tasks 1 and 2 done first; Task 5 needs Task 4; Task 6
  needs Tasks 3 and 5; Task 7 needs Task 6.

---

### Task 1: `annual-return/workflow.ts` — a small, reusable date-offset helper

**Files:**
- Modify: `src/features/annual-return/workflow.ts`
- Modify: `src/features/annual-return/workflow.test.ts`

`calculateFilingDueDate` already offsets a date-only string by a fixed number of days (42). Task 4
needs the same operation with a per-item, possibly-negative offset (a checklist item's due date is
the filing due date *minus* the template's `daysBeforeDue`). Rather than duplicating the
parse/offset/format logic, this generalizes it into one exported helper that `calculateFilingDueDate`
itself is rewritten to use — a pure "extract and reuse," not a behavior change (verified by the
existing `calculateFilingDueDate` test continuing to pass unchanged).

- [ ] **Step 1: Write the failing test**

In `workflow.test.ts`, replace:

```typescript
import {
  ANNUAL_RETURN_STATUSES,
  buildReminderDraft,
  calculateFilingDueDate,
  completionBlockers,
  hasRequiredChecklistEvidence,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  riskForCase,
  shouldGenerateCase,
} from "./workflow";
```

With:

```typescript
import {
  ANNUAL_RETURN_STATUSES,
  buildReminderDraft,
  calculateFilingDueDate,
  completionBlockers,
  hasRequiredChecklistEvidence,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  offsetDateOnly,
  riskForCase,
  shouldGenerateCase,
} from "./workflow";
```

Then replace:

```typescript
  it("calculates the filing due date as 42 days after the basis date", () => {
    expect(calculateFilingDueDate("2026-07-01")).toBe("2026-08-12");
  });
```

With:

```typescript
  it("calculates the filing due date as 42 days after the basis date", () => {
    expect(calculateFilingDueDate("2026-07-01")).toBe("2026-08-12");
  });

  it("offsets a date-only string forward and backward", () => {
    expect(offsetDateOnly("2026-08-12", -14)).toBe("2026-07-29");
    expect(offsetDateOnly("2026-07-01", 42)).toBe("2026-08-12");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/annual-return/workflow.test.ts`
Expected: FAIL — `offsetDateOnly` is not exported from `./workflow` yet.

- [ ] **Step 3: Implement `offsetDateOnly` and rewrite `calculateFilingDueDate` to use it**

In `workflow.ts`, replace:

```typescript
export function calculateFilingDueDate(annualReturnBasisDate: string): string {
  const due = parseDateOnly(annualReturnBasisDate);
  due.setUTCDate(due.getUTCDate() + 42);
  return formatDateOnly(due);
}
```

With:

```typescript
/** Positive `days` moves forward, negative moves backward. */
export function offsetDateOnly(date: string, days: number): string {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatDateOnly(value);
}

export function calculateFilingDueDate(annualReturnBasisDate: string): string {
  return offsetDateOnly(annualReturnBasisDate, 42);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/annual-return/workflow.test.ts`
Expected: PASS, full file (this file has other tests too — confirm none regressed).

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/workflow.ts src/features/annual-return/workflow.test.ts
git commit -m "feat: add offsetDateOnly, reuse it in calculateFilingDueDate"
```

---

### Task 2: `annual-return/permissions.ts` — authorization for creating a case

**Files:**
- Modify: `src/features/annual-return/permissions.ts`
- Modify: `src/features/annual-return/permissions.test.ts`

Mirrors `clients/authorization.ts`'s `assertClientCompanyCreatable` policy exactly (Admin
unrestricted; Manager/Staff may only act on their own team; inactive/wrong-team rejected) but placed
and shaped to match this module's own convention — a plain function next to
`assertAnnualReturnActionAllowed`, operating on `AnnualReturnActionActor` (not `AuthenticatedActor`),
since `annual-return/repository.ts`'s `createCase` (Task 4) re-fetches the actor from `users` itself
rather than trusting a value from the server-fn layer.

- [ ] **Step 1: Write the failing tests**

In `permissions.test.ts`, replace:

```typescript
import {
  assertAnnualReturnActionAllowed,
  caseFiltersForActor,
  getAnnualReturnActionPermission,
  type AnnualReturnActionActor,
  type AnnualReturnActionCase,
} from "./permissions";
```

With:

```typescript
import {
  assertAnnualReturnActionAllowed,
  assertAnnualReturnCaseCreatable,
  caseFiltersForActor,
  getAnnualReturnActionPermission,
  type AnnualReturnActionActor,
  type AnnualReturnActionCase,
} from "./permissions";
```

Then replace:

```typescript
  it("throws a useful error when an action is denied", () => {
    expect(() =>
      assertAnnualReturnActionAllowed(
        actor({ id: OTHER_STAFF_ID, teamId: TEAM_BRAVO_ID }),
        case_,
        "update_payment",
      ),
    ).toThrow(/Only assigned staff/);
  });
});
```

With:

```typescript
  it("throws a useful error when an action is denied", () => {
    expect(() =>
      assertAnnualReturnActionAllowed(
        actor({ id: OTHER_STAFF_ID, teamId: TEAM_BRAVO_ID }),
        case_,
        "update_payment",
      ),
    ).toThrow(/Only assigned staff/);
  });
});

describe("assertAnnualReturnCaseCreatable", () => {
  it("rejects inactive actors", () => {
    expect(() =>
      assertAnnualReturnCaseCreatable(actor({ active: false }), { teamId: TEAM_ALPHA_ID }),
    ).toThrow("Forbidden: inactive users cannot create annual return cases.");
  });

  it("allows admins to create for any team", () => {
    const admin = actor({ role: "Admin", teamId: TEAM_BRAVO_ID });

    expect(() => assertAnnualReturnCaseCreatable(admin, { teamId: TEAM_ALPHA_ID })).not.toThrow();
  });

  it("allows managers and staff to create for their own team", () => {
    expect(() =>
      assertAnnualReturnCaseCreatable(actor({ role: "Manager" }), { teamId: TEAM_ALPHA_ID }),
    ).not.toThrow();
    expect(() =>
      assertAnnualReturnCaseCreatable(actor({ role: "Staff" }), { teamId: TEAM_ALPHA_ID }),
    ).not.toThrow();
  });

  it("rejects managers and staff creating for another team", () => {
    expect(() =>
      assertAnnualReturnCaseCreatable(actor({ role: "Manager" }), { teamId: TEAM_BRAVO_ID }),
    ).toThrow("Forbidden: this company belongs to another team.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/annual-return/permissions.test.ts`
Expected: FAIL — `assertAnnualReturnCaseCreatable` is not exported yet.

- [ ] **Step 3: Implement `assertAnnualReturnCaseCreatable`**

In `permissions.ts`, replace:

```typescript
export type AnnualReturnAction =
  | "assign_owner"
  | "add_note"
  | "record_reminder"
  | "update_checklist"
  | "update_payment"
  | "update_filing_proof"
  | "change_status"
  | "complete";
```

With:

```typescript
export type AnnualReturnAction =
  | "assign_owner"
  | "add_note"
  | "record_reminder"
  | "update_checklist"
  | "update_payment"
  | "update_filing_proof"
  | "change_status"
  | "complete"
  | "create_case";
```

Then replace:

```typescript
export function assertAnnualReturnActionAllowed(
  actor: AnnualReturnActionActor,
  case_: AnnualReturnActionCase,
  action: AnnualReturnAction,
): void {
  const permission = getAnnualReturnActionPermission(actor, case_, action);

  if (!permission.allowed) {
    throw new Error(permission.reason);
  }
}
```

With:

```typescript
export function assertAnnualReturnActionAllowed(
  actor: AnnualReturnActionActor,
  case_: AnnualReturnActionCase,
  action: AnnualReturnAction,
): void {
  const permission = getAnnualReturnActionPermission(actor, case_, action);

  if (!permission.allowed) {
    throw new Error(permission.reason);
  }
}

/**
 * Creation has no existing case row to compare against, so the check is on the
 * company's own team — a case has no team_id of its own; every read derives it
 * live from companies.assigned_team_id (see annual-return/repository.ts's
 * selectCaseRows/getCase), so the company's team is the only team there is.
 */
export function assertAnnualReturnCaseCreatable(
  actor: AnnualReturnActionActor,
  input: { teamId: string },
): void {
  if (!actor.active) {
    throw new Error("Forbidden: inactive users cannot create annual return cases.");
  }

  if (actor.role === "Admin") {
    return;
  }

  if (actor.teamId !== input.teamId) {
    throw new Error("Forbidden: this company belongs to another team.");
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/annual-return/permissions.test.ts`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/permissions.ts src/features/annual-return/permissions.test.ts
git commit -m "feat: add assertAnnualReturnCaseCreatable"
```

---

### Task 3: `checklist-templates/server-fns.ts` — a staff-readable template list for the picker

**Files:**
- Modify: `src/features/checklist-templates/server-fns.ts`
- Modify: `src/features/checklist-templates/server-fns.test.ts`

The dialog's template dropdown (Task 6) needs to read active checklist templates, but the only
existing read path, `listChecklistTemplates`, calls `assertAdminAccess` — a Manager/Staff actor
creating a case (an action they're otherwise allowed to take, per Task 2) couldn't see the template
list at all. This adds one new, narrowly-scoped function requiring only `assertStaffAccess`,
returning a minimal `{ id, name, serviceType }` projection — not the full template with its
documents/reminders/riskRules, since staff picking a template by name have no business editing its
configuration. It reuses the existing `listTemplates()` repository method and filters/projects in the
pure function — no new repository method, no schema change, and `loadDefaultChecklistTemplateContext`
already resolves the actor via `requireStaffActor` (not an Admin-only check) at the loader level, so
no changes are needed there either — only each individual function decides its own bar today, and
this one sets a lower one.

- [ ] **Step 1: Write the failing tests**

In `server-fns.test.ts`, replace:

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
```

With:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ChecklistTemplate } from "./types";
import {
  assertAdminAccess,
  createChecklistTemplateForActor,
  deleteChecklistTemplateForActor,
  duplicateChecklistTemplateForActor,
  listActiveAnnualReturnTemplatesForActor,
  listChecklistTemplatesForActor,
  updateChecklistTemplateForActor,
} from "./server-fns";
```

Then find the `sampleTemplate` constant and the `repositoryFor` helper (they already exist — do not
redefine them) and add this new `describe` block at the end of the file:

```typescript
describe("listActiveAnnualReturnTemplatesForActor", () => {
  const incorporationTemplate: ChecklistTemplate = {
    ...sampleTemplate,
    id: "tpl-incorporation",
    serviceType: "Incorporation — HK Ltd",
  };
  const inactiveTemplate: ChecklistTemplate = {
    ...sampleTemplate,
    id: "tpl-inactive",
    active: false,
  };

  it("allows a non-Admin staff actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      listActiveAnnualReturnTemplatesForActor(staffActor, {}, { repository }),
    ).resolves.toEqual([{ id: sampleTemplate.id, name: sampleTemplate.name, serviceType: sampleTemplate.serviceType }]);
  });

  it("rejects a Client actor", async () => {
    const { repository } = repositoryFor();
    const clientActor: AuthenticatedActor = { ...staffActor, role: "Client" };

    await expect(
      listActiveAnnualReturnTemplatesForActor(clientActor, {}, { repository }),
    ).rejects.toThrow(/staff access is required/i);
  });

  it("excludes inactive templates and non-Annual-Return service types", async () => {
    const { repository } = repositoryFor({
      listTemplates: vi.fn(async () => [sampleTemplate, incorporationTemplate, inactiveTemplate]),
    });

    const result = await listActiveAnnualReturnTemplatesForActor(staffActor, {}, { repository });

    expect(result).toEqual([
      { id: sampleTemplate.id, name: sampleTemplate.name, serviceType: sampleTemplate.serviceType },
    ]);
  });

  it("projects to id/name/serviceType only", async () => {
    const { repository } = repositoryFor();

    const [result] = await listActiveAnnualReturnTemplatesForActor(staffActor, {}, { repository });

    expect(Object.keys(result!)).toEqual(["id", "name", "serviceType"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/checklist-templates/server-fns.test.ts`
Expected: FAIL — `listActiveAnnualReturnTemplatesForActor` is not exported yet.

- [ ] **Step 3: Implement the function and its server fn wrapper**

Replace:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ChecklistTemplateRepository } from "./repository";
import { SERVICE_TYPES, type ChecklistTemplatePatch } from "./types";
```

With:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ChecklistTemplateRepository } from "./repository";
import { SERVICE_TYPES, type ChecklistTemplatePatch, type ServiceType } from "./types";
```

Then replace:

```typescript
export async function deleteChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  await dependencies.repository.deleteTemplate(input.id);
  return { deleted: true };
}
```

With:

```typescript
export async function deleteChecklistTemplateForActor(
  actor: AuthenticatedActor,
  input: { id: string },
  dependencies: ChecklistTemplateDependencies,
) {
  assertAdminAccess(actor);
  await dependencies.repository.deleteTemplate(input.id);
  return { deleted: true };
}

const ANNUAL_RETURN_SERVICE_TYPES: readonly ServiceType[] = [
  "Annual Return — Private Ltd",
  "Annual Return — Public Ltd",
];

export type ActiveChecklistTemplateSummary = {
  id: string;
  name: string;
  serviceType: ServiceType;
};

/**
 * Staff-readable, not Admin-only like every other function in this file: a
 * Manager/Staff actor creating an annual return case needs to pick a template
 * by name, but has no business editing template configuration — hence the
 * trimmed projection rather than reusing listChecklistTemplatesForActor.
 */
export async function listActiveAnnualReturnTemplatesForActor(
  actor: AuthenticatedActor,
  _input: Record<string, never>,
  dependencies: ChecklistTemplateDependencies,
): Promise<ActiveChecklistTemplateSummary[]> {
  assertStaffAccess(actor);
  const templates = await dependencies.repository.listTemplates();
  return templates
    .filter(
      (template) => template.active && ANNUAL_RETURN_SERVICE_TYPES.includes(template.serviceType),
    )
    .map((template) => ({
      id: template.id,
      name: template.name,
      serviceType: template.serviceType,
    }));
}
```

Then replace:

```typescript
export const listChecklistTemplates = createServerFn({ method: "GET" }).handler(() =>
  withDefaultChecklistTemplateContext((actor, dependencies) =>
    listChecklistTemplatesForActor(actor, {}, dependencies),
  ),
);
```

With:

```typescript
export const listChecklistTemplates = createServerFn({ method: "GET" }).handler(() =>
  withDefaultChecklistTemplateContext((actor, dependencies) =>
    listChecklistTemplatesForActor(actor, {}, dependencies),
  ),
);

export const listActiveAnnualReturnTemplates = createServerFn({ method: "GET" }).handler(() =>
  withDefaultChecklistTemplateContext((actor, dependencies) =>
    listActiveAnnualReturnTemplatesForActor(actor, {}, dependencies),
  ),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/checklist-templates/server-fns.test.ts`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add src/features/checklist-templates/server-fns.ts src/features/checklist-templates/server-fns.test.ts
git commit -m "feat: add staff-readable active-templates list for case creation"
```

---

### Task 4: `annual-return/repository.ts` — `listCompaniesEligibleForCase` and `createCase`

**Files:**
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/repository.test.ts`

The core of this feature. Requires Tasks 1 and 2 to be done first (`offsetDateOnly`,
`assertAnnualReturnCaseCreatable`).

- [ ] **Step 1: Update imports**

Replace:

```typescript
import { ensureWorkItemForEvent } from "@/features/work-items/repository";
import { enqueueNotification } from "@/features/notifications/outbox";
import type postgres from "postgres";
import {
  buildReminderDraft,
  daysBetween,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  riskForCase,
} from "./workflow";
import { dueMilestone, type ReminderMilestone } from "./reminder-cadence";
import {
  assertAnnualReturnActionAllowed,
  type AnnualReturnAction,
  type AnnualReturnActionActor,
  type AnnualReturnActorRole,
} from "./permissions";
```

With:

```typescript
import { ensureWorkItemForEvent } from "@/features/work-items/repository";
import { enqueueNotification } from "@/features/notifications/outbox";
import type postgres from "postgres";
import {
  buildReminderDraft,
  calculateFilingDueDate,
  daysBetween,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  offsetDateOnly,
  riskForCase,
} from "./workflow";
import { dueMilestone, type ReminderMilestone } from "./reminder-cadence";
import {
  assertAnnualReturnActionAllowed,
  assertAnnualReturnCaseCreatable,
  type AnnualReturnAction,
  type AnnualReturnActionActor,
  type AnnualReturnActorRole,
} from "./permissions";
```

Then replace:

```typescript
import type {
  AnnualReturnCase,
  AnnualReturnCaseNote,
  AnnualReturnChecklistItem,
  AnnualReturnPayment,
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "./types";
```

With:

```typescript
import type {
  AnnualReturnCase,
  AnnualReturnCaseNote,
  AnnualReturnChecklistItem,
  AnnualReturnPayment,
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "./types";
import type { DocumentItem } from "@/features/checklist-templates/types";
```

- [ ] **Step 2: Add new row types**

Replace:

```typescript
type LockedCaseRow = {
  id: string;
  company_id: string;
  company_name: string;
  company_team_id: string;
  current_status: AnnualReturnStatus;
  owner_id: string;
  reviewer_id: string | null;
  filing_reference: string | null;
  confirmation_document_id: string | null;
};

type QueryClient = SqlClient | postgres.TransactionSql;
```

With:

```typescript
type LockedCaseRow = {
  id: string;
  company_id: string;
  company_name: string;
  company_team_id: string;
  current_status: AnnualReturnStatus;
  owner_id: string;
  reviewer_id: string | null;
  filing_reference: string | null;
  confirmation_document_id: string | null;
};

type EligibleCompanyRow = {
  id: string;
  company_name: string;
  cr_number: string;
  annual_return_basis_date: string | Date;
  assigned_owner_id: string;
  assigned_team_id: string;
  team_name: string;
};

type CompanyForCaseRow = {
  id: string;
  status: "active" | "inactive";
  annual_return_basis_date: string | Date;
  assigned_team_id: string;
};

type TemplateForCaseRow = {
  id: string;
  active: boolean;
  documents: DocumentItem[];
};

type QueryClient = SqlClient | postgres.TransactionSql;
```

- [ ] **Step 3: Add new public types and repository method signatures**

Replace:

```typescript
export type CreateAnnualReturnRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
  today?: string | (() => string);
};

export type AnnualReturnRepository = {
  listCases(filters: CaseFilters): Promise<AnnualReturnCase[]>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  dashboardMetrics(
```

With:

```typescript
export type CreateAnnualReturnRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
  today?: string | (() => string);
};

export type EligibleCompanyForCase = {
  id: string;
  companyName: string;
  crNumber: string;
  annualReturnBasisDate: string;
  assignedOwnerId: string;
  assignedTeamId: string;
  assignedTeamName: string;
};

export type CreateAnnualReturnCaseInput = {
  companyId: string;
  templateId: string;
  ownerId: string;
  invoiceNumber: string;
  feeAmount: number;
  actorId: string;
};

export type AnnualReturnRepository = {
  listCases(filters: CaseFilters): Promise<AnnualReturnCase[]>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  listCompaniesEligibleForCase(): Promise<EligibleCompanyForCase[]>;
  createCase(input: CreateAnnualReturnCaseInput): Promise<AnnualReturnCase>;
  dashboardMetrics(
```

- [ ] **Step 4: Widen `writeAuditEvent`'s `case_` parameter**

This is the only change to existing, already-shipped code in this task — a narrowing that every
existing caller already satisfies (they all pass a full, hydrated `AnnualReturnCase`, which is a
structural superset of `Pick<AnnualReturnCase, "id" | "companyId">`).

Replace:

```typescript
  async function writeAuditEvent(
    tx: TransactionSqlClient,
    input: {
      case_: AnnualReturnCase;
      companyId?: string;
      actor: AnnualReturnActionActor;
      action: AnnualReturnAction;
      summary: string;
      metadata: postgres.JSONValue;
    },
  ): Promise<void> {
```

With:

```typescript
  async function writeAuditEvent(
    tx: TransactionSqlClient,
    input: {
      case_: Pick<AnnualReturnCase, "id" | "companyId">;
      companyId?: string;
      actor: AnnualReturnActionActor;
      action: AnnualReturnAction;
      summary: string;
      metadata: postgres.JSONValue;
    },
  ): Promise<void> {
```

- [ ] **Step 5: Add `listCompaniesEligibleForCase` and `createCase`**

Replace:

```typescript
    const [case_] = await hydrateCases(rows, readToday());
    return case_ ?? null;
  }

  /**
   * `scope` is the same narrowing the board applies. Without it the tiles counted
```

With:

```typescript
    const [case_] = await hydrateCases(rows, readToday());
    return case_ ?? null;
  }

  async function listCompaniesEligibleForCase(): Promise<EligibleCompanyForCase[]> {
    const rows = await sql<EligibleCompanyRow[]>`
      select
        c.id,
        c.company_name,
        c.cr_number,
        c.annual_return_basis_date::text as annual_return_basis_date,
        c.assigned_owner_id,
        c.assigned_team_id,
        t.name as team_name
      from companies c
      join teams t on t.id = c.assigned_team_id
      where c.status = 'active'
        and not exists (
          select 1
          from annual_return_cases arc
          where arc.company_id = c.id
            and arc.return_year = extract(year from c.annual_return_basis_date)::int
        )
      order by c.company_name asc
    `;

    return rows.map((row) => ({
      id: row.id,
      companyName: row.company_name,
      crNumber: row.cr_number,
      annualReturnBasisDate: dateOnly(row.annual_return_basis_date),
      assignedOwnerId: row.assigned_owner_id,
      assignedTeamId: row.assigned_team_id,
      assignedTeamName: row.team_name,
    }));
  }

  async function createCase(input: CreateAnnualReturnCaseInput): Promise<AnnualReturnCase> {
    const caseId = await withTransaction(sql, async (tx) => {
      const actorRows = await tx<ActorRow[]>`
        select id, role, team_id, active
        from users
        where id = ${input.actorId}
        limit 1
      `;
      const [actorRow] = actorRows;
      if (!actorRow) throw new Error("Annual return actor not found.");

      const actor: AnnualReturnActionActor = {
        id: actorRow.id,
        role: actorRow.role,
        teamId: actorRow.team_id,
        active: actorRow.active,
      };

      const companyRows = await tx<CompanyForCaseRow[]>`
        select
          id, status, annual_return_basis_date::text as annual_return_basis_date, assigned_team_id
        from companies
        where id = ${input.companyId}
        for update
      `;
      const company = companyRows[0];
      if (!company || company.status !== "active") {
        throw new Error("Company not found or inactive.");
      }

      assertAnnualReturnCaseCreatable(actor, { teamId: company.assigned_team_id });

      const basisDate = dateOnly(company.annual_return_basis_date);
      const returnYear = Number(basisDate.slice(0, 4));

      const existingRows = await tx<{ id: string }[]>`
        select id from annual_return_cases
        where company_id = ${input.companyId} and return_year = ${returnYear}
        limit 1
      `;
      if (existingRows.length > 0) {
        throw new Error(`This company already has a case for ${returnYear}.`);
      }

      const templateRows = await tx<TemplateForCaseRow[]>`
        select id, active, documents
        from checklist_templates
        where id = ${input.templateId}
        limit 1
      `;
      const template = templateRows[0];
      if (!template || !template.active) {
        throw new Error("Checklist template not found or inactive.");
      }

      const filingDueDate = calculateFilingDueDate(basisDate);

      const caseRows = await tx<{ id: string }[]>`
        insert into annual_return_cases (
          company_id, return_year, made_up_date, filing_due_date, current_status, owner_id
        )
        values (
          ${input.companyId}, ${returnYear}, ${basisDate}, ${filingDueDate}, 'Upcoming', ${input.ownerId}
        )
        returning id
      `;
      const newCaseId = caseRows[0]?.id;
      if (!newCaseId) throw new Error("Annual return case was not created.");

      for (const document of template.documents) {
        const dueDate = offsetDateOnly(filingDueDate, -document.daysBeforeDue);
        await tx`
          insert into annual_return_checklist_items (case_id, item_label, required, status, due_date)
          values (${newCaseId}, ${document.label}, ${document.required}, 'Missing', ${dueDate})
        `;
      }

      await tx`
        insert into payments (company_id, case_id, invoice_number, amount, due_date)
        values (
          ${input.companyId}, ${newCaseId}, ${input.invoiceNumber}, ${input.feeAmount}, ${filingDueDate}
        )
      `;

      await ensureWorkItemForEvent(tx, {
        companyId: input.companyId,
        caseId: newCaseId,
        sourceEventKey: `annual-return:${newCaseId}:created`,
        sourceEventType: "annual_return_case_created",
        workType: "annual_return_case",
        requiredSkillKey: "annual-return",
        title: "Set up new annual return case",
        ownerId: input.ownerId,
        reviewerId: null,
        teamId: company.assigned_team_id,
      });

      await tx`
        insert into timeline_events (
          company_id, case_id, event_type, actor_type, actor_id, description, metadata
        )
        values (
          ${input.companyId}, ${newCaseId}, 'annual_return_case_created', 'user', ${input.actorId},
          'Annual return case created.',
          ${tx.json({ templateId: input.templateId, returnYear })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: { id: newCaseId, companyId: input.companyId },
        companyId: input.companyId,
        actor,
        action: "create_case",
        summary: "Annual return case created.",
        metadata: { templateId: input.templateId, returnYear },
      });

      return newCaseId;
    });

    return hydratedCaseAfterMutation(caseId, "case creation");
  }

  /**
   * `scope` is the same narrowing the board applies. Without it the tiles counted
```

- [ ] **Step 6: Add both new methods to the returned object**

Replace:

```typescript
  return {
    listCases,
    getCase,
    dashboardMetrics,
    assertCanMutateCase,
    evaluateReminders,
    assignOwner,
    listNotes,
    addNote,
    updateStatus,
    recordReminder,
    updateChecklistItem,
    updatePayment,
    updateFilingProof,
    close,
  };
}
```

With:

```typescript
  return {
    listCases,
    getCase,
    listCompaniesEligibleForCase,
    createCase,
    dashboardMetrics,
    assertCanMutateCase,
    evaluateReminders,
    assignOwner,
    listNotes,
    addNote,
    updateStatus,
    recordReminder,
    updateChecklistItem,
    updatePayment,
    updateFilingProof,
    close,
  };
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck` — expected: no errors. This confirms the new code compiles correctly
against the real schema types before writing the integration test.

- [ ] **Step 8: Write a DB-integration test**

This repo's DB-integration tests (`describe.skipIf(!databaseUrl)`) only run when
`TEST_DATABASE_URL` is set, against a migrated *and seeded* database — `db:seed` creates reference
rows this test can reuse (existing `repository.test.ts` already defines `USER_AMY_ID` and
`TEAM_ANNUAL_RETURN_ID` constants pointing at seeded rows — reuse those rather than inventing new
ones). Add this as a new `describe` block at the end of `repository.test.ts` (after the existing
`describe.skipIf(!databaseUrl)(...)` block's closing, at the top level of the file — do not nest it
inside the existing block, since it manages its own fixtures independently):

```typescript
describe.skipIf(!databaseUrl)("createCase", () => {
  const TEST_TEMPLATE_ID = "95000000-0000-0000-0000-000000000001";
  const TEST_COMPANY_ID = "96000000-0000-0000-0000-000000000001";

  afterEach(async () => {
    const sql = sqlForTests();
    // Deleted in dependency order rather than relying on cascade behavior for
    // every table — explicit and correct regardless of each FK's own ON DELETE rule.
    await sql`delete from work_items where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from timeline_events where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from annual_return_audit_events where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from payments where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from annual_return_checklist_items where case_id in (
      select id from annual_return_cases where company_id = ${TEST_COMPANY_ID}
    )`;
    await sql`delete from annual_return_cases where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from companies where id = ${TEST_COMPANY_ID}`;
    await sql`delete from checklist_templates where id = ${TEST_TEMPLATE_ID}`;
  });

  async function seedCompanyAndTemplate(basisDate: string) {
    const sql = sqlForTests();
    await sql`
      insert into companies (
        id, company_name, cr_number, br_number, incorporation_date,
        annual_return_basis_date, registered_office, company_secretary,
        status, assigned_owner_id, assigned_team_id
      ) values (
        ${TEST_COMPANY_ID}, 'Test Harbour Ltd', 'CR-CREATE-TEST', 'BR-CREATE-TEST',
        '2020-01-01', ${basisDate}, 'Test office', 'Test Secretary Ltd',
        'active', ${USER_AMY_ID}, ${TEAM_ANNUAL_RETURN_ID}
      )
      on conflict (id) do nothing
    `;
    await sql`
      insert into checklist_templates (id, name, service_type, description, active, documents, reminders, risk_rules)
      values (
        ${TEST_TEMPLATE_ID}, 'Test template', 'Annual Return — Private Ltd', '', true,
        ${sql.json([
          { id: "doc-1", label: "Signed NAR1", required: true, daysBeforeDue: 14 },
          { id: "doc-2", label: "Register extract", required: false, daysBeforeDue: 7 },
        ])},
        '[]'::jsonb, '[]'::jsonb
      )
      on conflict (id) do nothing
    `;
  }

  it(
    "creates a case with checklist items derived from the template, a payment row, and a work item",
    async () => {
      await seedCompanyAndTemplate("2026-07-01");
      const repository = repositoryFor();

      const created = await repository.createCase({
        companyId: TEST_COMPANY_ID,
        templateId: TEST_TEMPLATE_ID,
        ownerId: USER_AMY_ID,
        invoiceNumber: "INV-TEST-0001",
        feeAmount: 2800,
        actorId: USER_AMY_ID,
      });

      expect(created.companyId).toBe(TEST_COMPANY_ID);
      expect(created.returnYear).toBe(2026);
      expect(created.filingDueDate).toBe("2026-08-12");
      expect(created.currentStatus).toBe("Upcoming");
      expect(created.ownerId).toBe(USER_AMY_ID);
      expect(created.checklist).toHaveLength(2);
      expect(created.checklist.find((item) => item.itemLabel === "Signed NAR1")?.dueDate).toBe(
        "2026-07-29",
      );
      expect(created.checklist.find((item) => item.itemLabel === "Register extract")?.dueDate).toBe(
        "2026-08-05",
      );
      expect(created.payment).not.toBeNull();
      expect(created.payment?.invoiceNumber).toBe("INV-TEST-0001");
      expect(created.payment?.amount).toBe(2800);
      expect(created.payment?.status).toBe("Payment pending");

      const sql = sqlForTests();
      const workItemRows = await sql`
        select work_type, owner_id, team_id from work_items where case_id = ${created.id}
      `;
      expect(workItemRows).toHaveLength(1);
      expect(workItemRows[0]?.work_type).toBe("annual_return_case");
      expect(workItemRows[0]?.owner_id).toBe(USER_AMY_ID);
      expect(workItemRows[0]?.team_id).toBe(TEAM_ANNUAL_RETURN_ID);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects a second case for a company that already has one for its return year",
    async () => {
      await seedCompanyAndTemplate("2026-07-01");
      const repository = repositoryFor();
      await repository.createCase({
        companyId: TEST_COMPANY_ID,
        templateId: TEST_TEMPLATE_ID,
        ownerId: USER_AMY_ID,
        invoiceNumber: "INV-TEST-0002",
        feeAmount: 2800,
        actorId: USER_AMY_ID,
      });

      await expect(
        repository.createCase({
          companyId: TEST_COMPANY_ID,
          templateId: TEST_TEMPLATE_ID,
          ownerId: USER_AMY_ID,
          invoiceNumber: "INV-TEST-0003",
          feeAmount: 2800,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow("This company already has a case for 2026.");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it("rejects an inactive checklist template", async () => {
    await seedCompanyAndTemplate("2026-07-01");
    const sql = sqlForTests();
    await sql`update checklist_templates set active = false where id = ${TEST_TEMPLATE_ID}`;
    const repository = repositoryFor();

    await expect(
      repository.createCase({
        companyId: TEST_COMPANY_ID,
        templateId: TEST_TEMPLATE_ID,
        ownerId: USER_AMY_ID,
        invoiceNumber: "INV-TEST-0004",
        feeAmount: 2800,
        actorId: USER_AMY_ID,
      }),
    ).rejects.toThrow("Checklist template not found or inactive.");
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("lists the new company as eligible before creating a case, and not after", async () => {
    await seedCompanyAndTemplate("2026-09-15");
    const repository = repositoryFor();

    const beforeCreate = await repository.listCompaniesEligibleForCase();
    expect(beforeCreate.some((company) => company.id === TEST_COMPANY_ID)).toBe(true);

    await repository.createCase({
      companyId: TEST_COMPANY_ID,
      templateId: TEST_TEMPLATE_ID,
      ownerId: USER_AMY_ID,
      invoiceNumber: "INV-TEST-0005",
      feeAmount: 2800,
      actorId: USER_AMY_ID,
    });

    const afterCreate = await repository.listCompaniesEligibleForCase();
    expect(afterCreate.some((company) => company.id === TEST_COMPANY_ID)).toBe(false);
  }, INTEGRATION_TEST_TIMEOUT_MS);
});
```

**Note on placement:** this new `describe.skipIf(!databaseUrl)(...)` block goes at the very end of
`repository.test.ts`, as a sibling to the file's existing top-level `describe` block(s) — not nested
inside them. It reuses the file's existing `databaseUrl`, `sqlForTests`, `repositoryFor`,
`USER_AMY_ID`, `TEAM_ANNUAL_RETURN_ID`, and `INTEGRATION_TEST_TIMEOUT_MS` (all already defined near
the top of the file) and needs no new imports.

- [ ] **Step 9: Run the new tests**

Run: `npx vitest run src/features/annual-return/repository.test.ts`

If `TEST_DATABASE_URL` is not set in this environment, these four new tests will report as
**skipped**, not failed — that's expected and matches this repo's own established convention
(P3-6 in the roadmap already names this as a known gap: these tests only run in CI, which sets
`TEST_DATABASE_URL`). If it *is* set, expect all four to pass. Either way, run the full file and
confirm no *other* test in it broke.

- [ ] **Step 10: Commit**

```bash
git add src/features/annual-return/repository.ts src/features/annual-return/repository.test.ts
git commit -m "feat: add createCase and listCompaniesEligibleForCase to AnnualReturnRepository"
```

---

### Task 5: `annual-return/server-fns.ts` — the `*ForActor` functions and server fns

**Files:**
- Modify: `src/features/annual-return/server-fns.ts`
- Modify: `src/features/annual-return/server-fns.authorization.test.ts`

Requires Task 4 (repository methods must exist). Both new server fns route through the already-shipped
`withAnnualReturnActorRepository` wrapper — no changes needed to that wrapper or its lazy-loading
setup.

- [ ] **Step 1: Write the failing tests**

In `server-fns.authorization.test.ts`, replace:

```typescript
import {
  addAnnualReturnCaseNoteForActor,
  assignAnnualReturnCaseOwnerForActor,
  getAnnualReturnCaseForActor,
  getAnnualReturnDashboardMetricsForActor,
  listAnnualReturnCaseNotesForActor,
  queueAnnualReturnWhatsAppReminderMessageForActor,
  updateAnnualReturnChecklistItemForActor,
  updateAnnualReturnFilingProofForActor,
  updateAnnualReturnPaymentForActor,
  listAnnualReturnCasesForActor,
  updateAnnualReturnStatusForActor,
} from "./server-fns";
```

With:

```typescript
import {
  addAnnualReturnCaseNoteForActor,
  assignAnnualReturnCaseOwnerForActor,
  createAnnualReturnCaseForActor,
  getAnnualReturnCaseForActor,
  getAnnualReturnDashboardMetricsForActor,
  listAnnualReturnCaseNotesForActor,
  listCompaniesEligibleForCaseForActor,
  queueAnnualReturnWhatsAppReminderMessageForActor,
  updateAnnualReturnChecklistItemForActor,
  updateAnnualReturnFilingProofForActor,
  updateAnnualReturnPaymentForActor,
  listAnnualReturnCasesForActor,
  updateAnnualReturnStatusForActor,
} from "./server-fns";
```

Then add this new `describe` block at the end of the file (it needs a `clientActor` fixture — the
file already defines one; reuse it rather than redefining):

```typescript
describe("createAnnualReturnCaseForActor / listCompaniesEligibleForCaseForActor", () => {
  const staffActor: AuthenticatedActor = {
    authUserId: "staff-auth",
    userId: "20000000-0000-0000-0000-000000000005",
    role: "Staff",
    teamId: "10000000-0000-0000-0000-000000000001",
    active: true,
  };

  it("rejects a Client actor from creating a case", async () => {
    const createCase = vi.fn();
    const dependencies = { repository: { createCase } as unknown as AnnualReturnRepository };

    await expect(
      createAnnualReturnCaseForActor(
        clientActor,
        {
          companyId: "90000000-0000-0000-0000-000000000001",
          templateId: "95000000-0000-0000-0000-000000000001",
          ownerId: "20000000-0000-0000-0000-000000000001",
          invoiceNumber: "INV-1",
          feeAmount: 2800,
        },
        dependencies,
      ),
    ).rejects.toThrow(/staff access is required/i);
    expect(createCase).not.toHaveBeenCalled();
  });

  it("passes validated data and the resolved actorId through to the repository", async () => {
    const createCase = vi.fn(async (input: unknown) => input);
    const dependencies = { repository: { createCase } as unknown as AnnualReturnRepository };

    await createAnnualReturnCaseForActor(
      staffActor,
      {
        companyId: "90000000-0000-0000-0000-000000000001",
        templateId: "95000000-0000-0000-0000-000000000001",
        ownerId: "20000000-0000-0000-0000-000000000001",
        invoiceNumber: "INV-1",
        feeAmount: 2800,
      },
      dependencies,
    );

    expect(createCase).toHaveBeenCalledWith({
      companyId: "90000000-0000-0000-0000-000000000001",
      templateId: "95000000-0000-0000-0000-000000000001",
      ownerId: "20000000-0000-0000-0000-000000000001",
      invoiceNumber: "INV-1",
      feeAmount: 2800,
      actorId: staffActor.userId,
    });
  });

  it("rejects a Client actor from listing eligible companies", async () => {
    const listCompaniesEligibleForCase = vi.fn();
    const dependencies = {
      repository: { listCompaniesEligibleForCase } as unknown as AnnualReturnRepository,
    };

    await expect(
      listCompaniesEligibleForCaseForActor(clientActor, {}, dependencies),
    ).rejects.toThrow(/staff access is required/i);
    expect(listCompaniesEligibleForCase).not.toHaveBeenCalled();
  });

  it("lets a staff actor list eligible companies", async () => {
    const listCompaniesEligibleForCase = vi.fn(async () => []);
    const dependencies = {
      repository: { listCompaniesEligibleForCase } as unknown as AnnualReturnRepository,
    };

    await listCompaniesEligibleForCaseForActor(staffActor, {}, dependencies);

    expect(listCompaniesEligibleForCase).toHaveBeenCalledOnce();
  });
});
```

`server-fns.authorization.test.ts` already imports `vi` from `"vitest"`, already imports
`type { AnnualReturnRepository } from "./repository"`, and already defines a
`clientActor: AuthenticatedActor` near the top (confirmed by reading the file directly) — the new
test block above needs no new imports beyond the one `server-fns` import replacement in this step;
just reuse `clientActor` as-is.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/annual-return/server-fns.authorization.test.ts`
Expected: FAIL — `createAnnualReturnCaseForActor`/`listCompaniesEligibleForCaseForActor` don't exist
yet.

- [ ] **Step 3: Implement**

Replace:

```typescript
const updatePaymentSchema = z
  .object({
    caseId: z.string().uuid(),
    status: z.enum(PAYMENT_STATUSES),
    paymentProofDocumentId: z.string().uuid().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "Payment received" && !data.paymentProofDocumentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentProofDocumentId"],
        message: "paymentProofDocumentId is required when payment is received.",
      });
    }
  });

export type AnnualReturnCaseCommandDependencies = {
  repository: AnnualReturnRepository;
};
```

With:

```typescript
const updatePaymentSchema = z
  .object({
    caseId: z.string().uuid(),
    status: z.enum(PAYMENT_STATUSES),
    paymentProofDocumentId: z.string().uuid().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "Payment received" && !data.paymentProofDocumentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentProofDocumentId"],
        message: "paymentProofDocumentId is required when payment is received.",
      });
    }
  });

const createAnnualReturnCaseSchema = z
  .object({
    companyId: z.string().uuid(),
    templateId: z.string().uuid(),
    ownerId: z.string().uuid(),
    invoiceNumber: z.string().trim().min(1),
    feeAmount: z.number().int().positive(),
  })
  .strict();

export type AnnualReturnCaseCommandDependencies = {
  repository: AnnualReturnRepository;
};
```

Then replace:

```typescript
import type { AnnualReturnRepository, CaseFilters } from "./repository";
```

With:

```typescript
import type { AnnualReturnRepository, CaseFilters, EligibleCompanyForCase } from "./repository";
```

Then replace:

```typescript
function boardActorFrom(actor: AuthenticatedActor) {
  return { id: actor.userId, role: actor.role, teamId: actor.teamId, active: actor.active };
}
```

With:

```typescript
function boardActorFrom(actor: AuthenticatedActor) {
  return { id: actor.userId, role: actor.role, teamId: actor.teamId, active: actor.active };
}

export async function listCompaniesEligibleForCaseForActor(
  actor: AuthenticatedActor,
  _input: Record<string, never>,
  dependencies: { repository: Pick<AnnualReturnRepository, "listCompaniesEligibleForCase"> },
): Promise<EligibleCompanyForCase[]> {
  requireStaffUserId(actor);
  return dependencies.repository.listCompaniesEligibleForCase();
}

export async function createAnnualReturnCaseForActor(
  actor: AuthenticatedActor,
  input: {
    companyId: string;
    templateId: string;
    ownerId: string;
    invoiceNumber: string;
    feeAmount: number;
  },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = createAnnualReturnCaseSchema.parse(input);
  return dependencies.repository.createCase({
    ...data,
    actorId: requireStaffUserId(actor),
  });
}
```

Then replace:

```typescript
export const getAnnualReturnDashboardMetrics = createServerFn({ method: "GET" }).handler(async () =>
  withAnnualReturnActorRepository((repository, actor) =>
    getAnnualReturnDashboardMetricsForActor(actor, { repository }),
  ),
);
```

With:

```typescript
export const getAnnualReturnDashboardMetrics = createServerFn({ method: "GET" }).handler(async () =>
  withAnnualReturnActorRepository((repository, actor) =>
    getAnnualReturnDashboardMetricsForActor(actor, { repository }),
  ),
);

export const listCompaniesEligibleForCase = createServerFn({ method: "GET" }).handler(() =>
  withAnnualReturnActorRepository((repository, actor) =>
    listCompaniesEligibleForCaseForActor(actor, {}, { repository }),
  ),
);

export const createAnnualReturnCase = createServerFn({ method: "POST" })
  .validator(createAnnualReturnCaseSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      createAnnualReturnCaseForActor(actor, data, { repository }),
    ),
  );
```

- [ ] **Step 4: Typecheck and run the tests**

Run: `npm run typecheck` — expected: no errors.
Run: `npx vitest run src/features/annual-return/server-fns.authorization.test.ts src/features/annual-return/server-fns.test.ts` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/server-fns.ts src/features/annual-return/server-fns.authorization.test.ts
git commit -m "feat: add createAnnualReturnCase and listCompaniesEligibleForCase server fns"
```

---

### Task 6: `create-case-dialog.tsx` — the new UI component

**Files:**
- Create: `src/features/annual-return/components/create-case-dialog.tsx`

Requires Task 3 (`ActiveChecklistTemplateSummary` type) and Task 5 (`createAnnualReturnCase` server
fn). Mirrors `src/components/clients/client-form-dialog.tsx`'s shape exactly: plain `useState` form
state (no react-hook-form, no TanStack Query mutation), a `saving` boolean disabling the submit
button, `sonner`'s `toast` for success/failure, `onOpenChange(false)` on success.

- [ ] **Step 1: Create the file**

```typescript
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActiveChecklistTemplateSummary } from "@/features/checklist-templates/server-fns";
import type { ClientAssignmentOptions } from "@/features/clients/types";
import { createAnnualReturnCase } from "../server-fns";
import type { EligibleCompanyForCase } from "../repository";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: EligibleCompanyForCase[];
  templates: ActiveChecklistTemplateSummary[];
  owners: ClientAssignmentOptions["owners"];
  onCreated: (caseId: string) => void;
};

type FormState = {
  companyId: string;
  templateId: string;
  ownerId: string;
  invoiceNumber: string;
  feeAmount: string;
};

function emptyForm(
  companies: EligibleCompanyForCase[],
  templates: ActiveChecklistTemplateSummary[],
): FormState {
  const firstCompany = companies[0];
  return {
    companyId: firstCompany?.id ?? "",
    templateId: templates[0]?.id ?? "",
    ownerId: firstCompany?.assignedOwnerId ?? "",
    invoiceNumber: "",
    feeAmount: "",
  };
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none";
const labelClass = "text-[10px] uppercase tracking-wider text-muted-foreground";

export function CreateCaseDialog({
  open,
  onOpenChange,
  companies,
  templates,
  owners,
  onCreated,
}: Props) {
  const [form, setForm] = useState<FormState>(() => emptyForm(companies, templates));
  const [saving, setSaving] = useState(false);

  // Only re-derive when the dialog transitions open, not on every companies/templates
  // refetch while it's already open — that would blow away whatever the user is
  // mid-filling-in.
  useEffect(() => {
    if (open) {
      setForm(emptyForm(companies, templates));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === form.companyId),
    [companies, form.companyId],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function selectCompany(companyId: string) {
    const company = companies.find((candidate) => candidate.id === companyId);
    setForm((current) => ({
      ...current,
      companyId,
      ownerId: company?.assignedOwnerId ?? current.ownerId,
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      const created = await createAnnualReturnCase({
        data: {
          companyId: form.companyId,
          templateId: form.templateId,
          ownerId: form.ownerId,
          invoiceNumber: form.invoiceNumber,
          feeAmount: Number(form.feeAmount),
        },
      });
      toast.success("Annual return case created.");
      onCreated(created.id);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create the case.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New case</DialogTitle>
          <DialogDescription>
            Create an annual return case for a company that doesn't have one yet this year.
          </DialogDescription>
        </DialogHeader>

        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No companies are eligible for a new case right now — every active company already has
            one for its current return year.
          </p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active checklist templates exist yet. Ask an Admin to configure one under Settings
            before creating a case.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="case-company">
                Company
              </label>
              <select
                id="case-company"
                className={inputClass}
                value={form.companyId}
                onChange={(event) => selectCompany(event.target.value)}
                required
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.companyName} ({company.crNumber})
                  </option>
                ))}
              </select>
              {selectedCompany ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Basis date {selectedCompany.annualReturnBasisDate} · Team{" "}
                  {selectedCompany.assignedTeamName}
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelClass} htmlFor="case-template">
                Checklist template
              </label>
              <select
                id="case-template"
                className={inputClass}
                value={form.templateId}
                onChange={(event) => set("templateId", event.target.value)}
                required
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} — {template.serviceType}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="case-owner">
                Owner
              </label>
              <select
                id="case-owner"
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="case-invoice">
                  Invoice number
                </label>
                <input
                  id="case-invoice"
                  className={inputClass}
                  value={form.invoiceNumber}
                  onChange={(event) => set("invoiceNumber", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="case-fee">
                  Fee (HKD)
                </label>
                <input
                  id="case-fee"
                  type="number"
                  min="1"
                  step="1"
                  className={inputClass}
                  value={form.feeAmount}
                  onChange={(event) => set("feeAmount", event.target.value)}
                  required
                />
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
                disabled={saving}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? "Creating…" : "Create case"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — expected: no errors. (No dedicated unit test for this component — it's
exercised via the route-level test in Task 7, matching how `client-form-dialog.tsx` has no dedicated
test file either.)

- [ ] **Step 3: Commit**

```bash
git add src/features/annual-return/components/create-case-dialog.tsx
git commit -m "feat: add the New case dialog component"
```

---

### Task 7: Wire the dialog into the production command center

**Files:**
- Modify: `src/features/annual-return/components/production-command-center.tsx`
- Modify: `src/routes/-annual-returns-data-mode.test.tsx`

Requires Task 6.

- [ ] **Step 1: Update imports**

Replace:

```typescript
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { listWorkQueue } from "@/features/work-items/server-fns";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { boardFiltersFromSearch, type AnnualReturnBoardSearch } from "../board-filters";
import { boardMetrics } from "../board-metrics";
import { annualReturnQueryKeys } from "../query-keys";
import { listAnnualReturnCases } from "../server-fns";
import {
  ANNUAL_RETURN_STATUSES,
  type AnnualReturnCase,
  type AnnualReturnStatus,
  type RiskLevel,
} from "../types";
import { daysBetween, hongKongBusinessDate } from "../workflow";
```

With:

```typescript
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { listActiveAnnualReturnTemplates } from "@/features/checklist-templates/server-fns";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";
import { listWorkQueue } from "@/features/work-items/server-fns";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { boardFiltersFromSearch, type AnnualReturnBoardSearch } from "../board-filters";
import { boardMetrics } from "../board-metrics";
import { annualReturnQueryKeys } from "../query-keys";
import { listAnnualReturnCases, listCompaniesEligibleForCase } from "../server-fns";
import {
  ANNUAL_RETURN_STATUSES,
  type AnnualReturnCase,
  type AnnualReturnStatus,
  type RiskLevel,
} from "../types";
import { daysBetween, hongKongBusinessDate } from "../workflow";
import { CreateCaseDialog } from "./create-case-dialog";
```

- [ ] **Step 2: Add dialog state and its data queries**

Replace:

```typescript
  const today = hongKongBusinessDate();

  const filters = boardFiltersFromSearch(search, BOARD_PAGE_SIZE);

  const casesQuery = useQuery({
    queryKey: annualReturnQueryKeys.list(filters),
    queryFn: () => listAnnualReturnCases({ data: filters }),
    retry: false,
  });
```

With:

```typescript
  const today = hongKongBusinessDate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const filters = boardFiltersFromSearch(search, BOARD_PAGE_SIZE);

  const casesQuery = useQuery({
    queryKey: annualReturnQueryKeys.list(filters),
    queryFn: () => listAnnualReturnCases({ data: filters }),
    retry: false,
  });

  // Only fetched once the dialog is actually open — these are cheap reads, but
  // there is no reason to fire them on every board load when most visits never
  // open the dialog at all.
  const eligibleCompaniesQuery = useQuery({
    queryKey: ["annual-returns", "eligible-companies"],
    queryFn: () => listCompaniesEligibleForCase(),
    enabled: isCreateOpen,
  });

  const activeTemplatesQuery = useQuery({
    queryKey: ["checklist-templates", "active-annual-return"],
    queryFn: () => listActiveAnnualReturnTemplates(),
    enabled: isCreateOpen,
  });

  const assignmentOptionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    enabled: isCreateOpen,
  });
```

- [ ] **Step 3: Add the button and the dialog**

Replace:

```typescript
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
```

With:

```typescript
      <PageHeader
        eyebrow="Operations"
        title="Annual returns"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              New case
            </button>
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
          </div>
        }
      />

      <CreateCaseDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        companies={eligibleCompaniesQuery.data ?? []}
        templates={activeTemplatesQuery.data ?? []}
        owners={assignmentOptionsQuery.data?.owners ?? []}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
        }}
      />
```

- [ ] **Step 4: Extend the route-level test**

In `src/routes/-annual-returns-data-mode.test.tsx`, replace:

```typescript
  it("renders the demo board at /annual-returns in demo mode", async () => {
    const html = await renderRoute("/annual-returns", "demo");

    expect(html).toContain("Search company or contact");
    expect(html).toContain("Delta Bloom Ventures Limited");
  });
});
```

With:

```typescript
  it("renders the demo board at /annual-returns in demo mode", async () => {
    const html = await renderRoute("/annual-returns", "demo");

    expect(html).toContain("Search company or contact");
    expect(html).toContain("Delta Bloom Ventures Limited");
  });

  it("shows the New case action in production mode", async () => {
    const html = await renderRoute("/annual-returns", "production");

    expect(html).toContain("New case");
  });

  it("shows no New case action in demo mode", async () => {
    const html = await renderRoute("/annual-returns", "demo");

    expect(html).not.toContain("New case");
  });
});
```

These two new tests only assert the button's presence/absence — the dialog's own `open={false}`
default means none of its internal form content renders into this SSR-only harness (matching how
every other test in this file already works), so the three new data queries (all `enabled: false`
until the dialog opens) never fire and need no mocking here.

- [ ] **Step 5: Typecheck and run the tests**

Run: `npm run typecheck` — expected: no errors.
Run: `npx vitest run src/routes/-annual-returns-data-mode.test.tsx` — expected: all pass, including
the two new tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/annual-return/components/production-command-center.tsx src/routes/-annual-returns-data-mode.test.tsx
git commit -m "feat: wire the New case dialog into the production command center"
```

---

### Task 8: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck, lint, and test suite**

Run: `npm run typecheck` — expected: no errors.
Run: `npm run lint` — expected: no errors.
Run: `npm run test` — expected: full suite passes with the same skip count as before this branch
(the 4 new `describe.skipIf` integration tests from Task 4 either run or skip together with the rest
of that convention — they should not report as failed either way), and strictly more passing tests
than before (the new mocked-repository unit tests from Tasks 2, 3, 5 always run regardless of
`TEST_DATABASE_URL`).

- [ ] **Step 2: Build still passes**

Run: `npm run build` — expected: exit 0.

- [ ] **Step 3: Manual browser smoke test (demo mode only — see note)**

**Note on scope:** `resolveDataMode` (`src/features/runtime/data-mode.ts`) only returns `"production"`
when `VITE_ENABLE_DEMO_AUTH` is *not* `"true"` — and without demo auth, reaching any page requires
signing in through real Neon Auth (Google OAuth or magic link), which needs live credentials this
environment does not have (the same known, pre-existing limitation as the "Verify Google/Neon Auth
round trip" task — not something to work around here). So this manual step covers demo mode only;
production-mode rendering of the button and dialog is verified by Task 7's automated route-level
test instead, not a live browser check. Do not claim the production-mode UI was manually verified —
say plainly that it wasn't, and that the automated test is what covers it.

Start the dev server: `VITE_ENABLE_DEMO_AUTH=true npm run dev -- --port 5173`

Using the browser tool, sign in as the Admin demo identity and visit `/annual-returns` (this renders
in demo mode) and confirm:
- No "New case" button appears anywhere on the board (matching acceptance criterion 4).
- The board otherwise renders exactly as it did before this branch — no console errors, no visual
  regression from the `useState`/`useQueryClient` additions to `production-command-center.tsx`
  (that file's demo-mode sibling, `DemoAnnualReturnCommandCenter` in `annual-returns.tsx`, is
  untouched by this plan, but confirm the shared route shell around it still renders correctly).

- [ ] **Step 4: Update the roadmap memory**

Update
`C:\Users\laich\.claude\projects\C--Users-laich-Documents-kossilon-hub\memory\project_kossilon_hub_roadmap_status.md`
to note P1-1 is done on branch `codex/annual-return-case-creation`, closing the roadmap's #1 GA
blocker, and that P1-1's own completion now unblocks nothing further by itself (P1-3's UI and P1-4's
generalization remain separate, already-identified roadmap items).

- [ ] **Step 5: Proceed to `superpowers:finishing-a-development-branch`**

All tasks complete and verified — hand off to that skill to decide how to land this branch (merge
locally / push + PR / keep as-is / discard).
