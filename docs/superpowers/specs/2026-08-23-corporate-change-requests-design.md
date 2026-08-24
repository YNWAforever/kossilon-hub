# P1-9: Ad hoc corporate change requests — design

**Status:** Approved
**Date:** 2026-08-23
**Roadmap item:** P1-9 (`01-Kossilon-Hub-Roadmap-P0-P3.md`), dependencies P1-4 (generalized work items) and P1-5 (officers & shareholders register), both merged.

## Problem

Per the roadmap's service-catalogue audit (`01-Kossilon-Hub-Roadmap-P0-P3.md:69`), the firm separately quotes four ad hoc corporate change services under Q8 of its Q&A: name change, share transfer (with stamp duty), director/secretary appointment/resignation/detail-change, and registered address change. None of this exists in the platform today — `work_items.case_id` was `not null references annual_return_cases(id)` until P1-4 generalized it specifically to unblock this item, and P1-5 built the `officers`/`shareholdings` registers these change types read and write but never built a "transfer" or "in-place edit" operation on top of them.

## Scope

One unified case type, `corporate_change`, covering all four change sub-types through a single table with a `change_type` discriminator — the same pattern P1-5 used for officers (`officer_type`) and P1-6 used for `significant_controllers`. This is the fastest path to shipping given the four sub-types share nearly all lifecycle, quoting, and checklist machinery, and matches how prior "L"-sized roadmap items were scoped as one plan.

## Data model

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
  quoted_fee numeric(10,2) not null check (quoted_fee >= 0),

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
  consideration numeric(12,2),
  stamp_duty_amount numeric(10,2),

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
  )
  -- plus one CHECK per change_type requiring exactly its own required fields non-null,
  -- worked out precisely during planning (e.g. name_change requires new_name_en;
  -- share_transfer requires transferor_shareholding_id, shares_transferred, and
  -- exactly one of transferee_shareholding_id / transferee_new_shareholder_name; etc.)
);

create index corporate_change_requests_company_idx on corporate_change_requests (company_id);
create index corporate_change_requests_status_idx on corporate_change_requests (status);

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

Checklist items are seeded from a fixed per-`change_type` list defined in the domain layer (not admin-editable, not sourced from the P1-12 `checklist_templates` system) at request-creation time — these are fixed statutory document sets, not firm-customizable templates.

### Checklist content per change type

- **name_change**: Special resolution approving new name; NNC2 form; updated Business Registration certificate; Certificate of Change of Name (issued by Registrar)
- **share_transfer**: Bought & Sold Note; Instrument of Transfer; transferee ID/address proof (only when adding a new shareholder); stamp duty payment receipt; updated register of members
- **officer_change**: ND2A (appointment) or ND2B (cessation) as applicable; new officer's ID/address proof (appoint / detail_change only); updated register of directors and secretaries
- **address_change**: NR1 form; proof of new address; updated Business Registration certificate

## Work-item / SLA integration

