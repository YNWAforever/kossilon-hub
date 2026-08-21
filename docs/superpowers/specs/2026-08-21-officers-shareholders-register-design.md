# Officers & Shareholders Register (P1-5) — Design

## Overview

There is no structured director, secretary, or shareholder data anywhere in this codebase —
confirmed by search: every "director"/"shareholder" hit in the repo is a free-text checklist
label, FAQ script, or demo mock string (`src/lib/knowledge-base.ts`, `src/lib/templates.ts`,
`src/lib/mock-data.ts`). `companies.company_secretary` is the one partial exception: a free-text
column with no appointment history. This is the roadmap's named prerequisite for P1-6 (SCR),
P1-7 (incorporation intake), and the director-change part of P1-9 — and "the substrate NAR1 is
actually generated from," though actual NAR1 generation is a separate, future item.

## Scope

**In scope:** two new tables (`officers`, `shareholdings`), repository/server-fn methods on the
existing `clients` feature module, and a register UI on `/clients/$id` (view current + ceased
officers/shareholders, appoint/record new ones, cease existing ones). Company creation is
extended to also seed an initial secretary officer record.

**Out of scope, explicitly:**
- NAR1 form generation or any other document output — this pass is the data substrate only,
  the same way P1-4 generalized `work_items` without introducing a second case type.
