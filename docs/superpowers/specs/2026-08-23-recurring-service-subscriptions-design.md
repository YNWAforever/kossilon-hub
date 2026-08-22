# P1-8: Recurring Service Subscriptions and Renewals — Design

## Context

From `01-Kossilon-Hub-Roadmap-P0-P3.md`: "Recurring service subscriptions and
renewals — `service_packages` seeds Basic/Standard/Premium (`migrations/0008`)
— unnamed fee tiers, no route, no renewal logic. Per-company service
subscriptions with the actual catalogue fees — secretary HK$2,800/yr,
registered office HK$2,800/yr, director correspondence address HK$1,000/yr, DR
HK$2,000/yr — each with its own renewal date and reminder. This is the firm's
recurring revenue; it is currently tracked nowhere."

This is the first roadmap item picked after the GA cut plus P1-5/P1-6/P1-7,
depending only on P1-4 (generalized work items — not touched here, since
subscriptions have no work-queue involvement) being merged, which it is.

The existing `service_packages` table (three unnamed generic tiers, one
assignable per company via `companies.service_package_id`) does not match
what this item needs: four *specific, named* services a company can hold
concurrently, each independently renewable. It is purely descriptive today —
no dates, no renewal logic, no reminders — and is retired by this work.

P1-6 already added a `designated_representative` `officer_type` on `officers`
with its own appointment/cessation lifecycle, but explicitly deferred that
role's HK$2,000/yr renewal *billing* to this item. This spec keeps that
linkage informal, per the Scope section below.

## Scope

In scope:
- A new `service_subscriptions` table tracking, per company, which of the
  four named services it holds, each with its own fee and renewal date.
- Reminders at 1 month / 2 weeks / 1 week before each subscription's renewal
  date, via the same milestone-gated, once-per-milestone cron mechanism
  already built for P1-2's annual-return reminders.
- A "Subscriptions" section on `/clients/$id`: add, mark renewed, cancel.
- Retiring `service_packages` and `companies.service_package_id`.

Out of scope (explicitly deferred):
- **Real payment/invoice generation.** Renewing a subscription only advances
  its `renewal_date`; it does not create a `payments` row. `payments` today
  is scoped to `annual_return_cases` only (`case_id` FK). Generalizing it to
  also serve subscriptions would need the same `case_type`-discriminator
  treatment P1-4 already applied to `work_items` — a real, proven pattern,
  but genuinely separate scope from getting renewal *tracking* to exist at
  all. A natural fast-follow once this ships, not a prerequisite for it.
- **Automatic sync with the DR officer appointment.** The DR subscription's
  `renewal_date` is tracked and managed entirely independently of
  `officers.officer_type = 'designated_representative'`'s appointment/
  cessation dates — no code links them. This means staff must remember to
  cancel a DR subscription if the DR officer resigns; nothing enforces they
  stay in sync. Accepted deliberately: tightly coupling subscriptions to
  officer lifecycle events would be real cross-feature coupling this
  codebase has consistently avoided (see incorporation's `completeCase`
  duplicating `createClient`'s insert rather than importing across feature
  slices, and this session's fix decoupling document storage from firm
  runtime config for the identical reason). A loose, staff-visible link
  (showing the current DR officer's name next to the subscription, read
  only) is a reasonable future addition, not part of this pass.
- **A configurable service catalogue.** The four service types and their
  standard fees are a fixed, CHECK-constrained set, matching this codebase's
  established pattern for closed vocabularies that rarely change
  (`officer_type`, case-type discriminators). An Admin cannot add a fifth
  service type without a migration. If the firm's real catalogue turns out
  to change often, a `service_catalogue` table (successor to the retired
  `service_packages`) is the natural evolution — not built now, since there
  is no evidence yet that it needs to be data-driven rather than code-driven.
- **A dedicated `/subscriptions` cross-company list route.** Subscriptions
  have no case lifecycle (create → track → complete) the way incorporation
  or SCR cases do — they are ongoing per-company state, so they live on
  `/clients/$id` alongside Officers/Shareholders/SCR/DR rather than getting
  their own top-level screen. A firm-wide "what's renewing soon" view is a
  plausible future need but not part of this pass.

## Data model

### `service_subscriptions` (new table)

```sql
create table if not exists service_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  service_type text not null check (service_type in (
    'secretary', 'registered_office', 'director_correspondence_address', 'designated_representative'
  )),
  fee integer not null check (fee > 0),
  status text not null default 'Active' check (status in ('Active', 'Cancelled')),
  renewal_date date not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_subscriptions_one_per_type unique (company_id, service_type)
);

create index if not exists service_subscriptions_company_idx on service_subscriptions (company_id);
create index if not exists service_subscriptions_renewal_date_idx on service_subscriptions (renewal_date)
  where status = 'Active';
```

