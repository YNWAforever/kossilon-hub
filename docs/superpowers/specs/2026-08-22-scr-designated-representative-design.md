# P1-6: SCR + Designated Representative Service — Design

## Context

From `01-Kossilon-Hub-Roadmap-P0-P3.md`: "SCR + Designated Representative (Q6, Q7) —
HK$2,000/yr; non-compliance up to HK$25,000 + daily fine — Absent, a checklist label.
`significant control` appears only as demo fixture text; `designated represent` → 0
hits repo-wide. No `significant_controllers` table, no DR appointment record, no
update-deadline tracking, no inspection log."

This is the highest-liability gap in the roadmap catalogue and the first item unblocked
by P1-4 (work-item generalization) and P1-5 (officers & shareholders register), both
merged and CI-confirmed green (PR #45, PR #46 + follow-up fix PR #47).

## Scope

In scope:
- A `significant_controllers` register per company: the four Q6 control tests
  (>25% shares, >25% votes, majority-board appointment right, significant influence),
  appointment/cessation-style lifecycle, and a staff-set register-update-due-date.
- Designated Representative (DR) as a third `officer_type` on the existing `officers`
  table, reusing its appoint/cease CRUD and secretary-style single-active-holder sync.
- An inspection-request log per company (requester, date, resolution).
- UI: two new sections on `/clients/$id`, plus a DR option in the existing officer
  type selector.

Out of scope (explicitly deferred):
- DR renewal fee/subscription billing — owned by P1-8 ("per-company service
  subscriptions with actual catalogue fees ... DR HK$2,000/yr"). P1-6 tracks the
  compliance register and deadlines only, not billing, matching how P1-4 shipped pure
  plumbing before any consumer and P1-5 shipped the register before NAR1 generation.
- Any cross-linking between `significant_controllers` and `officers`/`shareholdings`.
  Neither of those two tables links to a shared "person" entity today even though the
  same individual can appear in both — `significant_controllers` follows the same
  independent-fields convention rather than introducing the first person-dedup model.
- Automated update-duty deadline computation from a fixed day-count rule. The roadmap
  doc doesn't specify a trigger or day count, so the due date is staff-entered per
  change, not system-computed.
- A full inspection-request workflow/state machine (assignment, statuses). This is a
  simple audit log: requester, date, and a free-text resolution note.

## Data model

### `significant_controllers` (new table)

```sql
create table if not exists significant_controllers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  controller_name text not null,
  identification_type text check (identification_type in ('hkid', 'passport', 'br_number')),
  identification_number text,
  address text,
  control_bases text[] not null,
  registered_date date not null,
  cessation_date date,
  register_update_due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint significant_controllers_cessation_after_registered check (
    cessation_date is null or cessation_date >= registered_date
  ),
  constraint significant_controllers_control_bases_valid check (
    control_bases <@ array['shares_over_25pct', 'votes_over_25pct',
                            'board_appointment_right', 'significant_influence']::text[]
    and cardinality(control_bases) > 0
  )
);

create index if not exists significant_controllers_company_idx on significant_controllers (company_id);
```

Notes:
- `identification_type`/`identification_number` reuse the exact same nullable
  hkid/passport/br_number shape as `officers`, since a controller can be a corporate
  shareholder (br_number) as well as a natural person.
- **Deviation from the `officers`/`shareholdings` append-only convention, deliberate**:
  those two tables model any change as cease-old-row + append-new-row. For significant
  controllers, an in-place edit of `address`/`control_bases`/`register_update_due_date`
  on the live row is more operationally correct — the statutory duty is "keep this
  controller's register entry current," not "replace the controller." Only the
  lifecycle boundary (`cessation_date`) stays one-way, matching officers/shareholdings.
- `control_bases <@ array[...]` is Postgres's "is contained by" operator — validates
  every element of the array is one of the four known values without needing a second
  lookup table. `cardinality(control_bases) > 0` rejects an empty array (a controller
  must have at least one basis).

### `officers.officer_type` (existing table, altered)

The current constraint in `db/migrations/0015_officers_and_shareholdings.sql` is an
inline, unnamed `check (officer_type in ('director', 'secretary'))`, which Postgres
names `officers_officer_type_check` by its standard `<table>_<column>_check` rule.
The new migration must confirm this name against the live schema
(`select conname from pg_constraint where conrelid = 'officers'::regclass and
contype = 'c';`) before dropping it, since an assumed name that's wrong fails loudly
rather than silently — acceptable, but worth a comment in the migration explaining why
the drop/re-add exists instead of the usual purely-additive migration shape:

```sql
alter table officers drop constraint officers_officer_type_check;
alter table officers add constraint officers_officer_type_check
  check (officer_type in ('director', 'secretary', 'designated_representative'));
```

### `scr_inspection_requests` (new table)

```sql
create table if not exists scr_inspection_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  requester_name text not null,
  requester_authority text not null,
  request_date date not null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scr_inspection_requests_company_idx on scr_inspection_requests (company_id);
```

Both new tables get their `create table`/`create index` DDL copied verbatim into
`src/server/db/schema.sql`, per the existing migration/schema.sql dual-maintenance
convention, verified by `npm run verify:firm -- --dry-run`'s `migration-schema` check.

**Test fixture cleanup, called out explicitly because it broke CI last time**: this
migration is the second to add a table with `company_id ... on delete restrict`
(the first was `officers`/`shareholdings` in P1-5's PR #46, which merged with CI
`verify` failing and needed a same-day follow-up, PR #47, because
`clients/repository.test.ts`'s `cleanupClientFixtures()` deleted companies without
first clearing the new tables). The task that adds integration tests for
`significant_controllers`/`scr_inspection_requests` MUST update
`cleanupClientFixtures()` to delete from both new tables before deleting companies,
in the same commit — not deferred to a later review pass.

## Repository & server-fns layer

Extends the existing `src/features/clients/` slice (where officers/shareholdings
already live) rather than a new feature module.

**`types.ts`**:
- `ControlBasis = "shares_over_25pct" | "votes_over_25pct" | "board_appointment_right" | "significant_influence"`
- `SignificantController` type mirroring `Officer`'s shape plus `controlBases: ControlBasis[]` and `registerUpdateDueDate: string | null`.
- `InspectionRequest` type: `id`, `companyId`, `requesterName`, `requesterAuthority`, `requestDate`, `resolutionNote: string | null`, `resolvedAt: string | null`.
- `OfficerType` widened to `"director" | "secretary" | "designated_representative"`.
- `ClientDetail` gains `significantControllers: SignificantController[]` and `inspectionRequests: InspectionRequest[]`.
- New input types: `RecordControllerInput`, `UpdateControllerParticularsInput`, `CeaseControllerInput`, `RecordInspectionRequestInput`, `ResolveInspectionRequestInput`.

**`repository.ts`**:
- `hydrateClient` fetches and maps both new tables, ordered `(cessation_date is not null), registered_date desc` for controllers and `request_date desc` for inspection requests — active/newest first, matching the existing officers/shareholdings ordering.
- New methods: `recordController`, `updateControllerParticulars`, `ceaseController`, `assertControllerBelongsToCompany`, `recordInspectionRequest`, `resolveInspectionRequest`, `assertInspectionRequestBelongsToCompany` — same shape as the existing officer/shareholding methods (`for update` lock is NOT needed for these; the secretary/DR single-active-holder invariant is what needs the lock, not controllers or inspection requests, which have no such invariant).
- `appointOfficer`'s existing secretary-sync branch (`officerType === "secretary"`) is extended to also cover `officerType === "designated_representative"`: same "cessate any prior active holder of this type, in the same transaction, behind the same `for update` lock on the company row" logic, generalized to key off `officerType` instead of being secretary-specific. This is the one behavioral change to existing code. `companies` has no `designated_representative` denormalized column to sync (unlike `company_secretary`), so this is strictly simpler than the secretary case — just the supersede-prior-holder part, no column sync.

**`server-fns.ts`**:
- `recordControllerSchema`, `updateControllerParticularsSchema` (with a `.refine()` requiring `identificationType`/`identificationNumber` both-null-or-both-set, matching `appointOfficerSchema`'s existing pattern), `ceaseControllerSchema`, `recordInspectionRequestSchema`, `resolveInspectionRequestSchema`.
- `recordClientController`, `updateClientControllerParticulars`, `ceaseClientController`, `recordClientInspectionRequest`, `resolveClientInspectionRequest` — each `requireWritableCompany` + `withClientRepository`, matching the five existing officer/shareholding server fns exactly.
- DR appointment/cessation reuses the *existing* `appointClientOfficer`/`ceaseClientOfficer` server fns unchanged (just a new valid `officerType` value flowing through the existing schema, which needs its enum widened).

## UI

- Two new `<section>` blocks on `/clients/$id` (`production-client-detail.tsx`),
  positioned after the existing Shareholders section:
  - **Significant Controllers**: list showing name, control bases as badges,
    registered/cessation dates, and a register-update-due-date risk tile if set;
    a new `ControllerFormDialog` (record) mirroring `OfficerFormDialog`'s structure;
    inline "Edit particulars" (opens the same dialog pre-filled, in edit mode) and
    "Cease" actions.
  - **Inspection Requests**: list showing requester, authority, date, and resolution
    status; a new `InspectionRequestFormDialog` (record) and a "Resolve" action that
    opens a small dialog for entering the resolution note.
- **DR gets no new UI section.** `OfficerFormDialog`'s officer-type selector gains a
  third option, and `officerTypeLabel` in `production-client-detail.tsx` gains
  `designated_representative: "Designated Representative"`. It appears in the
  existing Officers list alongside directors and the secretary.
- The register-update-due-date renders with the same red/orange/yellow/green tile
  treatment as annual-return filing deadlines, reusing the existing pattern of a
  local, unexported `HONG_KONG_TIME_ZONE`/`datePart`/`today()` copy in
  `production-client-detail.tsx` (already present there from P1-5) rather than a
  cross-slice import, per this codebase's established convention.
- Production-mode only, matching `/clients`' existing no-fixture-backed-demo-tier
  exception. No new demo-mode work.

## Testing & acceptance

- Repository integration tests behind `describe.skipIf(!databaseUrl)` for both new
  tables.
- A DR-supersede concurrency test, written correctly from the start: two independent
  `createSqlClient()` connections appointing a DR simultaneously, raced via
  `Promise.all`, asserting exactly one ends up active — the same shape P1-5 had to
  redo after its first attempt (a single shared transaction) was found tautological.
- `cleanupClientFixtures()` updated to delete `significant_controllers` and
  `scr_inspection_requests` rows before deleting test companies, in the same task
  that adds their integration tests (see the Data model section above).
- Interaction tests for `ControllerFormDialog` and `InspectionRequestFormDialog`:
  success path, server-error path, and a malformed-input-rejected-without-calling-
  the-server case (empty `control_bases` array; a `registerUpdateDueDate` before
  `registeredDate`, mirroring the existing cessation-before-appointment client-side
  guard pattern).
- `production-client-detail.interaction.test.tsx` extended with fixtures/mocks for
  both new sections and the DR officer-type option.

**Acceptance criteria**:
- A significant controller can be recorded with one or more control bases, edited
  in place, and ceased.
- A DR can be appointed and appointing a new one cessates any prior active DR,
  exactly like secretary.
- An inspection request can be recorded and later resolved with a note.
- An overdue register-update-due-date renders with risk-tile coloring on the client
  detail page.
- Full local suite green.
- **The CI `verify` job's DB-integration suite is confirmed green in an actual CI
  run before the branch is treated as mergeable** — not just locally, since
  `TEST_DATABASE_URL` is unset in this sandbox and `describe.skipIf` silently skips
  the whole suite here. This is the same class of gap that let PR #46 merge with a
  failing "verify" check; this time the check is being made explicit rather than
  assumed.
