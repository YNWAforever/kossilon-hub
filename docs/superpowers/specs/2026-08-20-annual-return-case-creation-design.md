# Annual Return Case Creation Design (P1-1)

## Overview

`/annual-returns` is a command centre over cases that only `scripts/db-seed-annual-return.ts` can
produce — there is no user-facing path to create one. The roadmap (`01-Kossilon-Hub-Roadmap-P0-P3.md`,
§3, P1-1) calls this the single biggest GA blocker: on day one a firm has no way to onboard its next
filing. It was previously deferred (`docs/superpowers/specs/2026-07-30-production-annual-return-command-center-design.md:35-38`)
pending "the checklist-template decision" named in `docs/adr/0001-demo-mode-is-read-only.md` — that
decision has since shipped as P1-12 (`src/features/checklist-templates/`, a real Postgres-backed
table and repository), so this blocker is cleared.

**Goal:** a staff-facing "New case" flow — pick a company, pick an active checklist template, confirm
owner/team, submit — that creates a real `annual_return_cases` row, instantiates its checklist items
from the template, and opens the same work item every other case lifecycle event already uses.

**Confirmed via direct exploration of the current codebase, not assumption:**
- `companies` has no service-type/public-vs-private column at all (`schema.sql:39-53`) — nothing on
  the company record indicates which checklist template applies.
- `annual_return_basis_date` is set once at company creation and never updated by any code path
  (confirmed: no repository method touches it after insert). Combined with the
  `unique (company_id, return_year)` constraint on `annual_return_cases`, this means **a company can
  only ever receive one annual-return case, ever**, under the current data model — there is no
  mechanism that rolls the basis date forward for a second yearly cycle. This is a real gap, but a
  different problem than "create a case" (closer to a future "close out this year's cycle" feature).
  Explicitly out of scope here; noted so it isn't silently assumed away.
- `risk_level` is stored on the row but re-computed live via `riskForCase(case_, today)` on every
  read path that matters (`annual-return/repository.ts:379`) — the stored value is a placeholder,
  not the source of truth for display.
- `AnnualReturnRepository` has no `createCase`/insert-named method today — every existing method
  (`updateStatus`, `assignOwner`, `updateChecklistItem`, …) operates on an already-existing case and
  throws `"Annual return case not found."` otherwise.
- `ensureWorkItemForEvent` (`work-items/repository.ts:306-371`) is already called at every other
  annual-return lifecycle event via a thin wrapper, `ensureAnnualReturnWorkItem`
  (`annual-return/repository.ts:432-455`), but never at case-creation time — because no
  case-creation code path exists in production yet.
- The closest existing precedent for this whole shape — Zod validator → resolve actor → authorize
  against a target team → repository transaction (insert + related rows + re-hydrate) → return the
  full object — is `clients/server-fns.ts`'s `createClient` end-to-end.

## Scope