Notes:
- **`fee` is an `integer`**, matching the existing convention across this
  codebase (`payments.amount`, `service_packages.default_fee`) — plain HKD
  dollars, never `numeric`. Defaults from a fixed per-`service_type` constant
  at creation (Secretary $2,800, Registered Office $2,800, Director
  Correspondence Address $1,000, DR $2,000) but is a normal staff-editable
  column afterward, the same way `payments.amount` is editable despite having
  a "standard" expectation elsewhere.
- **One row per `(company, service_type)`, ever** — the unique constraint
  means cancelling and later resubscribing to the same service type
  *reactivates the existing row* (sets `status = 'Active'`, `cancelled_at =
  null`, and a fresh `renewal_date`) rather than inserting a new one. This
  keeps the schema and every query simple (no "most recent row per type"
  pattern needed anywhere) at the cost of not preserving a full history of
  distinct subscription periods — acceptable, since nothing in this item's
  scope needs that history.
- **No `team_id` column.** Unlike `incorporation_cases` (which has no company
  yet at creation), a subscription always has a company, so authorization
  derives `team_id` from `companies.assigned_team_id` — the same pattern
  `officers`/`shareholdings`/`significant_controllers` already use.
- **`cancelled_at`** is set once, on cancellation, and cleared back to `null`
  on reactivation (matching the "set-once, cleared-on-reactivation" shape
  already familiar from this codebase's checklist-item timestamp handling,
  just applied to a top-level row instead of a nested item).
- **Partial index on `renewal_date`** scoped to `status = 'Active'` — the
  reminder sweep only ever needs to scan active subscriptions.

### `service_subscription_reminder_events` (new table)

Mirrors `annual_return_reminder_events` exactly:

```sql
create table if not exists service_subscription_reminder_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references service_subscriptions(id) on delete cascade,
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  sent_at timestamptz not null default now(),
  constraint service_subscription_reminder_events_unique unique (subscription_id, milestone)
);
```

Milestone values (`'1_month'`, `'2_week'`, `'1_week'`, singular) match
`annual_return_reminder_events`'s exact naming byte-for-byte — not
`'2_weeks'` — so nothing has to remember two different spellings across the
two features. The unique constraint is what makes each milestone fire at
most once per subscription — the same gating mechanism P1-2 already proved
out.

### Retiring `service_packages`

This same migration:
- Drops `companies.service_package_id` (and its FK).
- Drops the `service_packages` table.
- Removes every reference in `src/features/clients/repository.ts` (the
  `listServicePackages`/`listAssignmentOptions`'s `packages` field, the
  `sp`/`service_packages` joins and `package_name` projections in
  `listClients`/`hydrateClient`) and the corresponding fields in
  `src/features/clients/types.ts` and the client-list/detail UI components
  that currently render `package_name`.

## Repository & server-fns layer

New feature module `src/features/service-subscriptions/` (`types.ts`,
`repository.ts`, `server-fns.ts`) plus a shared constants file for the fixed
service-type catalogue (label, default fee) reused by both the repository
(default fee at creation) and the UI (dropdown labels) — not duplicated in
two places, matching how `INCORPORATION_STATUSES` is defined once in
`incorporation/types.ts` and referenced everywhere else.

- **`listSubscriptions(companyId)`**: all subscriptions (active and
  cancelled) for a company, ordered by `service_type`.
- **`addSubscription`**: inserts a new row, or — if a cancelled row already
  exists for that `(company, service_type)` — reactivates it (`status =
  'Active'`, `cancelled_at = null`, `renewal_date` and `fee` set from input).
  Rejects if an *active* row for that type already exists (the unique
  constraint enforces this at the DB layer; the repository translates the
  constraint violation into a clear "already has an active `<type>`
  subscription" error, the same translation-layer pattern
  `rethrowClientWriteError` already establishes for `clients`/`companies`
  constraint violations).
- **`renewSubscription`**: advances `renewal_date` by exactly one calendar
  year from its *current* value — reusing `oneYearLater`'s genuine
  year-increment logic (Feb 29 → Mar 1 rollover included), not
  `offsetDateOnly`'s day-based arithmetic and not a flat 365-day add. Only
  callable on an `Active` subscription. `oneYearLater` moves from
  `incorporation/workflow.ts` to `src/lib/date-math.ts` as part of this
  work, for the same reason `dueMilestone` moves in the Reminders section
  below: two independent feature slices now need this exact pure date-math
  function, and importing it peer-to-peer from one feature into another
  would be the same awkward, one-directional dependency. `incorporation/
  workflow.ts` re-exports from the new location so its own existing imports
  keep working unchanged.
- **`cancelSubscription`**: sets `status = 'Cancelled'`, `cancelled_at =
  now()`. Only callable on an `Active` subscription (cancelling an already
  cancelled one throws, matching `completeIncorporationCase`'s precedent of
  rejecting a redundant terminal transition).