- A demo-mode fixture tier — `/clients` already has none, by design (P1-3's decision); these
  sections simply render nothing in demo mode.
- Preventing a company from having zero active secretary at any instant (see "Secretary sync"
  below) — accepted as a documented edge case, not solved with extra guard logic.
- Corporate-secretary-specific fields beyond `name` (e.g. a distinct "registered office of the
  corporate secretary" field) — `identification_type`/`identification_number`/`address` are
  simply left null for a corporate secretary; no separate corporate-vs-individual officer shape.

## Data model

```sql
create table officers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  officer_type text not null check (officer_type in ('director', 'secretary')),
  name text not null,
  identification_type text check (identification_type in ('hkid', 'passport', 'br_number')),
  identification_number text,
  address text,
  appointment_date date not null,
  cessation_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint officers_cessation_after_appointment check (
    cessation_date is null or cessation_date >= appointment_date
  )
);

create table shareholdings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  shareholder_name text not null,
  shareholder_address text,
  share_class text not null default 'Ordinary',
  number_of_shares integer not null check (number_of_shares > 0),
  allotment_date date not null,
  cessation_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shareholdings_cessation_after_allotment check (
    cessation_date is null or cessation_date >= allotment_date
  )
);

create index officers_company_idx on officers (company_id);
create index shareholdings_company_idx on shareholdings (company_id);
```

`on delete restrict` on `company_id` (not `cascade`, unlike `documents`/`payments`/etc.) —
officer/shareholder history is itself a statutory record; deliberately harder to lose than a
company's operational records. In practice `companies` rows are never hard-deleted, so this is
belt-and-braces, matching the same reasoning already applied to `annual_return_audit_events`.

A null `cessation_date` means currently active/serving. Ceasing an officer or shareholder is
always an update (`cessation_date = <date>`), never a delete — the row is the historical record.

## Repository & server-fns layer

Extends `src/features/clients/` (not a new feature module) — officers and shareholdings are
company sub-resources, the same relationship `company_contacts` already has.

**New types** (`clients/types.ts`): `OfficerType = "director" | "secretary"`,
`IdentificationType = "hkid" | "passport" | "br_number"`, `Officer`, `Shareholding`, and their
corresponding `AppointOfficerInput`, `CeaseOfficerInput`, `RecordShareholdingInput`,
`CeaseShareholdingInput`. `ClientDetail` gains `officers: Officer[]` and
`shareholdings: Shareholding[]`, hydrated by `getClient` alongside the existing sub-resources,
sorted by appointment/allotment date descending (current first).

**New repository methods** (`ClientRepository`):
- `appointOfficer(input)` — inserts an officer row. If `officerType === "secretary"`, in the
  same transaction: cease any currently-active secretary (`cessation_date` = the new officer's
  `appointment_date`) and update `companies.company_secretary` to the new name. This becomes
  the *only* path that changes the secretary column — `updateClient` stops accepting a
  `companySecretary` field (it has no rendered input in `client-form-dialog.tsx` today, so this
  removes dead API surface rather than changing any observable behavior).
- `ceaseOfficer(input)` — sets `cessation_date`. No side effects on `companies`.
  **Documented edge case**: `companies.company_secretary` is `not null`, so ceasing the
  currently-active secretary with no replacement yet appointed leaves that column showing the
  now-ceased secretary's name until a new one is appointed. The register will correctly show
  that officer as "Ceased"; the denormalized column is temporarily stale. Not solved with extra
  guard logic — appointing a replacement is the normal next action and immediately corrects it.
- `recordShareholding(input)` / `ceaseShareholding(input)` — plain CRUD, no cross-table effects.
- `createClient` gains one more insert: after the company row, insert a secretary officer row
  (`name = input.companySecretary`, `appointmentDate = input.incorporationDate`) in the same
  transaction. The existing form field is unchanged; it now also seeds the officers table.

Every mutation writes a `timeline_events` row (`"Appointed {name} as {type}."` / `"Ceased
{name} as {type}."` / `"Recorded shareholding for {name}."`), matching the existing
contact-mutation pattern. Authorization reuses `assertClientCompanyWritable` — the same
team-scoped-write/firm-wide-read policy already governing contacts; no new authorization
concept.

**New server fns**: `appointOfficerForActor`/`appointOfficer`, `ceaseOfficerForActor`/
`ceaseOfficer`, `recordShareholdingForActor`/`recordShareholding`,
`ceaseShareholdingForActor`/`ceaseShareholding`, following the exact `*ForActor()` +
thin-`createServerFn`-wrapper shape every other mutation in this file already uses.

## UI

Two new sections on `/clients/$id`'s `ProductionClientDetail`, placed after the Overview card
and before Contacts (statutory facts about the company itself, ahead of "who to call").

**Officers section**: flat list of all officer rows (current and ceased), sorted
appointment-date descending. Each row shows name, type pill (Director/Secretary), identification
(if on file), and a status pill (Active/Ceased). Active rows get a "Cease" button — calls the
mutation directly with today's date, no confirmation dialog (matches the existing Contacts
"Remove" convention). An "Appoint officer" button opens a new `OfficerFormDialog` (name, type
select, identification type/number, address — all optional except name/type — and appointment
date).

**Shareholders section**: same shape — flat list, current-first, each row showing name, share
class, number of shares, status pill, a "Cease" button, and a "Record shareholding" button
opening a new `ShareholdingFormDialog` (name, address, class, number of shares, allotment date).

Both dialogs are genuinely new — unlike `ClientFormDialog`/`ContactFormDialog` (pre-existing,
deliberately left untested at the interaction level in P1-3 since they predated that plan) —
so they get real interaction tests built alongside them as part of normal TDD.

## Testing

- Repository integration tests (real Postgres, `describe.skipIf(!databaseUrl)`) specifically for
  `appointOfficer`'s secretary-cessation-and-sync behavior — the one piece of real cross-table
  logic, and exactly where a mistake would hide from a mocked-`sql` unit test.
- Interaction tests for both new dialogs (open → fill → submit → assert the mutation call).
- Interaction/render tests for the two new detail-page sections (renders the list, cease action,
  empty state).
- No demo-mode test changes needed — `/clients` has no fixture tier.

## Acceptance

1. Staff can view a company's full officer and shareholder history (current and ceased) on its
   client detail page.
2. Appointing a new secretary automatically supersedes the previous one and keeps
   `companies.company_secretary` in sync — no separate step required.
3. Company creation seeds an initial secretary officer record from the same form field staff
   already fill in.
4. Ceasing a director or shareholder is a single action with no side effects elsewhere.
