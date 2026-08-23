# P1-9: Ad hoc corporate change requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `corporate_change_requests` case type covering name change, share transfer, officer appointment/resignation/detail-change, and registered-office address change — each separately quoted, tracked through a fixed checklist, wired into the existing `work_items`/SLA engine, and auto-applying the real underlying data mutation on completion.

**Architecture:** One new feature module (`src/features/corporate-changes/`) with its own Postgres-backed repository (raw SQL via `postgres`, no ORM — matches every other feature), reusing `clients/repository.ts`'s `appointOfficer`/`ceaseOfficer`/`recordShareholding` (plus one new `updateOfficerDetails` function added there) via dependency-injected transaction sharing. `work_items`/`sla_policies` are extended exactly the way migration 0014's own comment specified for the next case type. Two new top-level routes (`/corporate-changes`, `/corporate-changes/$id`) mirror the incorporation-intake feature's structure exactly.

**Tech Stack:** TanStack Start 1.x + TanStack Router, React 19, TypeScript 5.8 strict, Postgres via `postgres` (tagged-template SQL, no ORM), Zod 3, Vitest 4, shadcn/ui.

**Design spec:** `docs/superpowers/specs/2026-08-23-corporate-change-requests-design.md`

---

## Naming note (implementation refinement, not a scope change)

The spec calls the work-item case type `'corporate_change'`. During planning, the existing `annual_return`/`annual_return_case` precedent showed `work_items.case_type` and the SLA-lookup `work_type` are two *different* strings (`annual_return` vs `annual_return_case`). For clarity and consistency with that precedent, this plan uses:
- `work_items.case_type` value: `'corporate_change_request'`
- `sla_policies.work_type` / `ensureWorkItemForEvent`'s `workType`: `'corporate_change_request'`
- `corporate_change_requests.change_type` (the four ad hoc sub-types): `'name_change' | 'share_transfer' | 'officer_change' | 'address_change'` — unchanged from the spec.

---

### Task 1: Migration 0019 — `corporate_change_requests` and `corporate_change_checklist_items`

**Files:**
- Create: `db/migrations/0019_corporate_change_requests.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0019: ad hoc corporate change requests (P1-9).
--
-- Four separately-quoted one-off services the firm already sells (Q8 of the Q&A):
-- company name change, share transfer (with stamp duty), officer
-- appointment/resignation/detail-change, and registered-office address change.
-- One table with a change_type discriminator, mirroring how officers.officer_type
-- and significant_controllers cover multiple sub-kinds in one table. Unlike
-- incorporation_cases (0017), every request here operates on an ALREADY-EXISTING
-- company, so it can join the work_items/SLA engine directly — see 0020.

create table corporate_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  change_type text not null check (change_type in (
    'name_change', 'share_transfer', 'officer_change', 'address_change'
  )),
  status text not null default 'Requested' check (status in (
    'Requested', 'Documents pending', 'Ready to file', 'Filed with Registrar', 'Completed', 'Cancelled'
  )),
  owner_id uuid not null references users(id),
  quoted_fee numeric(10, 2) not null check (quoted_fee >= 0),

  -- name_change fields
  current_name_en text,
  current_name_zh text,
  new_name_en text,
  new_name_zh text,

  -- share_transfer fields
  transferor_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_new_shareholder_name text,
  transferee_new_shareholder_address text,
  shares_transferred integer check (shares_transferred > 0),
  consideration numeric(12, 2),
  stamp_duty_amount numeric(10, 2),

  -- officer_change fields
  officer_id uuid references officers(id) on delete restrict,
  officer_action text check (officer_action in ('appoint', 'resign', 'detail_change')),
  new_officer_type text check (new_officer_type in ('director', 'secretary')),
  new_officer_name text,
  new_officer_identification_type text check (new_officer_identification_type in ('hkid', 'passport', 'br_number')),
  new_officer_identification_number text,
  new_officer_address text,
  effective_date date,

  -- address_change fields
  current_registered_office text,
  new_registered_office text,

  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint corporate_change_requests_completed_has_timestamp check (
    (status = 'Completed') = (completed_at is not null)
  ),
  constraint corporate_change_requests_type_fields_check check (
    (change_type = 'name_change' and new_name_en is not null)
    or (
      change_type = 'share_transfer'
      and transferor_shareholding_id is not null
      and shares_transferred is not null
      and consideration is not null
      and stamp_duty_amount is not null
      and (transferee_shareholding_id is not null) <> (transferee_new_shareholder_name is not null)
    )
    or (
      change_type = 'officer_change'
      and officer_action is not null
      and (
        (officer_action = 'appoint' and officer_id is null and new_officer_type is not null and new_officer_name is not null)
        or (officer_action = 'resign' and officer_id is not null)
        or (officer_action = 'detail_change' and officer_id is not null)
      )
    )
    or (change_type = 'address_change' and new_registered_office is not null)
  )
);

create index corporate_change_requests_company_idx on corporate_change_requests (company_id);
create index corporate_change_requests_status_idx on corporate_change_requests (status);
create index corporate_change_requests_change_type_idx on corporate_change_requests (change_type);

create table corporate_change_checklist_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references corporate_change_requests(id) on delete cascade,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'Missing' check (status in ('Missing', 'Received', 'Verified', 'Rejected')),
  note text,
  received_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index corporate_change_checklist_items_request_idx on corporate_change_checklist_items (request_id);
```

- [ ] **Step 2: Apply the migration locally to confirm it runs cleanly**

Run: `npm run db:migrate`
Expected: no errors; migration `0019_corporate_change_requests.sql` reported as applied.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0019_corporate_change_requests.sql
git commit -m "feat: add corporate_change_requests and checklist tables"
```

---

### Task 2: Migration 0020 — extend `work_items` for the `corporate_change_request` case type

**Files:**
- Create: `db/migrations/0020_corporate_change_work_items.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0020: extend work_items for the corporate_change_request case type (P1-9).
--
-- Per 0014's own comment: a future case type adds its own nullable FK column and
-- extends the two CHECK constraints below, in its own migration.

alter table work_items add column corporate_change_request_id uuid
  references corporate_change_requests(id) on delete restrict;

alter table work_items drop constraint work_items_case_type_check;
alter table work_items add constraint work_items_case_type_check
  check (case_type in ('annual_return', 'corporate_change_request'));

alter table work_items drop constraint work_items_case_reference_check;
alter table work_items add constraint work_items_case_reference_check
  check (
    (case_type = 'annual_return' and annual_return_case_id is not null and corporate_change_request_id is null)
    or (case_type = 'corporate_change_request' and corporate_change_request_id is not null and annual_return_case_id is null)
  );
```

- [ ] **Step 2: Apply the migration locally**

Run: `npm run db:migrate`
Expected: no errors; migration `0020_corporate_change_work_items.sql` reported as applied.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0020_corporate_change_work_items.sql
git commit -m "feat: extend work_items for corporate_change_request case type"
```

---

### Task 3: Update `src/server/db/schema.sql` to match the new cumulative schema

**Files:**
- Modify: `src/server/db/schema.sql:301-333` (the `work_items` table block)
- Modify: `src/server/db/schema.sql` (append new tables after the `incorporation_checklist_items` block, or after the last table in the file — find the actual end of the file first)

- [ ] **Step 1: Update the `work_items` table block**

At `src/server/db/schema.sql:301`, change:
```sql
  case_type text not null check (case_type in ('annual_return')),
  annual_return_case_id uuid references annual_return_cases(id) on delete restrict,
```
to:
```sql
  case_type text not null check (case_type in ('annual_return', 'corporate_change_request')),
  annual_return_case_id uuid references annual_return_cases(id) on delete restrict,
  corporate_change_request_id uuid references corporate_change_requests(id) on delete restrict,
```

At `src/server/db/schema.sql:333`, change:
```sql
    case_type <> 'annual_return' or annual_return_case_id is not null
```
to:
```sql
    (case_type = 'annual_return' and annual_return_case_id is not null and corporate_change_request_id is null)
    or (case_type = 'corporate_change_request' and corporate_change_request_id is not null and annual_return_case_id is null)
```

- [ ] **Step 2: Append the two new tables**

