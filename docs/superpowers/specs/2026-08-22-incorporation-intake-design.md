# P1-7: Incorporation Intake (New HK Company) — Design

## Context

From `01-Kossilon-Hub-Roadmap-P0-P3.md`: "Incorporation intake (new HK + shelf) —
Nothing beyond a demo checklist template. Intake case type collecting the Q1
document set (中英文名稱, 股東/董事 ID + address proof ≤3 months, 營業執照 for
corporate shareholders, 註冊資本, 業務性質與計劃書), with the two SLA tracks from
Q2 (4–7 working days new / 2–3 working days shelf). Feeds a `companies` row on
completion."

This is the first roadmap item unblocked by P1-4, P1-5, and P1-12 (all merged) that
is genuinely novel rather than an extension: every existing case type operates on an
already-existing company; an incorporation case has no company at all until it
completes.

## Scope

In scope:
- A new case type tracking new-HK-company incorporation intake from case creation
  through Companies Registry approval, ending in a real `companies` row.
- A document checklist (status tracking only — see Data model) seeded from the
  already-existing "Incorporation — HK Ltd" `checklist_templates` row (P1-12).
- New `/incorporation` (list) and `/incorporation/$id` (detail) screens, production
  mode only.

Out of scope (explicitly deferred):
- **Shelf company transfer.** The roadmap names it alongside new-HK incorporation,
  but it is a materially different workflow — transferring officers/shareholders on
  an *already-existing* company — closer in shape to P1-9's ad hoc change requests
  than to fresh incorporation. Left for a future item.
- **Any change to `work_items`, `documents`, `document_upload_intents`, or the
  SLA-policy engine.** An incorporation case has no `company_id` to satisfy those
  tables' current `not null` constraints, and generalizing all three (as P1-4 did
  for `work_items`'s case-type reference) would roughly double this item's schema
  surface. This pass builds a fully self-contained pair of tables instead; work-queue
  and generic-document integration are natural fast-follows once this exists, not
  prerequisites for it.
- **Auto-populating directors/shareholders/significant-controllers on completion.**
  Completion creates only the `companies` row and its secretary officer — exactly
  what `createClient` already does today. Staff add directors, shareholders, and
  controllers afterward via the existing `OfficerFormDialog`/`ShareholdingFormDialog`/
  `ControllerFormDialog` UI (from P1-5/P1-6), using the case's checklist as their
  reference for who to add. This avoids duplicating validation logic that already
  exists in those dialogs.
- **File uploads for checklist documents.** Items track status
  (Missing/Received/Verified/Rejected) + timestamps + a free-text note only, no file
  storage. A real upload pipeline for pre-company documents is exactly the class of
  fast-follow the `documents`-table generalization becomes once this ships.
- **Auto-computed `target_completion_date`.** Accurately computing "4-7 working
  days" needs the business-calendar machinery already built for `sla_policies`,
  deliberately not touched here. Staff set this date directly at case creation,
  matching the same choice already made for P1-6's `register_update_due_date`.
- **A demo-mode fixture tier.** Matches the existing `/clients` exception — this
  screen's whole purpose is a multi-step write workflow a read-only demo can't
  meaningfully showcase.

## Data model

### `incorporation_cases` (new table)

```sql
create table if not exists incorporation_cases (
  id uuid primary key default gen_random_uuid(),
  proposed_company_name_en text not null,
  proposed_company_name_zh text,
  proposed_registered_office text not null,
  proposed_company_secretary text not null,
  registered_capital numeric(14,2) not null check (registered_capital > 0),
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
```

Notes:
- **Status is a 5-state linear machine** (`Intake → Documents pending → Ready to
  file → Filed with Registrar → Completed`), matching `annual_return_cases`'s
  naming convention and its forward-one-step-at-a-time transition guard
  (`isAllowedStatusTransition` in `annual-return/workflow.ts`) — a new,
  structurally identical `isAllowedIntakeStatusTransition` guards this table.
- **`target_completion_date` is staff-set, not computed** (see Scope).
- **`team_id` is its own column, not derived via a `companies` join** — a
  deliberate, necessary deviation from the convention P1-1 established for
  `annual_return_cases` (which has no `team_id` because it always has a company to
  derive one from). An incorporation case has no company yet, so team must live
  here directly.
- **`company_id` starts null and is set exactly once, on completion.** The
  `incorporation_cases_completed_has_company` CHECK enforces the pairing. It
  remains on the row afterward as a permanent link from the case to the company it
  created.
- No per-item checklist due dates — the entire case lifecycle is the few-day SLA
  window itself, so the single case-level `target_completion_date` is the only
  deadline that matters.

### `incorporation_checklist_items` (new table)

```sql
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

At case creation, the existing `checklist_templates` row named `"Incorporation — HK
Ltd"` (service_type `'Incorporation — HK Ltd'`, already seeded with 5 document
items by migration 0013) has its `documents` JSONB array copied into
`incorporation_checklist_items` rows — the same copy-at-creation pattern as
`annual_return_cases.createCase` (`src/features/annual-return/repository.ts:882-924`),
minus the `daysBeforeDue` → per-item-date computation (not needed here, per Data
model above). Each row gets a fresh `id`; there is no `template_item_id` FK back to
the template, matching the existing precedent — editing the template afterward does
not affect already-created cases.