- **Authorization**: a new `service-subscriptions/authorization.ts`, scoped
  to `companies.assigned_team_id` (resolved via a join, same shape as
  `officers/authorization.ts`) — Staff/Manager/Admin, matching every other
  company-scoped feature.

## Reminders

`dueMilestone`/`REMINDER_MILESTONES`/`MILESTONE_OFFSET_DAYS` (currently
inside `annual-return/reminder-cadence.ts`) move to `src/lib/
reminder-cadence.ts` as part of this work — a small, targeted extraction,
not a rewrite. Two independent feature slices now need this exact pure,
stateless milestone logic; importing it peer-to-peer from one feature
into another would be an awkward, one-directional dependency, whereas both
importing from a shared, non-feature-owned location matches how this
codebase already treats genuinely shared pure logic (e.g. `src/lib/
format-date.ts`). `annual-return/reminder-cadence.ts` re-exports from the
new location so its own existing imports keep working unchanged.

New `evaluateServiceSubscriptionReminders`, reusing the shared
`dueMilestone` directly rather than reimplementing it: for a subscription
with `daysRemaining` days until
`renewal_date`, the **single most urgent milestone** whose 30/14/7-day
threshold is satisfied and hasn't already fired is the only one considered
per sweep tick — never fall through and fire multiple milestones for the
same subscription in one tick, and never fire a less-urgent milestone once a
more-urgent one has already fired for it. This is not a simplification; it
is the exact fix for a real cascading-duplicate-milestone bug P1-2 hit once
already (see `dueMilestone`'s own comment in `reminder-cadence.ts`) — a naive
"check each of the 3 milestones independently" implementation would
reintroduce it. For whichever subscription/milestone pair is due, resolve
the recipient (company's primary contact, WhatsApp if phone on file else
email — identical resolution to P1-2), send via the same channel-selection
path, and insert the gating row in the same transaction as the send to
prevent a double-fire on a concurrent or retried sweep. Wired into the
existing 5-minute maintenance cron (`runFirmMaintenance`) alongside the
annual-return reminder sweep and the SLA escalation sweep — not a new cron
trigger.

Reminder copy: a new draft builder in Traditional Chinese (matching the
existing `buildReminderDraft` convention for annual-return reminders),
naming the service type and its fee, e.g. "貴公司的登記代表 (Designated
Representative) 服務將於 2026-09-15 到期，續期費用為 HK$2,000。"

## UI

- **`/clients/$id`**: new "Subscriptions" section, positioned after
  Officers/Shareholders and before SCR/DR (matching the order services were
  introduced). Lists each subscription (service type, fee, renewal date via
  the existing shared `DeadlinePill` component for risk coloring, status),
  with "Mark renewed" and "Cancel" actions per row (`Cancel` hidden once
  already `Cancelled`).
- An "Add subscription" control opens a small dialog offering only the
  service types the company does not currently have an *active* row for
  (cancelled-and-reactivatable types are offered too, since `addSubscription`
  handles reactivation transparently) — proposed renewal date defaults to one
  year from today, fee defaults from the fixed catalogue constant, both
  editable before submit.
- **No demo-mode tier** — `DemoClientNotice`'s existing pattern already
  covers the whole `/clients/$id` page (this is a section within it, not a
  new route), so nothing new is needed here.
- **`service_packages` UI removal**: the client list's "Package" column and
  the client detail page's package display/selector are removed in the same
  pass that retires the table (see Data model above) — leaving them pointing
  at a dropped column would be a build-breaking dangling reference, not an
  optional cleanup.

## Testing & acceptance

- Unit tests for the pure renewal-date year-increment reuse (leap-year case,
  mirroring `oneYearLater`'s existing coverage) and for the milestone-window
  selection logic (mirroring P1-2's cascading-duplicate-milestone regression
  coverage — the exact bug class P1-2 caught once already).
- Repository integration tests (`describe.skipIf(!databaseUrl)`): add
  (including reactivation of a cancelled row), reject a duplicate active
  add, renew, cancel, reject renewing/cancelling an already-cancelled row,
  reminder-milestone gating (fires once per milestone, never re-fires, stops
  firing after cancellation).
- Component tests: the new Subscriptions section (add, renew, cancel,
  service-type-offered-list correctly excludes active types).
- A migration-consistency check confirming `service_packages` and
  `companies.service_package_id` are fully gone from `schema.sql` and every
  source reference, so CI's own `migration-schema` gate and a full-repo grep
  both come back clean.

**Acceptance**: a subscription can be added to a company for any of the four
service types; renewing advances its date by exactly one year; cancelling
stops its reminders; re-adding a cancelled type reactivates the same row;
reminders fire at 1 month/2 weeks/1 week before renewal and never twice for
the same milestone; `service_packages` is fully retired with no dangling
references anywhere in the codebase; full suite green **and CI's
DB-integration job confirmed green in an actual run** before treating the
branch as mergeable.
