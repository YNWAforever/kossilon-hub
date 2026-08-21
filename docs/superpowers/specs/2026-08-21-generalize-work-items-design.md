# Generalize Work Items Beyond Annual Returns (P1-4) — Design

## Overview

`work_items` — the SLA/assignment/escalation engine every future service line needs — is
hard-wired to annual returns: `case_id uuid not null references annual_return_cases(id)`
(`db/migrations/0006_production_assignment_sla_foundation.sql:82-89`). No other case type
(P1-6 significant-controllers, P1-7 incorporation intake, P1-9 ad hoc corporate changes) can
ever create a work item until this FK is generalized. This is the structural gate named in
the roadmap for P1-6 through P1-9.

## Confirmed facts

- The blast radius is small and fully enumerated, not sprawling:
  - Exactly 2 call sites of `ensureWorkItemForEvent`, both in `annual-return/repository.ts`
    (case creation, and the pre-existing seed-linked ensure-call).
  - `work_items`' own reads (`listQueue`, `get`, the assignment-candidate query) never join to
    `annual_return_cases` — company_id, owner_id, team_id, title all already live on the row
    itself, set once at `ensureWorkItemForEvent` time.
  - `assignment_events`, `escalation_events`, `notification_outbox` all key off `work_item_id`,
    not `case_id` — already insulated from this change.
  - `sla_policies.work_type` is already free text, not tied to annual returns structurally.
- `timeline_events.case_id` is already nullable (unlike every other `case_id` column in the
  schema) — but still FK'd only to `annual_return_cases`, and out of scope here (see below).
- The only UI consumers of a work item's case reference are `work-queue.tsx` (two hardcoded
  `to="/annual-returns/$id"` links) and the demo/production annual-return command centers'
  `workItemsByCase` correlation maps (`annual-returns.tsx`, `production-command-center.tsx`).

## Scope

**In scope:**
- Add `case_type` + a per-type nullable FK column (`annual_return_case_id`) to `work_items`,
  replacing the single `case_id` column.
- Update `EnsureWorkItemEvent`/`ensureWorkItemForEvent`, `PersistedWorkItem`, and the row
  mapping in `work-items/repository.ts`.
- Update the 2 existing call sites in `annual-return/repository.ts`.
- Update the 4 known consumers of a work item's case reference (`work-queue.tsx`'s two links,
  and both command centers' `workItemsByCase` maps).
- Update the work-items test fixtures affected by the shape change.

**Out of scope, explicitly:**
- No new case type is introduced. This is a pure generalization — the annual-return flow works
  identically after this lands; P1-6/7/9 each add their own case type, own migration, own FK
  column, on their own future roadmap turn.
- `timeline_events`, `case_notes`, `reminder_logs`, `payments`, `annual_return_checklist_items`
  stay hard-tied to `annual_return_cases`. These are annual-return-specific domain concepts,
  not part of the SLA/assignment engine — future case types define their own equivalents
  rather than reusing these tables.
- No change to `sla_policies` seed data — `work_type` already supports arbitrary values; a
  future case type just seeds its own policy row(s), no schema change needed there.

## Schema

New migration `db/migrations/0014_generalize_work_item_case_reference.sql`, forward-only:

1. `alter table work_items add column case_type text;`
   `alter table work_items add column annual_return_case_id uuid references annual_return_cases(id) on delete restrict;`