`received_at`/`verified_at` use the same set-once `coalesce(existing, now())`
semantics as `annual_return_checklist_items`.

**Test fixture cleanup, called out explicitly because this exact class of bug has
broken CI twice already this quarter (PR #46/#47 for `officers`/`shareholdings`,
and again — caught before merge this time — in P1-6's `significant_controllers`)**:
`incorporation_cases.company_id` is `on delete restrict` against `companies`. Any
integration test that calls `completeIncorporationCase` creates a real `companies`
row, and that test file's own fixture cleanup MUST delete the `incorporation_cases`
row before deleting the `companies` row it created. This lives in a new
`src/features/incorporation/repository.test.ts` with its own cleanup helper — it
must be built correctly from the start, not discovered after a failing CI run.

## Repository & server-fns layer

New feature module `src/features/incorporation/` (`types.ts`, `repository.ts`,
`server-fns.ts`, `authorization.ts`) — a genuinely new case type gets its own
vertical slice, not an extension of `clients/`.

- **`createIncorporationCase`**: one transaction — inserts the case row, then
  copies the "Incorporation — HK Ltd" template's `documents` array into
  `incorporation_checklist_items` rows.
- **`updateChecklistItem`**: transitions an item between
  `Missing/Received/Verified/Rejected`, with `received_at`/`verified_at` set once
  via `coalesce(existing, now())`.
- **`updateCaseStatus`**: validated linear transition via
  `isAllowedIntakeStatusTransition`.
- **`completeIncorporationCase`**: the finishing transaction. Takes the real CR
  number, BR number, and Registrar-issued incorporation date; derives
  `annual_return_basis_date` as the first calendar anniversary of that
  incorporation date (same year-of-month-and-day incremented by one) — the
  statutory basis for a new company's first annual return. This needs a genuine
  year increment (`setUTCFullYear(year + 1)`), not `offsetDateOnly`'s day-based
  arithmetic, since adding a flat 365 days is wrong across a leap year — a small
  new `oneYearLater(date: string): string` helper, not a reuse of an existing one.
  (The subsequent 42-day filing deadline is computed later, by
  `calculateFilingDueDate`, whenever the first AR case is actually created — not
  something completion needs to do itself.) Inserts the `companies` row + its
  secretary officer
  row, duplicating `createClient`'s exact insert shape directly in
  `incorporation/repository.ts` (kept self-contained rather than importing across
  feature slices, consistent with how every other feature here is isolated); sets
  the case's `status = 'Completed'`, `company_id`, `completed_at`. Only callable
  when the case's current status is `'Filed with Registrar'` — any other status
  (including an already-`'Completed'` case) throws.
- **Authorization**: a new `incorporation/authorization.ts`, scoped to
  `incorporation_cases.team_id` directly (there's no company to derive team from
  yet) — same Staff/Manager/Admin shape as `clients/authorization.ts`, keyed off a
  different column.

## UI

- **`/incorporation`**: list of open + recently-completed intake cases (case name,
  status, target completion date rendered with the existing shared `DeadlinePill`
  component for risk coloring, owner), plus a "Start incorporation" button opening
  a `CreateIncorporationCaseDialog` (proposed name EN/ZH, registered office,
  proposed secretary, registered capital, business nature, owner, team, target
  completion date).
- **`/incorporation/$id`**: proposed company info, the checklist with per-item
  status/note controls, a status-transition control, and a "Complete intake"
  action gated to `status === 'Filed with Registrar'`.
- **No change to `ClientFormDialog`'s existing "New client" flow** — it remains
  the path for entering a company whose incorporation is already complete (real
  CR/BR in hand).
- **On completion**: the case detail page redirects to `/clients/$id` for the
  newly-created company.
- **No demo tier** — both routes render an explanatory notice component in demo
  mode, matching `DemoClientNotice`'s pattern.
- Nav sidebar gets a new "Incorporation" entry, positioned near "Clients."

## Testing & acceptance

- Unit tests for the pure `isAllowedIntakeStatusTransition` guard.
- Repository integration tests (`describe.skipIf(!databaseUrl)`): case creation
  copies the seeded template's checklist items correctly; checklist item status
  transitions with set-once `received_at`/`verified_at`; valid/invalid status
  transitions; `completeIncorporationCase` creates the `companies` row + secretary
  officer, sets `company_id`/`completed_at`, and is rejected from any status other
  than `'Filed with Registrar'` (including a second completion attempt on an
  already-completed case).
- The new `src/features/incorporation/repository.test.ts`'s own fixture-cleanup
  helper deletes `incorporation_cases` rows before the `companies` rows they
  created, built correctly from the start (see Data model above).
- Component tests: `CreateIncorporationCaseDialog` (creation, validation),
  checklist item status controls, and the "Complete intake" action's gating.

**Acceptance**: a case can be created from the seeded template; checklist items
can be marked through their full status lifecycle; case status advances linearly
and rejects invalid jumps; completing a case creates a real client company with its
secretary officer and redirects to that company's detail page; full suite green
**and CI's DB-integration job confirmed green in an actual run** before treating
the branch as mergeable.