`corporate_change_requests` operates on an already-existing company (unlike P1-7's incorporation cases, which have no company until completion), so it can use the existing `work_items`/SLA-policy engine directly without further generalization.

A second migration extends `work_items` following the extension path migration 0014 documented for exactly this case:

```sql
alter table work_items add column corporate_change_request_id uuid
  references corporate_change_requests(id) on delete restrict;

alter table work_items drop constraint work_items_case_type_check;
alter table work_items add constraint work_items_case_type_check
  check (case_type in ('annual_return', 'corporate_change'));

alter table work_items drop constraint work_items_case_reference_check;
alter table work_items add constraint work_items_case_reference_check
  check (
    (case_type = 'annual_return' and annual_return_case_id is not null and corporate_change_request_id is null)
    or (case_type = 'corporate_change' and corporate_change_request_id is not null and annual_return_case_id is null)
  );
```

Creating a `corporate_change_requests` row also creates one `work_items` row via the existing generic `ensureWorkItem` function (`work-items/repository.ts`), with `caseType: "corporate_change"` and a single shared `workType: "corporate_change"` across all four sub-types — one SLA policy, not four, since the roadmap doesn't call for differentiated turnaround per sub-type and `change_type` remains visible on the work item/case for staff to judge urgency manually.

**Real setup dependency**: `ensureWorkItem` resolves the applicable SLA policy by exact `work_type` match and throws `"No active SLA policy exists for work type corporate_change"` if none exists. An Admin must seed an `sla_policies` row with `work_type = 'corporate_change'` before any request can be created — the plan must include this as a migration seed row or a documented manual step (same class of dependency `annual_return_case`'s policy already has).

## Completion behavior

`completeCorporateChangeRequest(requestId)` runs in one DB transaction, gated the same way officer/shareholding mutations already are (Staff/Manager, team-scoped — no additional Admin-only gate beyond what the underlying functions already require), branching on `change_type`:

- **name_change**: `update companies set name = new_name_en, name_chinese = new_name_zh where id = company_id`
- **address_change**: `update companies set registered_office = new_registered_office where id = company_id`
- **officer_change**:
  - `appoint` → calls the existing `appointOfficer()` (P1-5) with the new officer's details
  - `resign` → calls the existing `ceaseOfficer()` (P1-5) on `officer_id`
  - `detail_change` → a **new** `updateOfficerDetails()` function. P1-5 only ever built appoint/cease; in-place editing of an existing officer's address/identification without ceasing their appointment doesn't exist yet and must be built here.
- **share_transfer**: locks both shareholding rows (`select ... for update`, the same race-guard pattern used by every prior case-completion function in this codebase — DR-supersede, subscription renew/cancel, incorporation's `completeCase`), then:
  - Decrements the transferor's `number_of_shares` by `shares_transferred`; sets `cessation_date` if it reaches zero
  - Either increments `transferee_shareholding_id`'s count, or calls the existing `recordShareholding()` to create a new holding for `transferee_new_shareholder_name`
  - This "move N shares from A to B" operation is new — P1-5 only has independent record/cease, never a linked transfer

All four branches set `status = 'Completed'`, `completed_at = now()`, and mark the linked `work_items` row `completed`.

Cancelling a request (`status = 'Cancelled'`) similarly marks its linked `work_items` row `cancelled` in the same transaction — no branch-specific data mutation runs, since nothing was ever applied.

## UI

- **`/corporate-changes`** — list screen, filterable by `change_type` / `status` / team (Staff scoped to their own team, Manager/Admin see all — same team-scoping discipline established in P1-1). A "New request" dialog: pick company → pick change type → type-specific sub-form appears → quoted fee (manual entry, no fee catalogue exists for one-off ad hoc work, same reasoning as P1-1's case-creation dialog) → creates the request + checklist + work item in one transaction.
- **`/corporate-changes/$id`** — detail screen: type-specific summary card, checklist (mark items Received/Verified/Rejected), status stepper, a "Complete" action gated to `status = 'Filed with Registrar'` with all required checklist items `Verified`, and a "Cancel" action for any non-terminal status.
- Nav entry added after "Incorporation" in `navigation.ts`.
- No demo-fixture tier — same exception as `/clients` and `/incorporation` (production/staff only; demo mode shows an explanatory notice), since there's no natural fixture story for one-off ad hoc requests.

**Stamp duty**: `stamp_duty_amount` is a plain manually-entered field, not auto-calculated. The legal formula (0.2% of the higher of consideration or net asset value) can't be honestly computed here — NAV isn't tracked anywhere in this schema — so no formula is applied, avoiding a calculation that looks authoritative while silently ignoring half its own inputs.

## Authorization

Mirrors P1-5's officer/shareholding mutations exactly: Staff/Manager can create and progress requests for companies in their own team, Admin sees all, via the existing team-scoping check pattern. No new authorization tier is introduced.

## Explicitly out of scope

- No Companies Registry API integration — filing NNC2/NR1/ND2A/ND2B remains a manual, off-system step; the checklist only tracks that it happened.
- No invoicing/payments-table integration — `quoted_fee` is a tracked number only, same as P1-1's manual fee field; no invoice is generated from it.
- No person-dedup between a new shareholder/officer entered here and any existing `officers`/`shareholdings` row (same limitation P1-6 explicitly accepted for `significant_controllers`).
- Concurrent in-flight requests of the *same type* on the *same company* are not blocked (e.g. two simultaneous name-change requests) — a known gap, not solved here, same posture as P1-1's basis-date-rollover gap.

## Verification plan

- Unit tests for the pure completion-mapping logic per `change_type`, dependency-injected against a fake repository (no DB).
- Repository integration tests behind `describe.skipIf(!databaseUrl)` for the two concurrency-sensitive paths: the share-transfer two-row lock, and reuse of the existing officer/shareholding functions' own race coverage as regression protection.
- `cleanupClientFixtures()`-style fixture teardown updated for the two new tables' `on delete restrict` FKs — closing the exact ordering gap that broke PR #46's CI (officers/shareholdings before companies).
- Manual demo-mode smoke test confirming `/corporate-changes` renders the no-fixtures notice, matching `/clients` and `/incorporation`.
- Full suite green, CI `verify` job confirmed `SUCCESS` via `gh pr view <n> --json statusCheckRollup` before treating the PR as merged (per the standing discipline from PR #46's near-miss).