**In scope:**
- A "New case" button on `/annual-returns`, production mode only (matching the read-only-demo
  convention used everywhere else in this app — demo mode's command centre gets no create affordance).
- A dialog: company picker → active-template picker → owner/team fields (pre-filled, editable) →
  submit.
- One transaction: insert the case, instantiate checklist items from the template, open the work
  item.

**Out of scope** (matching the roadmap's own boundaries, confirmed deliberately, not by omission):
- Automatic/bulk case generation from company records. The existing dead-code helper
  `shouldGenerateCase` (`workflow.ts:76-78`, `daysBetween(today, filingDueDate) <= 90`, zero
  production call sites) stays unused — this is a manual, one-at-a-time staff action.
- P1-3's full client register UI. The picker built here is a minimal, purpose-built combobox for
  this dialog, not a general company directory — P1-3 remains its own separate roadmap item.
- P1-4's work-item generalization. The work item created here uses the existing
  `annual_return_case` work type, unchanged.
- The basis-date-rollover gap named above.

## Data model

**`return_year`**: derived as `EXTRACT(YEAR FROM annual_return_basis_date)` — the only year-bearing
information available on the company record, and what the case is fundamentally anchored to.

**Filing due date**: reuses the existing `calculateFilingDueDate(basisDate)` (`workflow.ts:70-74`,
a fixed 42-day offset from the basis date, matching the HK Companies Ordinance NAR1 filing window).
No changes to this function.

**Checklist item due dates**: derived per item from the *template*, as
`filingDueDate - documentItem.daysBeforeDue`, using each `DocumentItem`'s own offset
(`checklist-templates/types.ts`) — correcting the seed script's shortcut of applying one flat date
to every item (`scripts/db-seed-annual-return.ts:1311-1350`).

**Initial status**: always `"Upcoming"` — the first value in `ANNUAL_RETURN_STATUSES`
(`annual-return/types.ts:1-13`), and the one `evaluateReminders` treats as needing its first reminder.

**Initial risk level**: `"green"` as a placeholder value only — display always uses the live
`riskForCase()` computation regardless of what's stored (confirmed above).

## Company picker

A new repository read method, `listCompaniesEligibleForCase(): Promise<EligibleCompany[]>`
(`EligibleCompany = { id, companyName, crNumber, annualReturnBasisDate, assignedOwnerId, assignedTeamId }`),
selecting from `companies` where `status = 'active'` and **no** existing `annual_return_cases` row
matches `(company_id, EXTRACT(YEAR FROM annual_return_basis_date))`. This keeps the picker from ever
offering a company that would immediately fail the unique constraint.

The dialog's picker is a searchable combobox, filtering this list client-side by name/CR number — the
active-company count is small enough that a full client-side list is fine; no server-side search
debouncing needed. Selecting a company shows its basis date (read-only, for context) and pre-fills
owner/team (see below).

## Create-case dialog: fields & validation

- `companyId` (from the picker, required) — must be one of the currently-eligible companies.
- `templateId` (dropdown of *active* checklist templates filtered to the two Annual Return service
  types — `"Annual Return — Private Ltd"`, `"Annual Return — Public Ltd"` — required). Since
  `companies` has no service-type field to auto-resolve this from, the acting staff member picks the
  template explicitly at creation time — this was confirmed as the preferred approach over always
  defaulting to Private Ltd (silently wrong for the rare public-company client) or adding a new
  `companies` column (larger, unnecessary scope for this task).
- `ownerId` / `teamId` (pre-filled from the company's `assigned_owner_id`/`assigned_team_id`,
  editable, required). The owner/team picker data itself is **not** duplicated — the dialog calls
  the existing `listClientAssignmentOptions` server fn (`clients/server-fns.ts`) directly and uses
  only its `owners`/`teams` fields (ignoring `packages`, which is client-specific and irrelevant
  here). Owners and teams are global staff data, not client-specific, so there's no reason to write
  a second, nearly-identical query in the annual-return module. Defaulting from the company record
  is right most of the time (the case usually belongs to whoever already owns the client
  relationship) while still allowing override for the cases that need a different assignee.
- `reviewerId` stays unset at creation — nullable in `AnnualReturnCase` already, assigned later in
  the case's lifecycle by an existing flow, not part of this form.

Validator:

```typescript
const createAnnualReturnCaseSchema = z
  .object({
    companyId: z.string().uuid(),
    templateId: z.string().uuid(),
    ownerId: z.string().uuid(),
    teamId: z.string().uuid(),
  })
  .strict();
```

## Repository / server-fn orchestration

One transaction, mirroring `clients/repository.ts`'s `createClient` shape:

1. Re-check eligibility (company `active`, no existing case for the derived `return_year`) —
   defensive, since the picker's list could be stale by submit time. Surface a friendly
   `"This company already has a case for {year}."` rather than letting the unique-constraint
   violation surface as a raw SQL error.
2. Load the template by `templateId`; reject with `"Checklist template not found or inactive."` if
   it doesn't exist or `active: false`.
3. Compute `filingDueDate` via `calculateFilingDueDate(company.annualReturnBasisDate)` (unchanged
   existing function).
4. Insert the `annual_return_cases` row: `current_status: "Upcoming"`, `risk_level: "green"`
   (placeholder), `made_up_date` = the company's basis date, `filing_due_date` as computed above,
   `owner_id`/`team_id` from the (possibly-overridden) form values, `reviewer_id: null`,
   `reminders_sent: 0`, `filing_reference: null`, `confirmation_document_id: null`.
5. Insert one `annual_return_checklist_items` row per template `documents[]` entry: `item_label` =
   `DocumentItem.label`, `required` = `DocumentItem.required`, `status: "Missing"`, `due_date` =
   `filingDueDate - documentItem.daysBeforeDue`, `received_at: null`, `verified_at: null`,
   `document_id: null`.
6. Call `ensureWorkItemForEvent` in the same transaction, following the exact shape of the existing
   `ensureAnnualReturnWorkItem` wrapper (`workType: "annual_return_case"`,
   `requiredSkillKey: "annual-return"`), with a new `sourceEventType: "annual_return_case_created"`
   and `sourceEventKey: `annual-return:${caseId}:created`` (idempotent, matching every other call
   site's key convention).
7. Re-hydrate and return the full `AnnualReturnCase` from inside the same transaction, matching
   `createClient`'s pattern (`clients/repository.ts:479-517`).

The new `AnnualReturnRepository` method: `createCase(input: CreateAnnualReturnCaseInput): Promise<AnnualReturnCase>`.

The new `*ForActor` function, `createAnnualReturnCaseForActor(actor, input, dependencies)`, follows
the same shape as every other function in this module — pure, dependency-injected, unit-testable
without a database.

## Authorization

A new `assertAnnualReturnCaseCreatable(actor, { teamId })` in `annual-return/permissions.ts`,
mirroring `clients/authorization.ts`'s `assertClientCompanyCreatable` exactly: Admin unrestricted;
Manager/Staff may only create into their own team (checked against the *target* team — which may
differ from the company's default team if overridden in the form); Client role and inactive actors
forbidden.

The "New case" button itself only renders in production mode — matching the read-only-demo
convention used everywhere else (checklist templates settings, etc.); demo mode's command centre is
otherwise untouched.

## Testing

- `createAnnualReturnCaseForActor` (new, pure/dependency-injected): unit tests against a mocked
  repository — authorization matrix (Admin/Manager/Staff/Client, own-team vs. other-team), template
  not found, template inactive, checklist items instantiated with correct per-item due dates derived
  from `daysBeforeDue`, work-item creation invoked with the right `sourceEventType`/`sourceEventKey`.
- `createCase` repository method: a `describe.skipIf(!databaseUrl)` integration suite (real Postgres,
  matching the existing convention for the ~60 tests that need one) — proves the actual transaction:
  the unique-constraint path surfaces the friendly error, checklist rows persist with correct due
  dates, the work item row is created and linked to the case, and an active SLA policy for
  `annual_return_case` already covers it (confirmed: no new SLA policy needed, existing cases already
  use this work type).
- A route-level test for `/annual-returns` (extending the existing route-test harness): demo mode
  renders no "New case" button; production renders it, opens the dialog for an Admin actor, and the
  picker/template/owner-team fields render correctly for an eligible company.

Full suite + `tsc --noEmit` + `lint` at the end, same discipline as every prior feature this session.

## Out of scope

- Automatic/bulk case generation from company records (`shouldGenerateCase` stays dead code).
- P1-3's full client register UI — the picker here is scoped to this dialog only.
- P1-4's work-item generalization — unchanged `annual_return_case` work type.
- The basis-date-rollover gap (a company can only ever get one case under the current data model) —
  named explicitly above, not solved here.
- Adding a service-type column to `companies` — the template picker solves the same problem without
  a schema change.

## Acceptance

1. An Admin or Manager/Staff actor (into their own team) can open "New case" from `/annual-returns`
   in production mode, pick an eligible company and an active template, confirm or override
   owner/team, and submit — creating a real, persisted case with checklist items matching the
   template and a linked work item, all in one transaction.
2. A Client actor's or inactive actor's attempt is rejected with a `Forbidden:` error, independent of
   the button being hidden client-side.
3. Attempting to create a second case for a company that already has one for its derived return year
   fails with a friendly, specific error — never a raw database constraint violation.
4. Demo mode shows no "New case" affordance anywhere.
5. Checklist item due dates match the template's per-item `daysBeforeDue` offsets exactly — not a
   single flat date copied from the case's own filing due date.
