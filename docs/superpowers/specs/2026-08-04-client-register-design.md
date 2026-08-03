# Client Register and Contacts Design

## Context

Kossilon Hub runs its Annual Return Control Center and WhatsApp integration on Postgres. The client
directory does not. `/clients` and `/clients/$id` render `src/lib/mock-data.ts` companies merged with
`src/lib/clients-store.ts`, an in-memory store that fabricates companies when staff convert an enquiry.
Nothing survives a page refresh, and the company records the annual-return workflow reads from Postgres
are invisible to the client routes.

The `companies` table already exists with `cr_number`, `br_number`, `incorporation_date`,
`annual_return_basis_date`, `registered_office`, `company_secretary`, `status`, `assigned_owner_id`, and
`assigned_team_id`. The mock `Company` the UI renders carries `package`, `contacts[]`, `paymentStatus`,
and `invoiceAmount`. Only the timeline maps cleanly onto an existing table. Moving the client routes onto
Postgres therefore requires schema additions, not just a repository.

This phase covers the client register and its contacts. The service-package **editor** in Settings is a
separate follow-up phase. This phase lands the `service_packages` table with seeded rows: a company can be
assigned a package from that fixed list, but the package definitions themselves — name, fee — cannot be
created or edited from the UI yet.

## Goals

- Serve `/clients` and `/clients/$id` entirely from Postgres.
- Add company contacts as first-class, staff-managed records.
- Support creating and editing companies and contacts from the UI, without SQL.
- Make the directory's search and filter controls functional.
- Delete `src/lib/clients-store.ts`.
- Consolidate the prototype actor stopgap into one replaceable module.

## Non-Goals

- No service-package CRUD editor in Settings. Packages are seeded and picked, not edited.
- No enquiries table. Enquiries stay on mock data; only the conversion target becomes real.
- No authentication, session, or role-based permissions for client operations.
- No changes to the annual-return or WhatsApp workflows beyond the shared actor extraction.
- No client delete operation.

## Architecture

A new `src/features/clients/` module mirroring `src/features/annual-return/`:

- **`types.ts`** — `ServicePackage`, `CompanyContact`, `ClientSummary`, `ClientDetail`.
- **`repository.ts`** — `createClientRepository()` using the same overloaded factory signature as
  `createAnnualReturnRepository`, accepting `options.sql` so tests inject a client while production
  falls back to `getSqlClient()`.
- **`server-fns.ts`** — zod-validated `createServerFn` wrappers, one per repository operation.

Plus **`src/features/session/actor.ts`** exposing `getCurrentActorId()`: reads `KOSSILON_ACTOR_ID`, falls
back to `KOSSILON_ANNUAL_RETURN_ACTOR_ID`, throws when neither is set. `annual-return/session.ts`
re-exports it, so existing behaviour and existing deployments are unchanged. This leaves one prototype
stopgap in one place for the future login phase to replace.

`src/lib/clients-store.ts` is deleted. `src/lib/mock-data.ts` stays — `enquiries`, `tasks`, and
`teamMembers` still feed other routes — but no client path imports `companies` from it.

### Permissions

Deliberately not built. The annual-return feature has a real `permissions.ts` with role and team rules
because multiple actors contend over a single case. Client CRUD, with one env-var actor, would only check
a fixed identity against itself. The repository verifies the actor row exists and is `active`, records it,
and stops there. Role-based client permissions belong to the login phase.

### Contacts versus WhatsApp contacts

`whatsapp_contacts` is a channel identity record — provider, `whatsapp_id`, `phone_e164`, `display_name` —
written by the inbound-matching webhook flow, already carrying a nullable `company_id`. `company_contacts`
is the staff-managed business roster. They stay separate tables and meet only by phone number at read
time. Merging them would put webhook-owned rows under staff CRUD.

## Schema

Migration `db/migrations/0006_client_register.sql`.

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
```

Seeded with Basic 2800, Standard 3800, and Premium 5200 — the values `clients-store.ts` currently
hardcodes. `default_fee` is whole HKD integers, matching the existing `payments.amount` convention.

```sql
alter table companies add column if not exists service_package_id uuid references service_packages(id);
```

Nullable, but the migration backfills existing rows so nothing renders as unassigned in practice.

```sql
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