2. Backfill: `update work_items set case_type = 'annual_return', annual_return_case_id = case_id;`
3. `alter table work_items alter column case_type set not null;`
   `alter table work_items add constraint work_items_case_type_check check (case_type in ('annual_return'));`
   (Extended by one value in the migration that introduces each future case type — mirrors
   `checklist_templates.service_type`'s existing CHECK-list convention.)
4. `alter table work_items add constraint work_items_case_reference_check check (case_type <> 'annual_return' or annual_return_case_id is not null);`
   (Written as an OR-chain so a future migration appends one clause per new type rather than
   rewriting the constraint.)
5. Drop the old `case_id` column and its FK — nothing else in the schema references
   `work_items.case_id`, so this is a clean removal.

`src/server/db/schema.sql` updated to match (the canonical, from-scratch schema — this
codebase applies migrations forward-only but keeps `schema.sql` as the current-state
reference, per existing convention).

## Types & repository layer

`src/features/work-items/types.ts`:
```ts
export type WorkItemCaseType = "annual_return";
```

A literal union, not free text like `workType`. `workType` is purely a lookup key into
`sla_policies` — a runtime value with no branching logic attached. `caseType` has to drive
different code branches (which ID column to read, which detail route to link to), so a
literal union gets TypeScript to flag every switch/map that needs a new arm the moment a
future roadmap item adds `"scr" | "incorporation" | ...` — the same exhaustiveness benefit
this codebase already leans on (e.g. `Record<ClientPaymentStatus, StatusTone>` in the client
register).

`src/features/work-items/repository.ts`:
- `PersistedWorkItem`: replace `caseId: string` with `caseType: WorkItemCaseType` and
  `annualReturnCaseId: string | null`.
- `EnsureWorkItemEvent`: replace `caseId: string` with `caseType: WorkItemCaseType` and
  `annualReturnCaseId?: string` (each future case type adds its own optional field; each
  caller populates only its own).
- `ensureWorkItemForEvent`'s INSERT statement and `mapWorkItem`'s row-to-domain mapping follow
  the column rename.
- The assignment-candidate query (currently `select ... case_id ... from work_items`) reads
  `annual_return_case_id` instead.

`src/features/annual-return/repository.ts`: both `ensureWorkItemForEvent` call sites change
`caseId: newCaseId` → `caseType: "annual_return", annualReturnCaseId: newCaseId`.

## Consumers

- **`src/routes/work-queue.tsx`**: the two `<Link to="/annual-returns/$id" params={{ id:
  item.caseId }}>` blocks (desktop row, mobile card) are replaced by a shared
  `caseDetailLinkFor(item: PersistedWorkItem)` helper returning `{ to: string; params: { id:
  string } } | null`, built from an exhaustive `switch (item.caseType)` with one case
  (`"annual_return"` → `/annual-returns/$id`, `params: { id: item.annualReturnCaseId }`) and a
  compile-time exhaustiveness check (an unreachable `default` assigning to `never`) so a
  future case type without a matching branch fails the build rather than silently rendering
  nothing.
- **`src/routes/annual-returns.tsx`** (demo command center) and
  **`src/features/annual-return/components/production-command-center.tsx`** (production
  command center): both build a `workItemsByCase` map keyed by `item.caseId`. Both switch to
  keying on `item.annualReturnCaseId`, skipping entries where it's `null` (defensive; nothing
  produces a null one today since no other case type exists yet).
- Test fixtures in `work-items/repository.test.ts`, `server-fns.test.ts`,
  `server-orchestration.test.ts` updated to the new shape.

## Testing

- Repository integration tests (`describe.skipIf(!databaseUrl)`) are where a CHECK-constraint
  mistake would actually surface — a unit test with a mocked `sql` tag can't catch a real
  Postgres constraint violation. Existing coverage for `ensureWorkItemForEvent` extends to
  assert the new columns are populated correctly and the CHECK constraints hold.
- `work-queue.tsx`'s new `caseDetailLinkFor` helper gets a focused unit test asserting the
  link shape for `"annual_return"` — the exhaustiveness check itself is enforced by the
  TypeScript compiler, not a test.
- No new demo-mode work needed — work-queue and the annual-return command centers already
  have both data-mode variants; this change doesn't add or remove either.

## Acceptance

1. `work_items` no longer hard-requires an `annual_return_cases` row — a future case type can
   call `ensureWorkItemForEvent` with its own `caseType` and its own nullable FK column, added
   in its own migration, without touching this generalized shape again.
2. Every existing annual-return workflow (case creation → work item → work queue → SLA/
   escalation → command-center display) behaves identically to today.
3. `work-queue.tsx`'s case-type switch is exhaustiveness-checked at compile time.
4. Full suite green, including the repository integration tests run against a real database.