Add this block after the `incorporation_checklist_items` table definition (the schema.sql file mirrors migration order, so this belongs right before the `0018_recurring_service_subscriptions.sql` content, or at the very end if 0018's tables are already the last block — find the exact insertion point by locating the last `create table` block in the file and appending after it):

```sql
create table corporate_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  change_type text not null check (change_type in (
    'name_change', 'share_transfer', 'officer_change', 'address_change'
  )),
  status text not null default 'Requested' check (status in (
    'Requested', 'Documents pending', 'Ready to file', 'Filed with Registrar', 'Completed', 'Cancelled'
  )),
  owner_id uuid not null references users(id),
  quoted_fee numeric(10, 2) not null check (quoted_fee >= 0),
  current_name_en text,
  current_name_zh text,
  new_name_en text,
  new_name_zh text,
  transferor_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_shareholding_id uuid references shareholdings(id) on delete restrict,
  transferee_new_shareholder_name text,
  transferee_new_shareholder_address text,
  shares_transferred integer check (shares_transferred > 0),
  consideration numeric(12, 2),
  stamp_duty_amount numeric(10, 2),
  officer_id uuid references officers(id) on delete restrict,
  officer_action text check (officer_action in ('appoint', 'resign', 'detail_change')),
  new_officer_type text check (new_officer_type in ('director', 'secretary')),
  new_officer_name text,
  new_officer_identification_type text check (new_officer_identification_type in ('hkid', 'passport', 'br_number')),
  new_officer_identification_number text,
  new_officer_address text,
  effective_date date,
  current_registered_office text,
  new_registered_office text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corporate_change_requests_completed_has_timestamp check (
    (status = 'Completed') = (completed_at is not null)
  ),
  constraint corporate_change_requests_type_fields_check check (
    (change_type = 'name_change' and new_name_en is not null)
    or (
      change_type = 'share_transfer'
      and transferor_shareholding_id is not null
      and shares_transferred is not null
      and consideration is not null
      and stamp_duty_amount is not null
      and (transferee_shareholding_id is not null) <> (transferee_new_shareholder_name is not null)
    )
    or (
      change_type = 'officer_change'
      and officer_action is not null
      and (
        (officer_action = 'appoint' and officer_id is null and new_officer_type is not null and new_officer_name is not null)
        or (officer_action = 'resign' and officer_id is not null)
        or (officer_action = 'detail_change' and officer_id is not null)
      )
    )
    or (change_type = 'address_change' and new_registered_office is not null)
  )
);

create index corporate_change_requests_company_idx on corporate_change_requests (company_id);
create index corporate_change_requests_status_idx on corporate_change_requests (status);
create index corporate_change_requests_change_type_idx on corporate_change_requests (change_type);

create table corporate_change_checklist_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references corporate_change_requests(id) on delete cascade,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'Missing' check (status in ('Missing', 'Received', 'Verified', 'Rejected')),
  note text,
  received_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index corporate_change_checklist_items_request_idx on corporate_change_checklist_items (request_id);
```

- [ ] **Step 3: Run `npm run verify:firm -- --dry-run` to confirm the schema/migration gate still passes**

Run: `npm run verify:firm -- --dry-run`
Expected: PASS (no reported schema/migration drift).

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.sql
git commit -m "docs: sync schema.sql with corporate change request migrations"
```

---

### Task 4: `src/features/corporate-changes/types.ts`

**Files:**
- Create: `src/features/corporate-changes/types.ts`
- Test: `src/features/corporate-changes/workflow.test.ts` (written in Task 5 alongside `workflow.ts`, which imports these types)

- [ ] **Step 1: Write the types file**

```ts
export const CORPORATE_CHANGE_TYPES = [
  "name_change",
  "share_transfer",
  "officer_change",
  "address_change",
] as const;

export type CorporateChangeType = (typeof CORPORATE_CHANGE_TYPES)[number];

export const CORPORATE_CHANGE_STATUSES = [
  "Requested",
  "Documents pending",
  "Ready to file",
  "Filed with Registrar",
  "Completed",
  "Cancelled",
] as const;

export type CorporateChangeStatus = (typeof CORPORATE_CHANGE_STATUSES)[number];

export type ChecklistItemStatus = "Missing" | "Received" | "Verified" | "Rejected";

export type CorporateChangeChecklistItem = {
  id: string;
  requestId: string;
  itemLabel: string;
  required: boolean;
  status: ChecklistItemStatus;
  note: string | null;
  receivedAt: string | null;
  verifiedAt: string | null;
};

export type IdentificationType = "hkid" | "passport" | "br_number";
export type OfficerAction = "appoint" | "resign" | "detail_change";
export type NewOfficerType = "director" | "secretary";

export type CorporateChangeRequest = {
  id: string;
  companyId: string;
  changeType: CorporateChangeType;
  status: CorporateChangeStatus;
  ownerId: string;
  quotedFee: number;

  currentNameEn: string | null;
  currentNameZh: string | null;
  newNameEn: string | null;
  newNameZh: string | null;

  transferorShareholdingId: string | null;
  transfereeShareholdingId: string | null;
  transfereeNewShareholderName: string | null;
  transfereeNewShareholderAddress: string | null;
  sharesTransferred: number | null;
  consideration: number | null;
  stampDutyAmount: number | null;

  officerId: string | null;
  officerAction: OfficerAction | null;
  newOfficerType: NewOfficerType | null;
  newOfficerName: string | null;
  newOfficerIdentificationType: IdentificationType | null;
  newOfficerIdentificationNumber: string | null;
  newOfficerAddress: string | null;
  effectiveDate: string | null;

  currentRegisteredOffice: string | null;
  newRegisteredOffice: string | null;

  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CorporateChangeRequestDetail = CorporateChangeRequest & {
  checklistItems: CorporateChangeChecklistItem[];
};

export type CorporateChangeRequestSummary = Pick<
  CorporateChangeRequest,
  "id" | "companyId" | "changeType" | "status" | "ownerId" | "quotedFee" | "createdAt"
> & {
  companyName: string;
};

export type CreateNameChangeInput = {
  companyId: string;
  quotedFee: number;
  newNameEn: string;
  newNameZh: string | null;
  actorId: string;
};

export type CreateShareTransferInput = {
  companyId: string;
  quotedFee: number;
  transferorShareholdingId: string;
  sharesTransferred: number;
  consideration: number;
  stampDutyAmount: number;
  transfereeShareholdingId: string | null;
  transfereeNewShareholderName: string | null;
  transfereeNewShareholderAddress: string | null;
  actorId: string;
};

export type CreateOfficerChangeInput = {
  companyId: string;
  quotedFee: number;
  officerAction: OfficerAction;
  officerId: string | null;
  newOfficerType: NewOfficerType | null;
  newOfficerName: string | null;
  newOfficerIdentificationType: IdentificationType | null;
  newOfficerIdentificationNumber: string | null;
  newOfficerAddress: string | null;
  effectiveDate: string;
  actorId: string;
};

export type CreateAddressChangeInput = {
  companyId: string;
  quotedFee: number;
  newRegisteredOffice: string;
  actorId: string;
};

export type CreateCorporateChangeRequestInput =
  | ({ changeType: "name_change" } & CreateNameChangeInput)
  | ({ changeType: "share_transfer" } & CreateShareTransferInput)
  | ({ changeType: "officer_change" } & CreateOfficerChangeInput)
  | ({ changeType: "address_change" } & CreateAddressChangeInput);

export type UpdateChecklistItemStatusInput = {
  requestId: string;
  itemId: string;
  status: ChecklistItemStatus;
  note: string | null;
  actorId: string;
};

export type TransitionStatusInput = {
  requestId: string;
  toStatus: CorporateChangeStatus;
  actorId: string;
};

export type CancelRequestInput = {
  requestId: string;
  actorId: string;
};

export type CompleteRequestInput = {
  requestId: string;
  actorId: string;
};

export type ListCorporateChangeRequestsFilter = {
  changeType?: CorporateChangeType;
  status?: CorporateChangeStatus;
  teamId?: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/features/corporate-changes/types.ts
git commit -m "feat: add corporate change request types"
```

---

### Task 5: `src/features/corporate-changes/workflow.ts` — status transitions and checklist content

**Files:**
- Create: `src/features/corporate-changes/workflow.ts`
- Test: `src/features/corporate-changes/workflow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { checklistLabelsFor, isAllowedCorporateChangeStatusTransition } from "./workflow";

describe("isAllowedCorporateChangeStatusTransition", () => {
  it("allows moving forward one step in the lifecycle", () => {
    expect(isAllowedCorporateChangeStatusTransition("Requested", "Documents pending")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Documents pending", "Ready to file")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Ready to file", "Filed with Registrar")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Filed with Registrar", "Completed")).toBe(true);
  });

  it("rejects skipping a step", () => {
    expect(isAllowedCorporateChangeStatusTransition("Requested", "Ready to file")).toBe(false);
  });

  it("rejects moving backward", () => {
    expect(isAllowedCorporateChangeStatusTransition("Ready to file", "Requested")).toBe(false);
  });

  it("allows cancelling from any non-terminal status", () => {
    expect(isAllowedCorporateChangeStatusTransition("Requested", "Cancelled")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Documents pending", "Cancelled")).toBe(true);
    expect(isAllowedCorporateChangeStatusTransition("Filed with Registrar", "Cancelled")).toBe(true);
  });

  it("rejects cancelling a terminal request", () => {
    expect(isAllowedCorporateChangeStatusTransition("Completed", "Cancelled")).toBe(false);
    expect(isAllowedCorporateChangeStatusTransition("Cancelled", "Cancelled")).toBe(false);
  });
});

describe("checklistLabelsFor", () => {
  it("returns the fixed name_change document set", () => {
    expect(checklistLabelsFor("name_change")).toEqual([
      "Special resolution approving new name",
      "NNC2 form",
      "Updated Business Registration certificate",
      "Certificate of Change of Name",
    ]);
  });

  it("returns the fixed share_transfer document set", () => {
    expect(checklistLabelsFor("share_transfer")).toEqual([
      "Bought & Sold Note",
      "Instrument of Transfer",
      "Transferee ID/address proof",
      "Stamp duty payment receipt",
      "Updated register of members",
    ]);
  });

  it("returns the fixed officer_change document set", () => {
    expect(checklistLabelsFor("officer_change")).toEqual([
      "ND2A/ND2B form",
      "New officer's ID/address proof",
      "Updated register of directors and secretaries",
    ]);
  });

  it("returns the fixed address_change document set", () => {
    expect(checklistLabelsFor("address_change")).toEqual([
      "NR1 form",
      "Proof of new address",
      "Updated Business Registration certificate",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/corporate-changes/workflow.test.ts`
Expected: FAIL with "Cannot find module './workflow'"

- [ ] **Step 3: Write the implementation**

```ts
import type { CorporateChangeStatus, CorporateChangeType } from "./types";
import { CORPORATE_CHANGE_STATUSES } from "./types";

const FORWARD_ONLY_STATUSES: readonly CorporateChangeStatus[] = CORPORATE_CHANGE_STATUSES.filter(
  (status) => status !== "Cancelled",
);

export function isAllowedCorporateChangeStatusTransition(
  from: CorporateChangeStatus,
  to: CorporateChangeStatus,
): boolean {
  if (to === "Cancelled") {
    return from !== "Completed" && from !== "Cancelled";
  }

  const fromIndex = FORWARD_ONLY_STATUSES.indexOf(from);
  const toIndex = FORWARD_ONLY_STATUSES.indexOf(to);

  if (fromIndex < 0 || toIndex < 0) return false;

  return toIndex === fromIndex + 1;
}

const CHECKLIST_LABELS: Record<CorporateChangeType, readonly string[]> = {
  name_change: [
    "Special resolution approving new name",
    "NNC2 form",
    "Updated Business Registration certificate",
    "Certificate of Change of Name",
  ],
  share_transfer: [
    "Bought & Sold Note",
    "Instrument of Transfer",
    "Transferee ID/address proof",
    "Stamp duty payment receipt",
    "Updated register of members",
  ],
  officer_change: [
    "ND2A/ND2B form",
    "New officer's ID/address proof",
    "Updated register of directors and secretaries",
  ],
  address_change: ["NR1 form", "Proof of new address", "Updated Business Registration certificate"],
};

export function checklistLabelsFor(changeType: CorporateChangeType): readonly string[] {
  return CHECKLIST_LABELS[changeType];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/corporate-changes/workflow.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/workflow.ts src/features/corporate-changes/workflow.test.ts
git commit -m "test: add corporate change status transitions and checklist content"
```

---

### Task 6: `src/features/corporate-changes/authorization.ts`

**Files:**
- Create: `src/features/corporate-changes/authorization.ts`
- Test: `src/features/corporate-changes/authorization.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertCorporateChangeRequestCreatable, assertCorporateChangeRequestWritable } from "./authorization";

const TEAM_A = "10000000-0000-0000-0000-000000000001";
const TEAM_B = "10000000-0000-0000-0000-000000000002";

function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    authUserId: "auth-1",
    userId: "user-1",
    role: "Staff",
    teamId: TEAM_A,
    active: true,
    ...overrides,
  };
}

describe("assertCorporateChangeRequestWritable", () => {
  it("allows Staff on the same team", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor(), { assignedTeamId: TEAM_A }),
    ).not.toThrow();
  });

  it("rejects Staff on a different team", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor(), { assignedTeamId: TEAM_B }),
    ).toThrow(/Forbidden/);
  });

  it("rejects an inactive actor", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ active: false }), { assignedTeamId: TEAM_A }),
    ).toThrow(/Forbidden/);
  });

  it("rejects a Client actor", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ role: "Client" }), { assignedTeamId: TEAM_A }),
    ).toThrow(/Forbidden/);
  });

  it("allows Admin regardless of team", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ role: "Admin", teamId: null }), {
        assignedTeamId: TEAM_B,
      }),
    ).not.toThrow();
  });
});