create unique index if not exists company_contacts_primary_uidx
  on company_contacts (company_id) where is_primary;
```

Two invariants live in the database rather than application code: a contact must be reachable through at
least one channel, and the partial unique index makes two primary contacts on one company impossible even
under concurrent writes.

`whatsapp_contacts` is untouched.

## Repository

```ts
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
};
```

Every mutation returns the freshly hydrated `ClientDetail` rather than a bare id, so no caller needs a
follow-up read to render its result.

`ClientSummary` is one directory row: id, name, CR and BR numbers, package name, owner name and initials,
team name, company status, plus `arDueDate` and `paymentStatus`. The last two are derived at read time
from the company's most recent `annual_return_cases` row and its `payments` join, via a lateral join.
Nothing is denormalised onto `companies`, so these values cannot drift.

`ClientAssignmentOptions` carries the active users, active teams, and service packages the create and
edit forms need to populate their owner, team, and package pickers.

`ClientDetail` adds `contacts[]`, `timeline` (the company's `timeline_events`), `annualReturnHistory`
(all its cases), `documents`, the latest payment detail, and the registered-office, company-secretary,
incorporation-date, and annual-return-basis-date fields the table already carries but the mock never
showed.

All writes run inside `withTransaction`, mirroring the annual-return repository:

- `createClient` inserts the company, then its initial contacts, then a `timeline_events` row with
  `event_type: 'client_created'` and `actor_type: 'user'`. `CreateClientInput` accepts an optional array
  of contacts so a company and its first contact are created atomically. The add-client dialog captures at
  most one, marked primary; the convert-to-client dialog supplies the enquiry's contact name and phone.
- `updateClient` updates the company and writes a timeline row whose `metadata` names the changed fields.
- Contact operations insert, update, or delete the row and write a matching timeline row.

Promoting a contact to primary clears the flag on its siblings inside the same transaction. The partial
unique index is the backstop: if that clearing is ever missed, Postgres rejects the write rather than
silently allowing two primaries.

The actor id comes from `getCurrentActorId()`. The repository resolves the row from `users` and rejects
the write when the user is missing or inactive, matching the annual-return actor lookup.

## Routes and UI

### `/clients`

The `loader` calls `listClients()`, guarded by an `isClientsIndexPath(location.pathname)` check so it does
not fire for `/clients/$id`, matching the guard in `annual-returns.tsx`. Search, package filter, and team
filter become real `useState` plus `useMemo` client-side filtering over the loaded rows — the same
approach as the annual-returns board — so the three currently inert controls start working. The package
and team dropdowns populate from the data instead of hardcoded options. A status filter distinguishes
active from inactive companies. "Add client" opens a dialog.

### `/clients/$id`

The `loader` calls `getClient(id)` and throws `notFound()` for a missing id, replacing the current inline
"Client not found" div. Every panel gets a real source: contacts from `company_contacts` with add, edit,
and remove controls; timeline from `timeline_events`; annual-return history from `annual_return_cases`;
documents from `documents`, replacing the current trick of borrowing the active case's checklist; payment
from the latest `payments` row. An edit-company dialog covers owner, team, status, package, and registered
office.

### Dialogs and refresh

Add-client, edit-company, and contact dialogs use Radix dialog with `react-hook-form` and a `zod`
resolver — all existing dependencies. On success they call `router.invalidate()` to re-run the loader and
raise a `sonner` toast.

The existing case-detail route drives mutations with `window.prompt`, `window.alert`, and
`window.location.reload()`. That pattern does not survive multi-field forms, and the libraries needed to
replace it are already installed. The client routes use the dialog-and-invalidate approach instead.
`annual-returns.$id.tsx` is not refactored here; that is unrelated to this goal.

### Convert to client

`convert-to-client-dialog.tsx` swaps `convertEnquiry()` for the `createClient` server function. The mock
enquiry only prefills the form. On success the dialog navigates to `/clients/$id` of the new company.
`/enquiries` drops its `useEnquiryConversion` import and the post-conversion "View client" link, because
the enquiry-to-company link cannot be persisted until enquiries move to Postgres.

## Error Handling

**No delete-client operation.** `annual_return_cases`, `documents`, `payments`, and `timeline_events` all
declare `on delete cascade` on `company_id`. A delete button would silently destroy a company's entire
statutory filing history. The register toggles `companies.status` between `active` and `inactive` instead,
and the directory filters on it. No client delete operation should be added later.

**Duplicate CR or BR number.** Both columns are `unique`. A duplicate on create surfaces as a field-level
form error rather than a 500: Postgres `23505` plus the constraint name maps back to the offending field.

**Unreachable contact.** A `company_contacts_reachable_check` violation (`23514`) becomes "Provide an
email or a phone number." Client-side zod catches this first; the handler covers the direct-call path.

**Directory unavailable.** `dashboard-data.ts` degrades to zeroed metrics when the database fails, which
reads acceptably for a metrics tile but reads as a falsehood for a client list — an empty table means "you
have no clients." The directory surfaces an explicit unavailable state with a retry, following the same
`available` flag and `error` message shape but rendering differently.

**Missing client.** `getClient` returns null and the route throws `notFound()`.

**Unconfigured actor.** `getCurrentActorId()` throwing, or a resolved user that is missing or inactive,
surfaces as a toast naming the environment variable, matching the existing annual-return error text. This
is a deployment misconfiguration and must not be silently swallowed.

**Corrupt or partial writes.** Every mutation is transactional, so a failure mid-way leaves neither a
half-created company nor an orphaned timeline row.

## Testing

### Repository integration tests

`src/features/clients/repository.test.ts`, gated by `describe.skipIf(!databaseUrl)` on
`TEST_DATABASE_URL`, with new fixture UUID prefixes for company contacts and service packages alongside
the existing company, case, document, and payment prefixes.

- creating a client writes the company, its seed contacts, and a `client_created` timeline row with
  `actor_type: 'user'`
- creating with a duplicate CR or BR number is rejected, identifying which field collided
- updating a client records the changed field names in the timeline metadata
- promoting a contact to primary demotes the previous primary, leaving exactly one
- a contact with neither email nor phone is rejected
- removing the primary contact leaves the company with no primary and does not error
- an inactive or unknown actor is rejected before any write lands
- `listClients` derives the AR due date and payment status from the most recent case, not an arbitrary one
- a company with no annual-return cases still appears in the directory
- `getClient` returns null for an unknown id

### Pure unit tests

- `src/features/session/actor.test.ts`: `KOSSILON_ACTOR_ID` takes precedence, falls back to
  `KOSSILON_ANNUAL_RETURN_ACTOR_ID`, throws when neither is set.
- The `23505` and `23514` error-to-field mapper, isolated from the database.

The existing `src/features/annual-return/session.test.ts` keeps all its assertions, with one exception:
the resolver now throws under the canonical `KOSSILON_ACTOR_ID` name, so that test's expected error string
changes. Every other assertion must pass untouched — that is the check that the re-export did not alter
behaviour.

### Manual verification

- the directory lists real companies, with working search and all filters
- adding a client makes it appear in the directory and creates a real record
- editing owner, team, or package writes a visible timeline entry
- contacts can be added, promoted to primary, and removed
- deactivating a company removes it from the active filter
- converting a mock enquiry lands on a real client profile
- `/annual-returns` and the dashboard still work

## Follow-Up Phases

- **Service package configuration:** a CRUD editor in Settings, plus default-fee-driven invoicing when a
  new annual-return case opens.
- **Enquiries on Postgres:** an enquiries table, which restores a persisted enquiry-to-company conversion
  link.
- **Login and admin:** replaces `getCurrentActorId()` with a real session and adds role-based permissions
  to client operations. Design and plan already exist at
  `docs/superpowers/specs/2026-07-07-login-admin-design.md`.