describe("assertCorporateChangeRequestCreatable", () => {
  it("allows Staff creating into their own team", () => {
    expect(() =>
      assertCorporateChangeRequestCreatable(actor(), { teamId: TEAM_A }),
    ).not.toThrow();
  });

  it("rejects Staff creating into another team", () => {
    expect(() =>
      assertCorporateChangeRequestCreatable(actor(), { teamId: TEAM_B }),
    ).toThrow(/Forbidden/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/corporate-changes/authorization.test.ts`
Expected: FAIL with "Cannot find module './authorization'"

- [ ] **Step 3: Write the implementation**

```ts
import type { AuthenticatedActor } from "@/features/auth/types";

export type CorporateChangeCompanyTeam = { assignedTeamId: string };

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export function assertCorporateChangeRequestWritable(
  actor: AuthenticatedActor,
  company: CorporateChangeCompanyTeam,
): void {
  if (!actor.active) {
    throw forbidden("inactive users cannot change corporate change requests.");
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

export function assertCorporateChangeRequestCreatable(
  actor: AuthenticatedActor,
  input: { teamId: string },
): void {
  assertCorporateChangeRequestWritable(actor, { assignedTeamId: input.teamId });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/corporate-changes/authorization.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/authorization.ts src/features/corporate-changes/authorization.test.ts
git commit -m "test: add corporate change request authorization"
```

---

### Task 7: `clients/repository.ts` — add `updateOfficerDetails`

The `officer_change` request's `detail_change` action needs an in-place edit of an existing officer's address/identification without ceasing their appointment. No such function exists yet — P1-5 only ever built appoint/cease.

**Files:**
- Modify: `src/features/clients/types.ts` (add `UpdateOfficerDetailsInput` near `CeaseOfficerInput`)
- Modify: `src/features/clients/repository.ts:59-62` (interface), and add the implementation near `ceaseOfficer` (~line 907)
- Test: `src/features/clients/repository.test.ts`

- [ ] **Step 1: Add the type**

In `src/features/clients/types.ts`, immediately after `CeaseOfficerInput` (line 202):

```ts
export type UpdateOfficerDetailsInput = {
  companyId: string;
  officerId: string;
  name: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  actorId: string;
};
```

- [ ] **Step 2: Write the failing test**

Add to `src/features/clients/repository.test.ts` (find the existing `describe("appointOfficer"...)`/`describe("ceaseOfficer"...)` blocks and add a sibling block near them; use the same `repositoryForTests()`/fixture-company helpers already present in that file):

```ts
describe("updateOfficerDetails", () => {
  it("updates an existing officer's details without ceasing their appointment", async () => {
    const repository = repositoryForTests();
    const company = await createTestCompany(repository);
    const detail = await repository.appointOfficer({
      companyId: company.id,
      officerType: "director",
      name: "Original Name",
      identificationType: "hkid",
      identificationNumber: "A1234567",
      address: "1 Old Street, Hong Kong",
      appointmentDate: "2026-01-01",
      actorId: USER_AMY_ID,
    });
    const officer = detail.officers.find((candidate) => candidate.name === "Original Name")!;

    const updated = await repository.updateOfficerDetails({
      companyId: company.id,
      officerId: officer.id,
      name: "Original Name",
      identificationType: "hkid",
      identificationNumber: "A1234567",
      address: "2 New Street, Hong Kong",
      actorId: USER_AMY_ID,
    });

    const updatedOfficer = updated.officers.find((candidate) => candidate.id === officer.id)!;
    expect(updatedOfficer.address).toBe("2 New Street, Hong Kong");
    expect(updatedOfficer.cessationDate).toBeNull();
  });

  it("throws when the officer does not belong to the company", async () => {
    const repository = repositoryForTests();
    const companyA = await createTestCompany(repository);
    const companyB = await createTestCompany(repository);
    const detail = await repository.appointOfficer({
      companyId: companyA.id,
      officerType: "director",
      name: "Cross Company Officer",
      identificationType: null,
      identificationNumber: null,
      address: null,
      appointmentDate: "2026-01-01",
      actorId: USER_AMY_ID,
    });
    const officer = detail.officers.find((candidate) => candidate.name === "Cross Company Officer")!;

    await expect(
      repository.updateOfficerDetails({
        companyId: companyB.id,
        officerId: officer.id,
        name: "Cross Company Officer",
        identificationType: null,
        identificationNumber: null,
        address: "Somewhere",
        actorId: USER_AMY_ID,
      }),
    ).rejects.toThrow("Officer not found for this company.");
  });
});
```

(This test file already has `describe.skipIf(!databaseUrl)` wrapping the whole suite and a `createTestCompany` helper used by the existing officer/shareholding tests — follow the exact same call shape those neighboring tests use; if the helper has a different name, use the one already in the file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/clients/repository.test.ts -t "updateOfficerDetails"`
Expected: FAIL with "repository.updateOfficerDetails is not a function" (requires `TEST_DATABASE_URL` set; if unset, this suite skips entirely — note that in the task output rather than treating it as a false pass)

- [ ] **Step 4: Add to the `ClientRepository` interface**

In `src/features/clients/repository.ts`, at line 60 (immediately after `appointOfficer` in the interface):

```ts
  appointOfficer(input: AppointOfficerInput): Promise<ClientDetail>;
  updateOfficerDetails(input: UpdateOfficerDetailsInput): Promise<ClientDetail>;
  ceaseOfficer(input: CeaseOfficerInput): Promise<ClientDetail>;
```

Add `UpdateOfficerDetailsInput` to the type-only import block at the top of the file alongside the existing `AppointOfficerInput`/`CeaseOfficerInput` imports.

- [ ] **Step 5: Implement it**

Immediately after `appointOfficer`'s closing brace (~line 861), before `assertOfficerBelongsToCompany`:

```ts
  async function updateOfficerDetails(input: UpdateOfficerDetailsInput): Promise<ClientDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);
        const officer = await assertOfficerBelongsToCompany(tx, input.companyId, input.officerId);

        await tx`
          update officers
          set name = ${input.name},
              identification_type = ${input.identificationType},
              identification_number = ${input.identificationNumber},
              address = ${input.address},
              updated_at = now()
          where id = ${input.officerId} and company_id = ${input.companyId}
        `;

        if (officer.officer_type === "secretary") {
          await tx`
            update companies set company_secretary = ${input.name}, updated_at = now()
            where id = ${input.companyId}
          `;
        }

        await writeTimelineEvent(tx, {
          companyId: input.companyId,
          eventType: "officer_details_updated",
          actorId: input.actorId,
          description: `Updated details for ${input.name} (${officer.officer_type}).`,
        });

        return hydrateOrThrow(tx, input.companyId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }
```

And add `updateOfficerDetails,` to the returned object at the bottom of `createClientRepository` (near line 1209, alongside `appointOfficer,`).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/features/clients/repository.test.ts -t "updateOfficerDetails"`
Expected: PASS (2 tests, or SKIPPED if `TEST_DATABASE_URL` is unset)

- [ ] **Step 7: Commit**

```bash
git add src/features/clients/types.ts src/features/clients/repository.ts src/features/clients/repository.test.ts
git commit -m "feat: add updateOfficerDetails for in-place officer edits"
```

---

### Task 8: `work-items` — widen `WorkItemCaseType` and `EnsureWorkItemEvent`

**Files:**
- Modify: `src/features/work-items/types.ts:41`
- Modify: `src/features/work-items/repository.ts` (the `EnsureWorkItemEvent` type, `WorkItemRow` type, `ensureWorkItemForEvent`, `mapWorkItem`)
- Test: `src/features/work-items/repository.test.ts`

- [ ] **Step 1: Widen `WorkItemCaseType`**

In `src/features/work-items/types.ts:41`, change:
```ts
export type WorkItemCaseType = "annual_return";
```
to:
```ts
export type WorkItemCaseType = "annual_return" | "corporate_change_request";
```

- [ ] **Step 2: Write the failing test**

Add to `src/features/work-items/repository.test.ts`, alongside the existing `ensureWorkItemForEvent` tests (find the existing `describe("ensureWorkItemForEvent"...)` block and its fixture setup — a seeded `sla_policies` row with `work_type: "annual_return_case"` and a `business_calendars` row already exist there; this test seeds its own `work_type: "corporate_change_request"` policy row the same way the existing tests seed theirs):

```ts
it("creates a work item for a corporate_change_request case using its own annual_return_case_id-shaped FK", async () => {
  const sql = sqlForTests();
  await sql`
    insert into sla_policies (
      policy_key, version, name, work_type, business_calendar_id,
      warning_minutes, due_minutes, effective_from, active, created_by
    ) values (
      'corporate_change_request', 1, 'Corporate change request SLA', 'corporate_change_request',
      ${testCalendarId}, 2880, 5760, now(), true, ${USER_AMY_ID}
    )
  `;
  const companyId = await createTestCompany(sql);
  const requestId = await createTestCorporateChangeRequest(sql, companyId);

  const workItem = await withTx(sql, (tx) =>
    ensureWorkItemForEvent(tx, {
      companyId,
      caseType: "corporate_change_request",
      corporateChangeRequestId: requestId,
      sourceEventKey: `corporate-change:${requestId}:created`,
      sourceEventType: "corporate_change_request_created",
      workType: "corporate_change_request",
      title: "Process corporate change request",
      ownerId: USER_AMY_ID,
      teamId: TEAM_ANNUAL_RETURN_ID,
    }),
  );

  expect(workItem.caseType).toBe("corporate_change_request");
  expect(workItem.corporateChangeRequestId).toBe(requestId);
  expect(workItem.annualReturnCaseId).toBeNull();
});
```

(`createTestCorporateChangeRequest` is a small local helper you add to this test file that inserts a minimal valid `corporate_change_requests` row, e.g. an `address_change` request, and returns its id — follow the exact style of the file's existing `createTestCompany` helper. `withTx`/`testCalendarId` should reuse whatever this file's existing tests already call for opening a transaction and referencing its seeded calendar; match their exact names.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/work-items/repository.test.ts -t "corporate_change_request"`
Expected: FAIL — `caseType` type error or `corporateChangeRequestId` does not exist on the event type (requires `TEST_DATABASE_URL`; skipped otherwise)

- [ ] **Step 4: Widen `EnsureWorkItemEvent`, `WorkItemRow`, and `PersistedWorkItem`**

In `src/features/work-items/repository.ts`, change `EnsureWorkItemEvent`:
```ts
export type EnsureWorkItemEvent = {
  companyId: string;
  caseType: WorkItemCaseType;
  annualReturnCaseId?: string | null;
  corporateChangeRequestId?: string | null;
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

Add `corporate_change_request_id: string | null;` to `WorkItemRow` (next to `annual_return_case_id: string | null;`), and `corporateChangeRequestId: string | null;` to `PersistedWorkItem` (next to `annualReturnCaseId`). In `mapWorkItem`, add `corporateChangeRequestId: row.corporate_change_request_id,` next to the existing `annualReturnCaseId: row.annual_return_case_id,`.

- [ ] **Step 5: Update the INSERT in `ensureWorkItemForEvent`**

Change the insert's column list and values from:
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
to:
```ts
  const inserted = await tx<WorkItemRow[]>`
    insert into work_items (
      company_id, case_type, annual_return_case_id, corporate_change_request_id,
      source_event_key, source_event_type,
      work_type, required_skill_key, title, priority, owner_id, reviewer_id, team_id,
      sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at
    ) values (
      ${event.companyId}, ${event.caseType}, ${event.annualReturnCaseId ?? null},
      ${event.corporateChangeRequestId ?? null}, ${event.sourceEventKey},
      ${event.sourceEventType}, ${event.workType}, ${event.requiredSkillKey ?? null},
      ${event.title}, ${event.priority ?? 50}, ${event.ownerId ?? null}, ${event.reviewerId ?? null},
      ${event.teamId ?? null}, ${snapshot.policyVersionId}, ${snapshot.startedAt},
      ${snapshot.warningAt}, ${snapshot.dueAt}
    ) on conflict (source_event_key) do nothing returning *
  `;
```

Also update `annual-return/repository.ts`'s two call sites (lines ~484 and ~933, per research) to pass `annualReturnCaseId` unchanged — since the field is now optional but those call sites already pass a real value, no change needed there beyond confirming the type still accepts a plain `string` (it does, since `string | null | undefined` accepts `string`).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/features/work-items/repository.test.ts`
Expected: PASS on the whole file (including all pre-existing `annual_return` tests, unaffected)

- [ ] **Step 7: Run the full typecheck**

Run: `npm run build`
Expected: no TypeScript errors (this change touches a shared type; confirm no other caller of `EnsureWorkItemEvent`/`WorkItemRow`/`PersistedWorkItem` broke)

- [ ] **Step 8: Commit**

```bash
git add src/features/work-items/types.ts src/features/work-items/repository.ts src/features/work-items/repository.test.ts src/features/annual-return/repository.ts
git commit -m "feat: widen work_items to accept corporate_change_request cases"
```

---

### Task 9: Seed the `corporate_change_request` SLA policy (demo/test parity + documented production step)

`ensureWorkItemForEvent` throws `"No active SLA policy exists for work type corporate_change_request."` until a matching `sla_policies` row exists. This codebase seeds `sla_policies` exclusively via `scripts/db-seed-annual-return.ts` (not migrations — confirmed no migration inserts into `sla_policies` anywhere in this repo), and production got its own `annual_return_case` policy the same way. This task adds parity for demo/CI, and documents the production step explicitly rather than silently assuming it will happen.

**Files:**
- Modify: `scripts/db-seed-annual-return.ts` (find the existing `insert into sla_policies` call and add a second one)
- Modify: `docs/runbooks/firm-deployment.md` (add a step)

- [ ] **Step 1: Find the existing SLA policy seed**

Run: `grep -n "insert into sla_policies" scripts/db-seed-annual-return.ts`

Read the surrounding ~20 lines to see the exact `business_calendar_id`/`created_by` values already in scope in that script (it will be a local variable already used for the `annual_return_case` policy — reuse the same variable name).

- [ ] **Step 2: Add a second policy insert immediately after it**, using the same calendar/creator variables the existing insert uses (do not invent new ones):

```ts
await sql`
  insert into sla_policies (
    policy_key, version, name, work_type, business_calendar_id,
    warning_minutes, due_minutes, effective_from, active, created_by
  ) values (
    'corporate_change_request', 1, 'Corporate change request SLA', 'corporate_change_request',
    ${businessCalendarId}, 2880, 5760, now(), true, ${adminUserId}
  )
  on conflict (policy_key, version) do nothing
`;
```

(Replace `businessCalendarId`/`adminUserId` with whatever the neighboring `annual_return_case` insert actually calls its own calendar id and creator id variables — match them exactly, do not introduce new names.)

- [ ] **Step 3: Run the seed script against a local test database and confirm both policies exist**

Run: `npm run db:seed` (against `DATABASE_URL` pointed at a scratch/local database — never production)
Then: `psql "$DATABASE_URL" -c "select policy_key, work_type from sla_policies;"` (or the project's equivalent query tool)
Expected: two rows, `annual_return_case` and `corporate_change_request`.

- [ ] **Step 4: Document the production gap**

Append to `docs/runbooks/firm-deployment.md` (find its existing "after migrating" or "post-deploy" checklist section and add this as one more line item):

```markdown
- After migration 0020 is applied, confirm an active `sla_policies` row exists with
  `work_type = 'corporate_change_request'` (seeded automatically by `npm run db:seed`
  in demo/staging; in production, insert it manually the same way `annual_return_case`'s
  policy was originally set up, referencing an existing active `business_calendars` row).
  Without it, creating a corporate change request fails with "No active SLA policy
  exists for work type corporate_change_request."
```

- [ ] **Step 5: Commit**

```bash
git add scripts/db-seed-annual-return.ts docs/runbooks/firm-deployment.md
git commit -m "feat: seed corporate_change_request SLA policy, document prod setup step"
```

---

### Task 10: `src/features/corporate-changes/repository.ts` — factory, row mapping, `listRequests`/`getRequest`

**Files:**
- Create: `src/features/corporate-changes/repository.ts`
- Test: `src/features/corporate-changes/repository.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createClientRepository } from "@/features/clients/repository";
import { createCorporateChangeRequestRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const USER_AMY_ID = "20000000-0000-0000-0000-000000000001";
const TEST_COMPANY_UUID_PREFIX = "98000000";
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

function testUuid(prefix: string, sequence: number): string {
  return `${prefix}-0000-0000-0000-${String(sequence).padStart(12, "0")}`;
}

let testSql: SqlClient | undefined;
function sqlForTests(): SqlClient {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

async function cleanupCorporateChangeFixtures() {
  if (!databaseUrl) return;
  const sql = sqlForTests();
  const companyId = testUuid(TEST_COMPANY_UUID_PREFIX, 1);
  await sql`delete from work_items where company_id = ${companyId}`;
  await sql`delete from corporate_change_requests where company_id = ${companyId}`;
  await sql`delete from officers where company_id = ${companyId}`;
  await sql`delete from shareholdings where company_id = ${companyId}`;
  await sql`delete from companies where id = ${companyId}`;
}

async function seedTestCompany(): Promise<string> {
  const sql = sqlForTests();
  const companyId = testUuid(TEST_COMPANY_UUID_PREFIX, 1);
  await sql`
    insert into companies (
      id, company_name, cr_number, br_number, incorporation_date,
      annual_return_basis_date, registered_office, company_secretary,
      status, assigned_owner_id, assigned_team_id
    ) values (
      ${companyId}, 'Test Corporate Change Co Ltd', 'TEST-CCR-98000001', 'TEST-CBR-98000001',
      '2020-01-01', '2027-01-01', '1 Test Street, Hong Kong', 'Original Secretary',
      'active', ${USER_AMY_ID}, '10000000-0000-0000-0000-000000000001'
    )
    on conflict (id) do nothing
  `;
  return companyId;
}

describe.skipIf(!databaseUrl)("corporate change request repository", () => {
  beforeEach(cleanupCorporateChangeFixtures);
  afterEach(cleanupCorporateChangeFixtures);
  afterAll(async () => {
    await cleanupCorporateChangeFixtures();
    await testSql?.end();
  });

  it(
    "creates an address_change request, seeds its checklist, and lists it",
    async () => {
      const companyId = await seedTestCompany();
      const repository = createCorporateChangeRequestRepository(databaseUrl!);

      const created = await repository.createRequest({
        changeType: "address_change",
        companyId,
        quotedFee: 2800,
        newRegisteredOffice: "88 New Road, Central, Hong Kong",
        actorId: USER_AMY_ID,
      });

      expect(created.status).toBe("Requested");
      expect(created.checklistItems).toHaveLength(3);
      expect(created.checklistItems.map((item) => item.itemLabel)).toContain("NR1 form");

      const fetched = await repository.getRequest(created.id);
      expect(fetched.newRegisteredOffice).toBe("88 New Road, Central, Hong Kong");

      const list = await repository.listRequests({ companyId } as never);
      expect(list.some((row) => row.id === created.id)).toBe(true);

      await repository.close();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts`
Expected: FAIL with "Cannot find module './repository'" (or SKIPPED if `TEST_DATABASE_URL` unset — note this explicitly)

- [ ] **Step 3: Write the repository — factory, transaction helper, row mapping, `hydrateOrThrow`, `listRequests`/`getRequest`**

```ts
import { rethrowClientWriteError } from "@/features/clients/errors";
import { createSqlClient, getSqlClient, type CreateSqlClientOptions, type QueryClient } from "@/server/db/client";
import { ensureWorkItemForEvent } from "@/features/work-items/repository";
import { checklistLabelsFor } from "./workflow";
import type {
  CancelRequestInput,
  CompleteRequestInput,
  CorporateChangeChecklistItem,
  CorporateChangeRequest,
  CorporateChangeRequestDetail,
  CorporateChangeRequestSummary,
  CorporateChangeType,
  CreateCorporateChangeRequestInput,
  ListCorporateChangeRequestsFilter,
  TransitionStatusInput,
  UpdateChecklistItemStatusInput,
} from "./types";

type TransactionSqlClient = QueryClient & { begin?: never };

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: TransactionSqlClient) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return (client as { begin: (fn: (tx: TransactionSqlClient) => Promise<T>) => Promise<T> }).begin(handler);
  }
  return handler(client as TransactionSqlClient);
}

type RequestRow = {
  id: string;
  company_id: string;
  change_type: CorporateChangeType;
  status: CorporateChangeRequest["status"];
  owner_id: string;
  quoted_fee: string;
  current_name_en: string | null;
  current_name_zh: string | null;
  new_name_en: string | null;
  new_name_zh: string | null;
  transferor_shareholding_id: string | null;
  transferee_shareholding_id: string | null;
  transferee_new_shareholder_name: string | null;
  transferee_new_shareholder_address: string | null;
  shares_transferred: number | null;
  consideration: string | null;
  stamp_duty_amount: string | null;
  officer_id: string | null;
  officer_action: CorporateChangeRequest["officerAction"];
  new_officer_type: CorporateChangeRequest["newOfficerType"];
  new_officer_name: string | null;
  new_officer_identification_type: CorporateChangeRequest["newOfficerIdentificationType"];
  new_officer_identification_number: string | null;
  new_officer_address: string | null;
  effective_date: string | Date | null;
  current_registered_office: string | null;
  new_registered_office: string | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type ChecklistRow = {
  id: string;
  request_id: string;
  item_label: string;
  required: boolean;
  status: CorporateChangeChecklistItem["status"];
  note: string | null;
  received_at: string | Date | null;
  verified_at: string | Date | null;
};

function iso(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

function dateOnly(value: string | Date): string {
  return iso(value).slice(0, 10);
}

function mapRequest(row: RequestRow): CorporateChangeRequest {
  return {
    id: row.id,
    companyId: row.company_id,
    changeType: row.change_type,
    status: row.status,
    ownerId: row.owner_id,
    quotedFee: Number(row.quoted_fee),
    currentNameEn: row.current_name_en,
    currentNameZh: row.current_name_zh,
    newNameEn: row.new_name_en,
    newNameZh: row.new_name_zh,
    transferorShareholdingId: row.transferor_shareholding_id,
    transfereeShareholdingId: row.transferee_shareholding_id,
    transfereeNewShareholderName: row.transferee_new_shareholder_name,
    transfereeNewShareholderAddress: row.transferee_new_shareholder_address,
    sharesTransferred: row.shares_transferred,
    consideration: row.consideration === null ? null : Number(row.consideration),
    stampDutyAmount: row.stamp_duty_amount === null ? null : Number(row.stamp_duty_amount),
    officerId: row.officer_id,
    officerAction: row.officer_action,
    newOfficerType: row.new_officer_type,
    newOfficerName: row.new_officer_name,
    newOfficerIdentificationType: row.new_officer_identification_type,
    newOfficerIdentificationNumber: row.new_officer_identification_number,
    newOfficerAddress: row.new_officer_address,
    effectiveDate: row.effective_date ? dateOnly(row.effective_date) : null,
    currentRegisteredOffice: row.current_registered_office,
    newRegisteredOffice: row.new_registered_office,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapChecklistItem(row: ChecklistRow): CorporateChangeChecklistItem {
  return {
    id: row.id,
    requestId: row.request_id,
    itemLabel: row.item_label,
    required: row.required,
    status: row.status,
    note: row.note,
    receivedAt: row.received_at ? iso(row.received_at) : null,
    verifiedAt: row.verified_at ? iso(row.verified_at) : null,
  };
}

const REQUEST_COLUMNS = `
  id, company_id, change_type, status, owner_id, quoted_fee,
  current_name_en, current_name_zh, new_name_en, new_name_zh,
  transferor_shareholding_id, transferee_shareholding_id,
  transferee_new_shareholder_name, transferee_new_shareholder_address,
  shares_transferred, consideration, stamp_duty_amount,
  officer_id, officer_action, new_officer_type, new_officer_name,
  new_officer_identification_type, new_officer_identification_number, new_officer_address,
  effective_date, current_registered_office, new_registered_office,
  completed_at, created_at, updated_at
`;

export interface CorporateChangeRequestRepository {
  listRequests(filter: ListCorporateChangeRequestsFilter): Promise<CorporateChangeRequestSummary[]>;
  getRequest(requestId: string): Promise<CorporateChangeRequestDetail>;
  createRequest(input: CreateCorporateChangeRequestInput): Promise<CorporateChangeRequestDetail>;
  updateChecklistItemStatus(input: UpdateChecklistItemStatusInput): Promise<CorporateChangeRequestDetail>;
  transitionStatus(input: TransitionStatusInput): Promise<CorporateChangeRequestDetail>;
  cancelRequest(input: CancelRequestInput): Promise<CorporateChangeRequestDetail>;
  completeRequest(input: CompleteRequestInput): Promise<CorporateChangeRequestDetail>;
  getCompanyTeamId(companyId: string): Promise<string>;
  close(): Promise<void>;
}

export type CreateCorporateChangeRequestRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export function createCorporateChangeRequestRepository(
  databaseUrl?: string,
  options: CreateCorporateChangeRequestRepositoryOptions = {},
): CorporateChangeRequestRepository {
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function hydrateOrThrow(
    tx: TransactionSqlClient,
    requestId: string,
  ): Promise<CorporateChangeRequestDetail> {
    const rows = await tx<RequestRow[]>`
      select ${sql.unsafe(REQUEST_COLUMNS)} from corporate_change_requests where id = ${requestId}
    `;
    const [row] = rows;
    if (!row) throw new Error("Corporate change request not found.");

    const checklistRows = await tx<ChecklistRow[]>`
      select id, request_id, item_label, required, status, note, received_at, verified_at
      from corporate_change_checklist_items
      where request_id = ${requestId}
      order by created_at asc
    `;

    return { ...mapRequest(row), checklistItems: checklistRows.map(mapChecklistItem) };
  }

  async function listRequests(
    filter: ListCorporateChangeRequestsFilter,
  ): Promise<CorporateChangeRequestSummary[]> {
    const rows = await sql<(RequestRow & { company_name: string })[]>`
      select r.id, r.company_id, r.change_type, r.status, r.owner_id, r.quoted_fee, r.created_at,
             c.company_name
      from corporate_change_requests r
      join companies c on c.id = r.company_id
      where (${filter.changeType ?? null}::text is null or r.change_type = ${filter.changeType ?? null})
        and (${filter.status ?? null}::text is null or r.status = ${filter.status ?? null})
        and (${filter.teamId ?? null}::uuid is null or c.assigned_team_id = ${filter.teamId ?? null})
      order by r.created_at desc
    `;

    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      changeType: row.change_type,
      status: row.status,
      ownerId: row.owner_id,
      quotedFee: Number(row.quoted_fee),
      createdAt: iso(row.created_at),
      companyName: row.company_name,
    }));
  }

  async function getRequest(requestId: string): Promise<CorporateChangeRequestDetail> {
    return hydrateOrThrow(sql as TransactionSqlClient, requestId);
  }

  async function getCompanyTeamId(companyId: string): Promise<string> {
    const rows = await sql<{ assigned_team_id: string }[]>`
      select assigned_team_id from companies where id = ${companyId}
    `;
    if (!rows[0]) throw new Error("Company not found.");
    return rows[0].assigned_team_id;
  }

  // createRequest/updateChecklistItemStatus/transitionStatus/cancelRequest/completeRequest
  // are implemented in Tasks 11-15.

  return {
    listRequests,
    getRequest,
    getCompanyTeamId,
    createRequest: notImplemented("createRequest"),
    updateChecklistItemStatus: notImplemented("updateChecklistItemStatus"),
    transitionStatus: notImplemented("transitionStatus"),
    cancelRequest: notImplemented("cancelRequest"),
    completeRequest: notImplemented("completeRequest"),
    async close() {
      if (ownsClient) await sql.end();
    },
  };

  function notImplemented(name: string) {
    return () => {
      throw new Error(`${name} is implemented in a later task.`);
    };
  }
}
```

- [ ] **Step 4: Run test to verify `listRequests`/`getRequest` compile but `createRequest` still fails**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts`
Expected: FAIL at the `repository.createRequest(...)` call with "createRequest is implemented in a later task." — confirms the scaffolding compiles and the transaction/mapping plumbing is wired correctly ahead of the write paths.

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/repository.ts src/features/corporate-changes/repository.test.ts
git commit -m "feat: add corporate change request repository read paths"
```

---

### Task 11: `repository.ts` — `createRequest` (all four change types) and checklist seeding

**Files:**
- Modify: `src/features/corporate-changes/repository.ts`
- Modify: `src/features/corporate-changes/repository.test.ts` (extend the Task 10 test file)

- [ ] **Step 1: Write the failing tests** (append to the existing `describe` block in `repository.test.ts`)

```ts
it(
  "creates a share_transfer request against a real shareholding and requires exactly one transferee",
  async () => {
    const companyId = await seedTestCompany();
    const clients = createClientRepository(databaseUrl!);
    const detail = await clients.recordShareholding({
      companyId,
      shareholderName: "Original Holder",
      shareholderAddress: null,
      shareClass: "Ordinary",
      numberOfShares: 1000,
      allotmentDate: "2020-01-01",
      actorId: USER_AMY_ID,
    });
    const shareholding = detail.shareholdings.find((s) => s.shareholderName === "Original Holder")!;
    await clients.close();

    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "share_transfer",
      companyId,
      quotedFee: 2500,
      transferorShareholdingId: shareholding.id,
      sharesTransferred: 400,
      consideration: 400000,
      stampDutyAmount: 800,
      transfereeShareholdingId: null,
      transfereeNewShareholderName: "New Holder",
      transfereeNewShareholderAddress: "9 Test Ave, Hong Kong",
      actorId: USER_AMY_ID,
    });

    expect(created.sharesTransferred).toBe(400);
    expect(created.checklistItems.map((i) => i.itemLabel)).toContain("Bought & Sold Note");

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "creates one work_items row per request, idempotently keyed by source event",
  async () => {
    const companyId = await seedTestCompany();
    const repository = createCorporateChangeRequestRepository(databaseUrl!);

    const created = await repository.createRequest({
      changeType: "name_change",
      companyId,
      quotedFee: 3000,
      newNameEn: "Renamed Test Co Ltd",
      newNameZh: null,
      actorId: USER_AMY_ID,
    });

    const sql = sqlForTests();
    const workItems = await sql`
      select case_type, corporate_change_request_id from work_items
      where corporate_change_request_id = ${created.id}
    `;
    expect(workItems).toHaveLength(1);
    expect(workItems[0].case_type).toBe("corporate_change_request");

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts -t "creates a"`
Expected: FAIL with "createRequest is implemented in a later task." (requires the `sla_policies` row from Task 9 to exist in the test database, or the test fails on the SLA-policy lookup instead — both failures are expected at this point in the plan)

- [ ] **Step 3: Implement `createRequest`**, replacing the `createRequest: notImplemented("createRequest"),` line in the returned object with `createRequest,` and adding the function above the `return` statement:

```ts
  async function createRequest(
    input: CreateCorporateChangeRequestInput,
  ): Promise<CorporateChangeRequestDetail> {
    try {
      return await withTransaction(sql, async (tx) => {
        const companyRows = await tx<{ id: string; assigned_team_id: string }[]>`
          select id, assigned_team_id from companies where id = ${input.companyId} for update
        `;
        const company = companyRows[0];
        if (!company) throw new Error("Company not found.");

        let insertedId: string;

        if (input.changeType === "name_change") {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee, new_name_en, new_name_zh
            ) values (
              ${input.companyId}, 'name_change', ${input.actorId}, ${input.quotedFee},
              ${input.newNameEn}, ${input.newNameZh}
            ) returning id
          `;
          insertedId = rows[0].id;
        } else if (input.changeType === "share_transfer") {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee,
              transferor_shareholding_id, transferee_shareholding_id,
              transferee_new_shareholder_name, transferee_new_shareholder_address,
              shares_transferred, consideration, stamp_duty_amount
            ) values (
              ${input.companyId}, 'share_transfer', ${input.actorId}, ${input.quotedFee},
              ${input.transferorShareholdingId}, ${input.transfereeShareholdingId},
              ${input.transfereeNewShareholderName}, ${input.transfereeNewShareholderAddress},
              ${input.sharesTransferred}, ${input.consideration}, ${input.stampDutyAmount}
            ) returning id
          `;
          insertedId = rows[0].id;
        } else if (input.changeType === "officer_change") {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee,
              officer_id, officer_action, new_officer_type, new_officer_name,
              new_officer_identification_type, new_officer_identification_number,
              new_officer_address, effective_date
            ) values (
              ${input.companyId}, 'officer_change', ${input.actorId}, ${input.quotedFee},
              ${input.officerId}, ${input.officerAction}, ${input.newOfficerType}, ${input.newOfficerName},
              ${input.newOfficerIdentificationType}, ${input.newOfficerIdentificationNumber},
              ${input.newOfficerAddress}, ${input.effectiveDate}
            ) returning id
          `;
          insertedId = rows[0].id;
        } else {
          const rows = await tx<{ id: string }[]>`
            insert into corporate_change_requests (
              company_id, change_type, owner_id, quoted_fee, new_registered_office
            ) values (
              ${input.companyId}, 'address_change', ${input.actorId}, ${input.quotedFee},
              ${input.newRegisteredOffice}
            ) returning id
          `;
          insertedId = rows[0].id;
        }

        for (const label of checklistLabelsFor(input.changeType)) {
          await tx`
            insert into corporate_change_checklist_items (request_id, item_label)
            values (${insertedId}, ${label})
          `;
        }

        await ensureWorkItemForEvent(tx, {
          companyId: input.companyId,
          caseType: "corporate_change_request",
          corporateChangeRequestId: insertedId,
          sourceEventKey: `corporate-change:${insertedId}:created`,
          sourceEventType: "corporate_change_request_created",
          workType: "corporate_change_request",
          title: `Process ${input.changeType.replace("_", " ")} request`,
          ownerId: input.actorId,
          teamId: company.assigned_team_id,
        });

        return hydrateOrThrow(tx, insertedId);
      });
    } catch (error) {
      rethrowClientWriteError(error);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts`
Expected: PASS (all tests from Tasks 10-11)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/repository.ts src/features/corporate-changes/repository.test.ts
git commit -m "feat: implement corporate change request creation for all four types"
```

---

### Task 12: `repository.ts` — `updateChecklistItemStatus`, `transitionStatus`, `cancelRequest`

**Files:**
- Modify: `src/features/corporate-changes/repository.ts`
- Modify: `src/features/corporate-changes/repository.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it(
  "marks a checklist item Verified and rejects an invalid status transition",
  async () => {
    const companyId = await seedTestCompany();
    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "address_change",
      companyId,
      quotedFee: 2800,
      newRegisteredOffice: "88 New Road, Central, Hong Kong",
      actorId: USER_AMY_ID,
    });
    const item = created.checklistItems[0];

    const updated = await repository.updateChecklistItemStatus({
      requestId: created.id,
      itemId: item.id,
      status: "Verified",
      note: null,
      actorId: USER_AMY_ID,
    });
    expect(updated.checklistItems.find((i) => i.id === item.id)!.status).toBe("Verified");

    await expect(
      repository.transitionStatus({
        requestId: created.id,
        toStatus: "Filed with Registrar",
        actorId: USER_AMY_ID,
      }),
    ).rejects.toThrow(/Cannot transition/);

    const progressed = await repository.transitionStatus({
      requestId: created.id,
      toStatus: "Documents pending",
      actorId: USER_AMY_ID,
    });
    expect(progressed.status).toBe("Documents pending");

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "cancels a request and marks its linked work item cancelled",
  async () => {
    const companyId = await seedTestCompany();
    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "address_change",
      companyId,
      quotedFee: 2800,
      newRegisteredOffice: "88 New Road, Central, Hong Kong",
      actorId: USER_AMY_ID,
    });

    const cancelled = await repository.cancelRequest({ requestId: created.id, actorId: USER_AMY_ID });
    expect(cancelled.status).toBe("Cancelled");

    const sql = sqlForTests();
    const workItems = await sql`
      select status from work_items where corporate_change_request_id = ${created.id}
    `;
    expect(workItems[0].status).toBe("cancelled");

    await expect(
      repository.cancelRequest({ requestId: created.id, actorId: USER_AMY_ID }),
    ).rejects.toThrow(/Cannot transition/);

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts -t "checklist item"`
Expected: FAIL with "updateChecklistItemStatus is implemented in a later task."

- [ ] **Step 3: Implement the three functions**, replacing their `notImplemented(...)` lines with the real function names, and adding the implementations above `return`:

```ts
  async function updateChecklistItemStatus(
    input: UpdateChecklistItemStatusInput,
  ): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, async (tx) => {
      await tx`
        update corporate_change_checklist_items
        set status = ${input.status},
            note = ${input.note},
            received_at = case when ${input.status} = 'Received' then now() else received_at end,
            verified_at = case when ${input.status} = 'Verified' then now() else verified_at end,
            updated_at = now()
        where id = ${input.itemId} and request_id = ${input.requestId}
      `;
      return hydrateOrThrow(tx, input.requestId);
    });
  }

  async function transitionStatus(input: TransitionStatusInput): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, async (tx) => {
      const rows = await tx<{ status: CorporateChangeRequest["status"] }[]>`
        select status from corporate_change_requests where id = ${input.requestId} for update
      `;
      const current = rows[0];
      if (!current) throw new Error("Corporate change request not found.");
      if (!isAllowedCorporateChangeStatusTransition(current.status, input.toStatus)) {
        throw new Error(`Cannot transition from ${current.status} to ${input.toStatus}.`);
      }

      await tx`
        update corporate_change_requests set status = ${input.toStatus}, updated_at = now()
        where id = ${input.requestId}
      `;

      return hydrateOrThrow(tx, input.requestId);
    });
  }

  async function cancelRequest(input: CancelRequestInput): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, async (tx) => {
      const rows = await tx<{ status: CorporateChangeRequest["status"] }[]>`
        select status from corporate_change_requests where id = ${input.requestId} for update
      `;
      const current = rows[0];
      if (!current) throw new Error("Corporate change request not found.");
      if (!isAllowedCorporateChangeStatusTransition(current.status, "Cancelled")) {
        throw new Error(`Cannot transition from ${current.status} to Cancelled.`);
      }

      await tx`
        update corporate_change_requests set status = 'Cancelled', updated_at = now()
        where id = ${input.requestId}
      `;
      await tx`
        update work_items set status = 'cancelled', updated_at = now()
        where corporate_change_request_id = ${input.requestId}
      `;

      return hydrateOrThrow(tx, input.requestId);
    });
  }
```

Add `import { checklistLabelsFor, isAllowedCorporateChangeStatusTransition } from "./workflow";` to the top-of-file import (extending the Task 11 import of `checklistLabelsFor` alone).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts`
Expected: PASS (all tests from Tasks 10-12)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/repository.ts src/features/corporate-changes/repository.test.ts
git commit -m "feat: add checklist status updates, status transitions, and cancellation"
```

---

### Task 13: `repository.ts` — `completeRequest` for `name_change` and `address_change`

**Files:**
- Modify: `src/features/corporate-changes/repository.ts`
- Modify: `src/features/corporate-changes/repository.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it(
  "completing a name_change request updates the company's name and marks the work item completed",
  async () => {
    const companyId = await seedTestCompany();
    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "name_change",
      companyId,
      quotedFee: 3000,
      newNameEn: "Renamed Test Co Ltd",
      newNameZh: "新測試有限公司",
      actorId: USER_AMY_ID,
    });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Documents pending", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Ready to file", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Filed with Registrar", actorId: USER_AMY_ID });

    const completed = await repository.completeRequest({ requestId: created.id, actorId: USER_AMY_ID });
    expect(completed.status).toBe("Completed");
    expect(completed.completedAt).not.toBeNull();

    const sql = sqlForTests();
    const company = await sql`select company_name from companies where id = ${companyId}`;
    expect(company[0].company_name).toBe("Renamed Test Co Ltd");

    const workItems = await sql`
      select status from work_items where corporate_change_request_id = ${created.id}
    `;
    expect(workItems[0].status).toBe("completed");

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "rejects completing a request that has not reached Filed with Registrar",
  async () => {
    const companyId = await seedTestCompany();
    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "address_change",
      companyId,
      quotedFee: 2800,
      newRegisteredOffice: "88 New Road, Central, Hong Kong",
      actorId: USER_AMY_ID,
    });

    await expect(
      repository.completeRequest({ requestId: created.id, actorId: USER_AMY_ID }),
    ).rejects.toThrow(/must be Filed with Registrar/);

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts -t "completing a name_change"`
Expected: FAIL with "completeRequest is implemented in a later task."

- [ ] **Step 3: Implement `completeRequest`**, branching only on `name_change`/`address_change` for now (officer_change and share_transfer branches are added in Tasks 14-15 by extending this same function):

```ts
  async function completeRequest(input: CompleteRequestInput): Promise<CorporateChangeRequestDetail> {
    return withTransaction(sql, async (tx) => {
      await tx`select id from corporate_change_requests where id = ${input.requestId} for update`;
      const current = await hydrateOrThrow(tx, input.requestId);

      if (current.status !== "Filed with Registrar") {
        throw new Error(
          `Cannot complete a request from status ${current.status}; it must be Filed with Registrar.`,
        );
      }

      if (current.changeType === "name_change") {
        await tx`
          update companies set company_name = ${current.newNameEn}, updated_at = now()
          where id = ${current.companyId}
        `;
      } else if (current.changeType === "address_change") {
        await tx`
          update companies set registered_office = ${current.newRegisteredOffice}, updated_at = now()
          where id = ${current.companyId}
        `;
      }
      // officer_change and share_transfer branches: Tasks 14-15.

      await tx`
        update corporate_change_requests
        set status = 'Completed', completed_at = now(), updated_at = now()
        where id = ${input.requestId}
      `;
      await tx`
        update work_items set status = 'completed', completed_at = now(), updated_at = now()
        where corporate_change_request_id = ${input.requestId}
      `;

      return hydrateOrThrow(tx, input.requestId);
    });
  }
```

(Note: use the real `companies` column name — confirm via `grep -n "company_name\|^  name " src/server/db/schema.sql` whether the column is `company_name` or `name`; the incorporation `completeCase` excerpt from research uses `company_name`, so this plan follows that, but verify against the live schema before running the test in case a later migration renamed it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts`
Expected: PASS (all tests through Task 13)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/repository.ts src/features/corporate-changes/repository.test.ts
git commit -m "feat: complete name_change and address_change requests"
```

---

### Task 14: `repository.ts` — `completeRequest` for `officer_change` (reusing `clients` repository)

**Files:**
- Modify: `src/features/corporate-changes/repository.ts`
- Modify: `src/features/corporate-changes/repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it(
  "completing an officer_change appoint request creates the new officer via the clients repository",
  async () => {
    const companyId = await seedTestCompany();
    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "officer_change",
      companyId,
      quotedFee: 1200,
      officerAction: "appoint",
      officerId: null,
      newOfficerType: "director",
      newOfficerName: "New Director",
      newOfficerIdentificationType: "hkid",
      newOfficerIdentificationNumber: "B7654321",
      newOfficerAddress: "5 Director Lane, Hong Kong",
      effectiveDate: "2026-09-01",
      actorId: USER_AMY_ID,
    });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Documents pending", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Ready to file", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Filed with Registrar", actorId: USER_AMY_ID });

    await repository.completeRequest({ requestId: created.id, actorId: USER_AMY_ID });

    const clients = createClientRepository(databaseUrl!);
    const detail = await clients.getClient(companyId);
    expect(detail.officers.some((o) => o.name === "New Director" && o.cessationDate === null)).toBe(true);
    await clients.close();

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
```

(If the `clients` repository's read method is named something other than `getClient`, use the actual name from `src/features/clients/repository.ts`'s `ClientRepository` interface — grep it first: `grep -n "interface ClientRepository" -A 20 src/features/clients/repository.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts -t "officer_change appoint"`
Expected: FAIL — the officer is never created, since `completeRequest` doesn't yet branch on `officer_change`.

- [ ] **Step 3: Add the `officer_change` branch** inside `completeRequest`, right after the `address_change` branch and before the "officer_change and share_transfer branches: Tasks 14-15" comment (delete that comment for the officer_change half now):

```ts
      } else if (current.changeType === "officer_change") {
        const clientsRepository = createClientRepository(undefined, { sql: tx });
        if (current.officerAction === "appoint") {
          await clientsRepository.appointOfficer({
            companyId: current.companyId,
            officerType: current.newOfficerType!,
            name: current.newOfficerName!,
            identificationType: current.newOfficerIdentificationType,
            identificationNumber: current.newOfficerIdentificationNumber,
            address: current.newOfficerAddress,
            appointmentDate: current.effectiveDate!,
            actorId: input.actorId,
          });
        } else if (current.officerAction === "resign") {
          await clientsRepository.ceaseOfficer({
            companyId: current.companyId,
            officerId: current.officerId!,
            cessationDate: current.effectiveDate!,
            actorId: input.actorId,
          });
        } else {
          await clientsRepository.updateOfficerDetails({
            companyId: current.companyId,
            officerId: current.officerId!,
            name: current.newOfficerName!,
            identificationType: current.newOfficerIdentificationType,
            identificationNumber: current.newOfficerIdentificationNumber,
            address: current.newOfficerAddress,
            actorId: input.actorId,
          });
        }
      }
      // share_transfer branch: Task 15.
```

Add `import { createClientRepository } from "@/features/clients/repository";` to the top of the file. This relies on `createClientRepository`'s `{ sql: tx }` injection point (confirmed in research §2) and `withTransaction`'s `"begin" in client` duck-typing — passing an already-open `tx` means `clientsRepository`'s own internal `withTransaction` call detects it's not a top-level client and reuses `tx` directly rather than opening a nested transaction, so `appointOfficer`/`ceaseOfficer`/`updateOfficerDetails`'s writes commit atomically with the rest of `completeRequest`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts`
Expected: PASS (all tests through Task 14)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/repository.ts src/features/corporate-changes/repository.test.ts
git commit -m "feat: complete officer_change requests by reusing the clients repository"
```

---

### Task 15: `repository.ts` — `completeRequest` for `share_transfer` (two-row lock, new "move shares" logic)

**Files:**
- Modify: `src/features/corporate-changes/repository.ts`
- Modify: `src/features/corporate-changes/repository.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it(
  "completing a share_transfer to a new shareholder decrements the transferor and creates the transferee",
  async () => {
    const companyId = await seedTestCompany();
    const clients = createClientRepository(databaseUrl!);
    const seeded = await clients.recordShareholding({
      companyId,
      shareholderName: "Original Holder",
      shareholderAddress: null,
      shareClass: "Ordinary",
      numberOfShares: 1000,
      allotmentDate: "2020-01-01",
      actorId: USER_AMY_ID,
    });
    const transferor = seeded.shareholdings.find((s) => s.shareholderName === "Original Holder")!;
    await clients.close();

    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "share_transfer",
      companyId,
      quotedFee: 2500,
      transferorShareholdingId: transferor.id,
      sharesTransferred: 400,
      consideration: 400000,
      stampDutyAmount: 800,
      transfereeShareholdingId: null,
      transfereeNewShareholderName: "New Holder",
      transfereeNewShareholderAddress: "9 Test Ave, Hong Kong",
      actorId: USER_AMY_ID,
    });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Documents pending", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Ready to file", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Filed with Registrar", actorId: USER_AMY_ID });

    await repository.completeRequest({ requestId: created.id, actorId: USER_AMY_ID });

    const clientsAfter = createClientRepository(databaseUrl!);
    const detail = await clientsAfter.getClient(companyId);
    const originalAfter = detail.shareholdings.find((s) => s.id === transferor.id)!;
    const newHolder = detail.shareholdings.find((s) => s.shareholderName === "New Holder")!;
    expect(originalAfter.numberOfShares).toBe(600);
    expect(originalAfter.cessationDate).toBeNull();
    expect(newHolder.numberOfShares).toBe(400);
    await clientsAfter.close();

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "completing a full share_transfer (all shares) sets the transferor's cessation date",
  async () => {
    const companyId = await seedTestCompany();
    const clients = createClientRepository(databaseUrl!);
    const seeded = await clients.recordShareholding({
      companyId,
      shareholderName: "Full Seller",
      shareholderAddress: null,
      shareClass: "Ordinary",
      numberOfShares: 500,
      allotmentDate: "2020-01-01",
      actorId: USER_AMY_ID,
    });
    const transferor = seeded.shareholdings.find((s) => s.shareholderName === "Full Seller")!;
    await clients.close();

    const repository = createCorporateChangeRequestRepository(databaseUrl!);
    const created = await repository.createRequest({
      changeType: "share_transfer",
      companyId,
      quotedFee: 2500,
      transferorShareholdingId: transferor.id,
      sharesTransferred: 500,
      consideration: 500000,
      stampDutyAmount: 1000,
      transfereeShareholdingId: null,
      transfereeNewShareholderName: "Full Buyer",
      transfereeNewShareholderAddress: "10 Test Ave, Hong Kong",
      actorId: USER_AMY_ID,
    });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Documents pending", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Ready to file", actorId: USER_AMY_ID });
    await repository.transitionStatus({ requestId: created.id, toStatus: "Filed with Registrar", actorId: USER_AMY_ID });
    await repository.completeRequest({ requestId: created.id, actorId: USER_AMY_ID });

    const clientsAfter = createClientRepository(databaseUrl!);
    const detail = await clientsAfter.getClient(companyId);
    const soldOut = detail.shareholdings.find((s) => s.id === transferor.id)!;
    expect(soldOut.numberOfShares).toBe(0);
    expect(soldOut.cessationDate).not.toBeNull();
    await clientsAfter.close();

    await repository.close();
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts -t "share_transfer"`
Expected: FAIL — the transferor's share count is unchanged and no transferee holding exists, since `completeRequest` doesn't yet branch on `share_transfer`.

- [ ] **Step 3: Add the `share_transfer` branch**, replacing the `// share_transfer branch: Task 15.` comment:

```ts
      } else if (current.changeType === "share_transfer") {
        const clientsRepository = createClientRepository(undefined, { sql: tx });

        await tx`select id from shareholdings where id = ${current.transferorShareholdingId} for update`;
        if (current.transfereeShareholdingId) {
          await tx`select id from shareholdings where id = ${current.transfereeShareholdingId} for update`;
        }

        const transferorRows = await tx<{ number_of_shares: number; allotment_date: string | Date }[]>`
          select number_of_shares, allotment_date from shareholdings where id = ${current.transferorShareholdingId}
        `;
        const transferor = transferorRows[0];
        if (!transferor) throw new Error("Transferor shareholding not found.");

        const remaining = transferor.number_of_shares - current.sharesTransferred!;
        if (remaining < 0) throw new Error("Cannot transfer more shares than the transferor holds.");

        if (remaining === 0) {
          await tx`
            update shareholdings
            set number_of_shares = 0, cessation_date = ${current.effectiveDate ?? current.updatedAt.slice(0, 10)},
                updated_at = now()
            where id = ${current.transferorShareholdingId}
          `;
        } else {
          await tx`
            update shareholdings set number_of_shares = ${remaining}, updated_at = now()
            where id = ${current.transferorShareholdingId}
          `;
        }

        if (current.transfereeShareholdingId) {
          await tx`
            update shareholdings
            set number_of_shares = number_of_shares + ${current.sharesTransferred}, updated_at = now()
            where id = ${current.transfereeShareholdingId}
          `;
        } else {
          await clientsRepository.recordShareholding({
            companyId: current.companyId,
            shareholderName: current.transfereeNewShareholderName!,
            shareholderAddress: current.transfereeNewShareholderAddress,
            shareClass: "Ordinary",
            numberOfShares: current.sharesTransferred!,
            allotmentDate: current.effectiveDate ?? current.updatedAt.slice(0, 10),
            actorId: input.actorId,
          });
        }
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/corporate-changes/repository.test.ts`
Expected: PASS (all tests, full file)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/repository.ts src/features/corporate-changes/repository.test.ts
git commit -m "feat: complete share_transfer requests with atomic two-row share movement"
```

---

### Task 16: `src/features/corporate-changes/server-fns.ts`

**Files:**
- Create: `src/features/corporate-changes/server-fns.ts`
- Test: `src/features/corporate-changes/server-fns.test.ts`

- [ ] **Step 1: Write the failing test** (a thin authorization-focused test, following the style of `clients/server-fns.test.ts` if one exists — check first with `ls src/features/clients/*.test.ts`; if no such file exists, model this on the pattern used by `src/features/incorporation/server-fns.ts`'s own test file instead)

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/neon-auth-server", () => ({
  requireStaffActor: vi.fn(),
}));

import { requireStaffActor } from "@/features/auth/neon-auth-server";
import { createCorporateChangeRequest } from "./server-fns";

describe("createCorporateChangeRequest", () => {
  it("rejects a Client-role actor before touching the repository", async () => {
    vi.mocked(requireStaffActor).mockRejectedValue(new Error("Forbidden: staff access is required."));

    await expect(
      createCorporateChangeRequest({
        data: {
          changeType: "address_change",
          companyId: "00000000-0000-0000-0000-000000000001",
          quotedFee: 2800,
          newRegisteredOffice: "88 New Road, Hong Kong",
        },
      } as never),
    ).rejects.toThrow(/Forbidden/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/corporate-changes/server-fns.test.ts`
Expected: FAIL with "Cannot find module './server-fns'"

- [ ] **Step 3: Write `server-fns.ts`**, following the exact `withClientRepository`/`requireWritableCompany` shape from `clients/server-fns.ts` (research §3), adapted to this feature's repository and authorization module:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { requireStaffActor } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertCorporateChangeRequestWritable } from "./authorization";
import {
  createCorporateChangeRequestRepository,
  type CorporateChangeRequestRepository,
} from "./repository";
import type { CreateCorporateChangeRequestInput } from "./types";

async function withRepository<T>(
  handler: (repository: CorporateChangeRequestRepository) => Promise<T>,
): Promise<T> {
  const repository = createCorporateChangeRequestRepository();
  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

async function requireWritableRequestCompany(
  repository: CorporateChangeRequestRepository,
  companyId: string,
): Promise<AuthenticatedActor> {
  const actor = await requireStaffActor(getRequest());
  const teamId = await repository.getCompanyTeamId(companyId);
  assertCorporateChangeRequestWritable(actor, { assignedTeamId: teamId });
  return actor;
}

const baseCreateSchema = z.object({
  companyId: z.string().uuid(),
  quotedFee: z.number().nonnegative(),
});

const createNameChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("name_change"),
  newNameEn: z.string().min(1),
  newNameZh: z.string().nullable(),
});

const createShareTransferSchema = baseCreateSchema
  .extend({
    changeType: z.literal("share_transfer"),
    transferorShareholdingId: z.string().uuid(),
    sharesTransferred: z.number().int().positive(),
    consideration: z.number().nonnegative(),
    stampDutyAmount: z.number().nonnegative(),
    transfereeShareholdingId: z.string().uuid().nullable(),
    transfereeNewShareholderName: z.string().nullable(),
    transfereeNewShareholderAddress: z.string().nullable(),
  })
  .refine(
    (input) => Boolean(input.transfereeShareholdingId) !== Boolean(input.transfereeNewShareholderName),
    { message: "Provide exactly one of an existing transferee or a new shareholder name.", path: ["transfereeShareholdingId"] },
  );

const createOfficerChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("officer_change"),
  officerAction: z.enum(["appoint", "resign", "detail_change"]),
  officerId: z.string().uuid().nullable(),
  newOfficerType: z.enum(["director", "secretary"]).nullable(),
  newOfficerName: z.string().nullable(),
  newOfficerIdentificationType: z.enum(["hkid", "passport", "br_number"]).nullable(),
  newOfficerIdentificationNumber: z.string().nullable(),
  newOfficerAddress: z.string().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const createAddressChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("address_change"),
  newRegisteredOffice: z.string().min(1),
});

const createCorporateChangeRequestSchema = z.discriminatedUnion("changeType", [
  createNameChangeSchema,
  createShareTransferSchema,
  createOfficerChangeSchema,
  createAddressChangeSchema,
]);

export const createCorporateChangeRequest = createServerFn({ method: "POST" })
  .validator(createCorporateChangeRequestSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const actor = await requireWritableRequestCompany(repository, data.companyId);
      return repository.createRequest({ ...data, actorId: actor.userId! } as CreateCorporateChangeRequestInput);
    }),
  );

const updateChecklistItemStatusSchema = z.object({
  requestId: z.string().uuid(),
  itemId: z.string().uuid(),
  status: z.enum(["Missing", "Received", "Verified", "Rejected"]),
  note: z.string().nullable(),
});

export const updateCorporateChangeChecklistItemStatus = createServerFn({ method: "POST" })
  .validator(updateChecklistItemStatusSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actor = await requireWritableRequestCompany(repository, request.companyId);
      return repository.updateChecklistItemStatus({ ...data, actorId: actor.userId! });
    }),
  );

const transitionStatusSchema = z.object({
  requestId: z.string().uuid(),
  toStatus: z.enum(["Requested", "Documents pending", "Ready to file", "Filed with Registrar", "Completed", "Cancelled"]),
});

export const transitionCorporateChangeRequestStatus = createServerFn({ method: "POST" })
  .validator(transitionStatusSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actor = await requireWritableRequestCompany(repository, request.companyId);
      return repository.transitionStatus({ ...data, actorId: actor.userId! });
    }),
  );

const requestIdSchema = z.object({ requestId: z.string().uuid() });

export const cancelCorporateChangeRequest = createServerFn({ method: "POST" })
  .validator(requestIdSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actor = await requireWritableRequestCompany(repository, request.companyId);
      return repository.cancelRequest({ ...data, actorId: actor.userId! });
    }),
  );

export const completeCorporateChangeRequest = createServerFn({ method: "POST" })
  .validator(requestIdSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actor = await requireWritableRequestCompany(repository, request.companyId);
      return repository.completeRequest({ ...data, actorId: actor.userId! });
    }),
  );

const listSchema = z.object({
  changeType: z.enum(["name_change", "share_transfer", "officer_change", "address_change"]).optional(),
  status: z.enum(["Requested", "Documents pending", "Ready to file", "Filed with Registrar", "Completed", "Cancelled"]).optional(),
});

export const listCorporateChangeRequests = createServerFn({ method: "GET" })
  .validator(listSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const actor = await requireStaffActor(getRequest());
      return repository.listRequests({
        ...data,
        teamId: actor.role === "Admin" ? undefined : (actor.teamId ?? undefined),
      });
    }),
  );

export const getCorporateChangeRequest = createServerFn({ method: "GET" })
  .validator(z.object({ requestId: z.string().uuid() }))
  .handler(async ({ data }) => withRepository((repository) => repository.getRequest(data.requestId)));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/corporate-changes/server-fns.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/server-fns.ts src/features/corporate-changes/server-fns.test.ts
git commit -m "feat: add corporate change request server functions"
```

---

### Task 17: Demo notice + navigation entry + `page-header.convention.test.ts` allowlist

**Files:**
- Create: `src/features/corporate-changes/components/demo-corporate-change-notice.tsx`
- Modify: `src/components/navigation.ts`
- Modify: `src/components/page-header.convention.test.ts`

- [ ] **Step 1: Write the demo notice component**, copying the `DemoIncorporationNotice` pattern exactly (research §12):

```tsx
import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "list" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  list: {
    title: "Corporate changes",
    message:
      "Corporate change requests track live case data and have no demo fixtures. Sign in to a production environment to use them.",
  },
  detail: {
    title: "Corporate change request",
    message:
      "Corporate change request detail reads live case data and has no demo fixtures. Sign in to a production environment to view one.",
  },
};

export function DemoCorporateChangeNotice({ variant }: Props) {
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

- [ ] **Step 2: Add the navigation entry**

In `src/components/navigation.ts`, add `Repeat2` (or another unused `lucide-react` icon — confirm it isn't already imported) to the icon import block, and insert the new item right after "Incorporation":

```ts
      { to: "/incorporation", label: "Incorporation", icon: Rocket },
      { to: "/corporate-changes", label: "Corporate changes", icon: Repeat2 },
      { to: "/documents", label: "Documents", icon: FileText },
```

- [ ] **Step 3: Add the two new routes to the page-header convention allowlist**

In `src/components/page-header.convention.test.ts`, extend the `passThroughRoutes` Set:

```ts
    const passThroughRoutes = new Set([
      "routes/__root.tsx",
      "routes/login.tsx",
      // A pass-through to the demo and production case-detail components, which
      // render the header themselves.
      "routes/annual-returns.$id.tsx",
      // A pass-through to DemoClientNotice / ProductionClientRegister(/Detail), same reason.
      "routes/clients.tsx",
      "routes/clients.$id.tsx",
      // A pass-through to ProductionIncorporationList / DemoIncorporationNotice, same reason.
      "routes/incorporation.tsx",
      // A pass-through to ProductionIncorporationDetail / DemoIncorporationNotice, same reason.
      "routes/incorporation.$id.tsx",
      // A pass-through to ProductionCorporateChangeList / DemoCorporateChangeNotice, same reason.
      "routes/corporate-changes.tsx",
      // A pass-through to ProductionCorporateChangeDetail / DemoCorporateChangeNotice, same reason.
      "routes/corporate-changes.$id.tsx",
    ]);
```

- [ ] **Step 4: Run the convention test** (it will still fail until Task 20 adds the actual route files — run it now only to confirm no syntax errors in the allowlist edit)

Run: `npx vitest run src/components/page-header.convention.test.ts`
Expected: existing assertions still pass (the two new route paths aren't required to exist yet by this test — it only checks routes it finds under `src/routes/`)

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/components/demo-corporate-change-notice.tsx src/components/navigation.ts src/components/page-header.convention.test.ts
git commit -m "feat: add corporate changes demo notice, nav entry, and header allowlist"
```

---

### Task 18: `ProductionCorporateChangeList` + `CreateCorporateChangeRequestDialog`

**Known scope trim in this task, flagged up front**: this dialog only supports creating `name_change`/`address_change` requests directly. `share_transfer`/`officer_change` need a shareholding/officer picker scoped to the selected company's existing register (so staff pick a real `transferorShareholdingId`/`officerId`, not free text) — that picker does not exist as a reusable component anywhere in this codebase yet, and building it is out of scope for this task. The two buttons for those types are disabled with an explanatory message. This is a real, deliberate gap — not a bug — and should be raised as a fast-follow task before this plan is treated as fully closing P1-9's UI surface.

**Files:**
- Create: `src/features/corporate-changes/components/production-corporate-change-list.tsx`
- Create: `src/components/corporate-changes/create-corporate-change-request-dialog.tsx`
- Test: `src/components/corporate-changes/create-corporate-change-request-dialog.test.tsx`

- [ ] **Step 1: Write the failing dialog test** (mirrors `create-incorporation-case-dialog.test.tsx`'s shape — read that file first for the exact `render`/`userEvent` setup this codebase's component tests use, then follow it):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateCorporateChangeRequestDialog } from "./create-corporate-change-request-dialog";

vi.mock("@/features/corporate-changes/server-fns", () => ({
  createCorporateChangeRequest: vi.fn().mockResolvedValue({ id: "new-request-id" }),
}));

import { createCorporateChangeRequest } from "@/features/corporate-changes/server-fns";

describe("CreateCorporateChangeRequestDialog", () => {
  it("submits an address_change request with the entered fields", async () => {
    const onCreated = vi.fn();
    render(
      <CreateCorporateChangeRequestDialog
        open
        onOpenChange={() => {}}
        companies={[{ id: "company-1", companyName: "Test Co Ltd" }]}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/company/i), "company-1");
    await userEvent.selectOptions(screen.getByLabelText(/change type/i), "address_change");
    await userEvent.type(screen.getByLabelText(/quoted fee/i), "2800");
    await userEvent.type(screen.getByLabelText(/new registered office/i), "88 New Road, Hong Kong");
    await userEvent.click(screen.getByRole("button", { name: /create request/i }));

    await waitFor(() => {
      expect(createCorporateChangeRequest).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changeType: "address_change",
          companyId: "company-1",
          quotedFee: 2800,
          newRegisteredOffice: "88 New Road, Hong Kong",
        }),
      });
    });
    expect(onCreated).toHaveBeenCalledWith("new-request-id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/corporate-changes/create-corporate-change-request-dialog.test.tsx`
Expected: FAIL with "Cannot find module './create-corporate-change-request-dialog'"

- [ ] **Step 3: Write `CreateCorporateChangeRequestDialog`**, modeling the shadcn `Dialog` scaffolding directly on `CreateIncorporationCaseDialog` (research §7), with a `changeType` selector that swaps the visible sub-form:

```tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCorporateChangeRequest } from "@/features/corporate-changes/server-fns";
import type { CorporateChangeType } from "@/features/corporate-changes/types";

type CompanyOption = { id: string; companyName: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: CompanyOption[];
  isLoading: boolean;
  hasError: boolean;
  onCreated: (requestId: string) => void;
};

const CHANGE_TYPE_LABELS: Record<CorporateChangeType, string> = {
  name_change: "Name change",
  share_transfer: "Share transfer",
  officer_change: "Officer appointment/resignation/detail change",
  address_change: "Registered address change",
};

export function CreateCorporateChangeRequestDialog({
  open,
  onOpenChange,
  companies,
  isLoading,
  hasError,
  onCreated,
}: Props) {
  const [companyId, setCompanyId] = useState("");
  const [changeType, setChangeType] = useState<CorporateChangeType>("address_change");
  const [quotedFee, setQuotedFee] = useState("");
  const [newRegisteredOffice, setNewRegisteredOffice] = useState("");
  const [newNameEn, setNewNameEn] = useState("");
  const [newNameZh, setNewNameZh] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setCompanyId("");
    setChangeType("address_change");
    setQuotedFee("");
    setNewRegisteredOffice("");
    setNewNameEn("");
    setNewNameZh("");
    setSubmitError(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const base = { companyId, quotedFee: Number(quotedFee) };
      const data =
        changeType === "address_change"
          ? { ...base, changeType, newRegisteredOffice }
          : changeType === "name_change"
            ? { ...base, changeType, newNameEn, newNameZh: newNameZh || null }
            : null;
      if (!data) throw new Error(`${changeType} is created from its own dedicated screen.`);

      const created = await createCorporateChangeRequest({ data: data as never });
      reset();
      onOpenChange(false);
      onCreated(created.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to create request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New corporate change request</DialogTitle>
          <DialogDescription>
            Record an ad hoc name change, share transfer, officer change, or address change.
          </DialogDescription>
        </DialogHeader>

        {hasError ? (
          <p className="text-sm text-destructive">Failed to load companies. Try closing and reopening this dialog.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <select
                id="company"
                aria-label="Company"
                className="w-full rounded-md border p-2"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                disabled={isLoading}
              >
                <option value="">Select a company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="change-type">Change type</Label>
              <select
                id="change-type"
                aria-label="Change type"
                className="w-full rounded-md border p-2"
                value={changeType}
                onChange={(event) => setChangeType(event.target.value as CorporateChangeType)}
              >
                {Object.entries(CHANGE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quoted-fee">Quoted fee (HKD)</Label>
              <Input
                id="quoted-fee"
                aria-label="Quoted fee"
                type="number"
                value={quotedFee}
                onChange={(event) => setQuotedFee(event.target.value)}
              />
            </div>

            {changeType === "address_change" && (
              <div className="space-y-2">
                <Label htmlFor="new-registered-office">New registered office</Label>
                <Input
                  id="new-registered-office"
                  aria-label="New registered office"
                  value={newRegisteredOffice}
                  onChange={(event) => setNewRegisteredOffice(event.target.value)}
                />
              </div>
            )}

            {changeType === "name_change" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-name-en">New English name</Label>
                  <Input
                    id="new-name-en"
                    aria-label="New English name"
                    value={newNameEn}
                    onChange={(event) => setNewNameEn(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-name-zh">New Chinese name (optional)</Label>
                  <Input
                    id="new-name-zh"
                    aria-label="New Chinese name"
                    value={newNameZh}
                    onChange={(event) => setNewNameZh(event.target.value)}
                  />
                </div>
              </>
            )}

            {(changeType === "share_transfer" || changeType === "officer_change") && (
              <p className="text-sm text-muted-foreground">
                Share transfer and officer change requests need a shareholding/officer picker
                scoped to this company's register, which is not built yet — see this task's
                flagged scope trim. Use name change or address change here for now.
              </p>
            )}

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting ||
              !companyId ||
              !quotedFee ||
              (changeType === "address_change" && !newRegisteredOffice) ||
              (changeType === "name_change" && !newNameEn) ||
              changeType === "share_transfer" ||
              changeType === "officer_change"
            }
          >
            Create request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write `ProductionCorporateChangeList`**

```tsx
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CreateCorporateChangeRequestDialog } from "@/components/corporate-changes/create-corporate-change-request-dialog";
import { listCorporateChangeRequests } from "@/features/corporate-changes/server-fns";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";

export function ProductionCorporateChangeList() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const requestsQuery = useQuery({
    queryKey: ["corporate-change-requests"],
    queryFn: () => listCorporateChangeRequests({ data: {} }),
  });

  const companiesQuery = useQuery({
    queryKey: ["client-assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    enabled: isCreateOpen,
  });

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="Corporate changes">
        <Button onClick={() => setIsCreateOpen(true)}>New request</Button>
      </PageHeader>

      <section className="rounded-lg border bg-card">
        {requestsQuery.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading requests…</p>
        ) : requestsQuery.isError ? (
          <p className="p-6 text-sm text-destructive">Failed to load corporate change requests.</p>
        ) : requestsQuery.data!.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No corporate change requests yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Company</th>
                <th className="p-3">Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Quoted fee</th>
              </tr>
            </thead>
            <tbody>
              {requestsQuery.data!.map((request) => (
                <tr key={request.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link to="/corporate-changes/$id" params={{ id: request.id }} className="underline">
                      {request.companyName}
                    </Link>
                  </td>
                  <td className="p-3">{request.changeType.replace("_", " ")}</td>
                  <td className="p-3">{request.status}</td>
                  <td className="p-3">HKD {request.quotedFee.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <CreateCorporateChangeRequestDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        companies={(companiesQuery.data?.companies ?? []).map((company) => ({
          id: company.id,
          companyName: company.companyName,
        }))}
        isLoading={companiesQuery.isLoading}
        hasError={companiesQuery.isError}
        onCreated={() => requestsQuery.refetch()}
      />
    </main>
  );
}
```

(Confirm the exact shape `listClientAssignmentOptions()` returns — research §7 confirms it's already used by `ProductionIncorporationList` for owner/team dropdowns; adjust the `.companies` access path to whatever field actually holds company options, checking `src/features/clients/types.ts`'s `ClientAssignmentOptions` type if it differs from a bare `.companies` array.)

- [ ] **Step 5: Run the dialog test to verify it passes**

Run: `npx vitest run src/components/corporate-changes/create-corporate-change-request-dialog.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/corporate-changes/components/production-corporate-change-list.tsx src/components/corporate-changes/create-corporate-change-request-dialog.tsx src/components/corporate-changes/create-corporate-change-request-dialog.test.tsx
git commit -m "feat: add corporate change request list screen and creation dialog"
```

---

### Task 19: `ProductionCorporateChangeDetail` (checklist, status stepper, complete/cancel)

**Files:**
- Create: `src/features/corporate-changes/components/production-corporate-change-detail.tsx`
- Test: `src/features/corporate-changes/components/production-corporate-change-detail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductionCorporateChangeDetail } from "./production-corporate-change-detail";

vi.mock("@/features/corporate-changes/server-fns", () => ({
  getCorporateChangeRequest: vi.fn().mockResolvedValue({
    id: "request-1",
    companyId: "company-1",
    changeType: "address_change",
    status: "Filed with Registrar",
    quotedFee: 2800,
    newRegisteredOffice: "88 New Road, Hong Kong",
    checklistItems: [
      { id: "item-1", requestId: "request-1", itemLabel: "NR1 form", required: true, status: "Verified", note: null, receivedAt: null, verifiedAt: null },
    ],
  }),
  completeCorporateChangeRequest: vi.fn().mockResolvedValue({ status: "Completed" }),
  updateCorporateChangeChecklistItemStatus: vi.fn(),
  cancelCorporateChangeRequest: vi.fn(),
  transitionCorporateChangeRequestStatus: vi.fn(),
}));

import { completeCorporateChangeRequest } from "@/features/corporate-changes/server-fns";

describe("ProductionCorporateChangeDetail", () => {
  it("enables Complete once status is Filed with Registrar and all required items are Verified", async () => {
    render(<ProductionCorporateChangeDetail requestId="request-1" />);

    const completeButton = await screen.findByRole("button", { name: /complete/i });
    expect(completeButton).not.toBeDisabled();

    await userEvent.click(completeButton);

    await waitFor(() => {
      expect(completeCorporateChangeRequest).toHaveBeenCalledWith({ data: { requestId: "request-1" } });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/corporate-changes/components/production-corporate-change-detail.test.tsx`
Expected: FAIL with "Cannot find module './production-corporate-change-detail'"

- [ ] **Step 3: Write `ProductionCorporateChangeDetail`**

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  cancelCorporateChangeRequest,
  completeCorporateChangeRequest,
  getCorporateChangeRequest,
  updateCorporateChangeChecklistItemStatus,
} from "@/features/corporate-changes/server-fns";
import type { ChecklistItemStatus } from "@/features/corporate-changes/types";

type Props = { requestId: string };

export function ProductionCorporateChangeDetail({ requestId }: Props) {
  const queryClient = useQueryClient();

  const requestQuery = useQuery({
    queryKey: ["corporate-change-request", requestId],
    queryFn: () => getCorporateChangeRequest({ data: { requestId } }),
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["corporate-change-request", requestId] });
  }

  async function handleChecklistStatus(itemId: string, status: ChecklistItemStatus) {
    await updateCorporateChangeChecklistItemStatus({ data: { requestId, itemId, status, note: null } });
    await invalidate();
  }

  async function handleComplete() {
    await completeCorporateChangeRequest({ data: { requestId } });
    await invalidate();
  }

  async function handleCancel() {
    await cancelCorporateChangeRequest({ data: { requestId } });
    await invalidate();
  }

  if (requestQuery.isLoading) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="Operations" title="Corporate change request" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (requestQuery.isError || !requestQuery.data) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="Operations" title="Corporate change request" />
        <p className="text-sm text-destructive">Failed to load this request.</p>
      </main>
    );
  }

  const request = requestQuery.data;
  const requiredItemsVerified = request.checklistItems
    .filter((item) => item.required)
    .every((item) => item.status === "Verified");
  const canComplete = request.status === "Filed with Registrar" && requiredItemsVerified;
  const canCancel = request.status !== "Completed" && request.status !== "Cancelled";

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="Corporate change request">
        <div className="flex gap-2">
          <Button onClick={handleComplete} disabled={!canComplete}>
            Complete
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={!canCancel}>
            Cancel request
          </Button>
        </div>
      </PageHeader>

      <section className="rounded-lg border bg-card p-6 text-sm">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-muted-foreground">Change type</dt>
            <dd>{request.changeType.replace("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{request.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Quoted fee</dt>
            <dd>HKD {request.quotedFee.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border bg-card">
        <h2 className="border-b p-4 text-sm font-medium">Checklist</h2>
        <ul>
          {request.checklistItems.map((item) => (
            <li key={item.id} className="flex items-center justify-between border-b p-4 last:border-0">
              <span>
                {item.itemLabel}
                {item.required ? "" : " (optional)"}
              </span>
              <select
                aria-label={`${item.itemLabel} status`}
                value={item.status}
                onChange={(event) =>
                  handleChecklistStatus(item.id, event.target.value as ChecklistItemStatus)
                }
                className="rounded-md border p-1 text-sm"
              >
                <option value="Missing">Missing</option>
                <option value="Received">Received</option>
                <option value="Verified">Verified</option>
                <option value="Rejected">Rejected</option>
              </select>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/corporate-changes/components/production-corporate-change-detail.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/corporate-changes/components/production-corporate-change-detail.tsx src/features/corporate-changes/components/production-corporate-change-detail.test.tsx
git commit -m "feat: add corporate change request detail screen"
```

---

### Task 20: Routes — `/corporate-changes` and `/corporate-changes/$id`

**Files:**
- Create: `src/routes/corporate-changes.tsx`
- Create: `src/routes/corporate-changes.$id.tsx`

- [ ] **Step 1: Write both route files**, copying the incorporation routes exactly (research §7):

`src/routes/corporate-changes.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeList } from "@/features/corporate-changes/components/production-corporate-change-list";

export const Route = createFileRoute("/corporate-changes")({
  component: CorporateChangesRoute,
});

function CorporateChangesRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoCorporateChangeNotice variant="list" />
  ) : (
    <ProductionCorporateChangeList />
  );
}
```

`src/routes/corporate-changes.$id.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeDetail } from "@/features/corporate-changes/components/production-corporate-change-detail";

export const Route = createFileRoute("/corporate-changes/$id")({
  component: CorporateChangeDetailRoute,
});

function CorporateChangeDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoCorporateChangeNotice variant="detail" />
  ) : (
    <ProductionCorporateChangeDetail requestId={id} />
  );
}
```

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run dev` briefly (TanStack Router's Vite plugin regenerates `routeTree.gen.ts` on file changes), or run whatever this project's dedicated route-generation command is if one exists — check `package.json` scripts for a `routes` or `tsr generate` entry first.

- [ ] **Step 3: Run the full test suite**, since `page-header.convention.test.ts` now has real files to check against its Task 17 allowlist entries:

Run: `npm run test`
Expected: PASS, including `page-header.convention.test.ts`'s "is rendered by every route that draws a page" assertion.

- [ ] **Step 4: Manual demo-mode smoke test**

Run: `npm run dev`, navigate to `/corporate-changes` and `/corporate-changes/some-id` in demo mode.
Expected: both show the "no demo fixtures" notice, matching `/clients` and `/incorporation`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/corporate-changes.tsx src/routes/corporate-changes.$id.tsx src/routeTree.gen.ts
git commit -m "feat: add /corporate-changes and /corporate-changes/:id routes"
```

---

### Task 21: `cleanupClientFixtures()` — new FK ordering for `corporate_change_requests`

Officers/shareholdings tests that also exercise corporate-change completion (Tasks 14-15) create `corporate_change_requests` rows referencing test companies with `on delete restrict`. Any test file that deletes those companies must delete `corporate_change_requests` (and `work_items` referencing them) first, or cleanup silently fails to delete and fixtures leak across test runs.

**Files:**
- Modify: `src/features/clients/repository.test.ts` (the `cleanupClientFixtures` function, research §11)

- [ ] **Step 1: Add the missing delete lines**

In `cleanupClientFixtures()`, immediately after the existing `scr_inspection_requests` delete line and before the `companies` deletes:

```ts
  await sql`delete from work_items where corporate_change_request_id in (
    select id from corporate_change_requests where company_id = any(${allCompanyIds}::uuid[])
  )`;
  await sql`delete from corporate_change_requests where company_id = any(${allCompanyIds}::uuid[])`;
```

- [ ] **Step 2: Run the full clients + corporate-changes integration suites to confirm no fixture leakage**

Run: `npx vitest run src/features/clients/repository.test.ts src/features/corporate-changes/repository.test.ts` (requires `TEST_DATABASE_URL`)
Expected: PASS, run twice in a row with no state-dependent failures on the second run (proves cleanup is complete).

- [ ] **Step 3: Commit**

```bash
git add src/features/clients/repository.test.ts
git commit -m "test: clean up corporate_change_requests/work_items fixtures before companies"
```

---

### Task 22: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all tests pass; note the pass/skip counts (DB-integration tests skip without `TEST_DATABASE_URL`, as established for every prior roadmap item).

- [ ] **Step 2: Typecheck and lint**

Run: `npm run build`
Run: `npm run lint`
Expected: both clean.

- [ ] **Step 3: `verify:firm` gate**

Run: `npm run verify:firm -- --dry-run`
Expected: PASS.

- [ ] **Step 4: Manual demo-mode smoke test across the whole app**

Run: `npm run dev`, click through `/`, `/work-queue`, `/annual-returns`, `/clients`, `/incorporation`, `/corporate-changes`, `/documents`, `/portal`, `/payments` in demo mode.
Expected: no console errors, no regressions in any pre-existing screen, `/corporate-changes` and `/corporate-changes/$id` both show the expected notice.

- [ ] **Step 5: If a real database with `TEST_DATABASE_URL` is available, run the DB-integration suites for real**

Run: `TEST_DATABASE_URL=<scratch-db-url> npm run test`
Expected: PASS, including the two share-transfer share-movement tests and the officer-completion test — these exercise real cross-feature transaction reuse (Tasks 14-15) that cannot be verified any other way.

- [ ] **Step 6: Push, open the PR, and confirm CI's `verify` job (not just `state: MERGED`) is `SUCCESS` before treating this as done** — per the standing discipline from PR #46's near-miss and PR #48/#49/#51's confirmed-green precedent:

```bash
git push -u origin codex/corporate-change-requests
gh pr create --title "feat: ad hoc corporate change requests (P1-9)" --body "Implements P1-9 per docs/superpowers/specs/2026-08-23-corporate-change-requests-design.md"
```

Then: `gh pr checks <n> --watch` (or `gh pr view <n> --json statusCheckRollup` after CI finishes) — do not merge until `verify` reports `SUCCESS`.

---

## Plan self-review notes

- **Spec coverage**: every section of the design spec has a corresponding task — data model (Tasks 1, 3), work-item/SLA integration (Tasks 2, 8, 9), completion behavior for all four types (Tasks 13-15), UI (Tasks 17-20), authorization (Task 6), checklist content (Task 5), and the fixture-cleanup item named in the spec's verification plan (Task 21).
- **Real gap surfaced during planning, not in the spec**: `EnsureWorkItemEvent.annualReturnCaseId` was typed as a required `string` even though the DB column is nullable — Task 8 widens it correctly rather than leaving a latent type lie.
- **Known scope trim, flagged in Task 18 itself**: the general-purpose creation dialog only supports `name_change`/`address_change` directly; `share_transfer`/`officer_change` need a shareholding/officer picker scoped to the company's existing register, which isn't built in this plan as a standalone task. The two buttons are disabled with an explanatory message rather than silently broken. **This is a real follow-up gap to raise with the user before execution begins** — either accept it as a documented fast-follow, or add a Task 18a for the picker before starting.
