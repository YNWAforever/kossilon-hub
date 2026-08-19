# Checklist Templates Persistence Design (P1-12)

## Overview

`src/lib/templates.ts` is an in-memory, module-level store (`useSyncExternalStore` + closed-over
array) backing the "Checklist templates" editor on `/settings`. It has a full CRUD surface — 13
mutation methods — but nothing behind it: no table, no repository, no server fn. Any edit is lost
on reload, and the store predates the Two-Mode Split, so it has no `dataMode` branch at all.

`-settings-sections.ts` currently contains the actual mitigation in production: `checklistTemplates`
is `demo`-only, so the whole editor (and its 23 `templatesStore.*` call sites) is unreachable in
production today. `docs/adr/0001-demo-mode-is-read-only.md` names this store by number (23 call
sites) as the one exception to "demo mode is read-only," explicitly deferred: "it belongs with the
`settings.tsx` fix." This is that fix.

**Goal:** give checklist templates a real, persisted, Admin-only production implementation, and
bring demo mode's template editor into line with every other demo screen (read-only fixture, no
write path) — closing the ADR's named exception. This blocks P1-1 (create-a-case) and P1-7
(incorporation intake), per the roadmap, but wiring templates into case creation is explicitly out
of scope here — those tasks define their own accessor needs.

## Data model

New migration `db/migrations/0013_checklist_templates.sql` (0012 is already taken by
`annual_return_reminder_events`, merged to `main` since this branch was first planned):

```sql
create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  service_type text not null check (service_type in (
    'Annual Return — Private Ltd', 'Annual Return — Public Ltd',
    'Incorporation — HK Ltd', 'Change of Director', 'Deregistration'
  )),
  description text not null default '',
  active boolean not null default true,
  documents jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '[]'::jsonb,
  risk_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
values
  ('Annual return — Private Ltd', 'Annual Return — Private Ltd', '...', true, '[...]'::jsonb, '[...]'::jsonb, '[...]'::jsonb),
  -- one row per current demo template, same data as src/lib/templates.ts's initialTemplates
  ...
on conflict (name) do nothing;
```

The `unique` constraint on `name` mirrors the existing seeding precedent at
`db/migrations/0008_client_register.sql:2-17` (`service_packages.name text not null unique`, seeded
via `insert ... on conflict (name) do nothing`) — the same mechanism this migration uses to seed the
five current demo templates as real rows. It is not a substitute for the deliberately-omitted
per-`service_type` uniqueness constraint discussed below.

One table, not three child tables for `documents`/`reminders`/`risk_rules`. This mirrors the
existing `sla_policies.escalation_targets jsonb not null default '[]'::jsonb` precedent
(`schema.sql:268`) — a row that owns a config array, read and written as a whole. Nothing needs to
query documents/reminders/risk-rules across templates, so relational normalization into child
tables would add migration and repository complexity (three extra tables, FK plumbing, JSONB-array
surgery avoided anyway) for no real query benefit.

Each `documents`/`reminders`/`risk_rules` array element keeps its own client-generated `id` string
(same convention as today's in-memory `rid()`), now persisted as part of the JSONB blob rather than
held only in memory.

The migration seeds the current five demo templates (Annual Return — Private/Public Ltd,
Incorporation — HK Ltd, Change of Director, Deregistration) as the initial production rows, so a
fresh deployment isn't starting from zero templates.

**Persisting the full three-part shape is a deliberate scope choice, not an oversight:** today only
the `documents` list has a real downstream consumer (the future `annual_return_checklist_items`
instantiation in P1-1). `reminders` and `risk_rules` are persisted as configuration that nothing
reads yet — the automated reminder cadence (P1-2) is a fixed, system-wide 1-month/2-week/1-week
schedule, not per-template, and there is no risk-scoring engine anywhere in the codebase today.
This was confirmed and chosen explicitly during design review, on the basis that it matches the
demo editor's existing three-tab shape and keeps the door open for a future per-template cadence or
risk engine without a second migration.

## Module structure

A new vertical-slice module, matching this codebase's established convention
(`documents/`, `clients/`, `annual-return/`, …):

```
src/features/checklist-templates/
  types.ts        ChecklistTemplate, DocumentItem, ReminderRule, RiskRule, ServiceType, SERVICE_TYPES
  repository.ts   ChecklistTemplateRepository — tagged-template SQL against checklist_templates
  server-fns.ts   *ForActor functions + createServerFn wrappers
```

`types.ts` becomes the **single canonical source** for these types. `src/lib/templates.ts` (the
demo fixture) imports them rather than redeclaring them. This directly avoids repeating the
mistake ADR-0001 names as the reason it rejected restoring a parallel demo write-path: "three
incompatible `AnnualReturnCase` types" that had already diverged by the time the ADR was written.
One shared type definition, two data sources (a Postgres-backed repository in production, a static
array in demo).

## Authorization & server fns

`/settings` is already Admin-gated in production end-to-end (this session's P0-7 work: `settings.tsx`
returns a denied state to any non-Admin actor in production before rendering any section). By the
time a request reaches this section, the caller is already known to be Admin — but every new server
fn independently asserts Admin regardless, never trusting the page-level gate alone, matching the
`assertAdminAccess` precedent established for the outbox-dispatch fix (P0-8): "Forbidden: Admin
access is required."

Server fns (`src/features/checklist-templates/server-fns.ts`):

- `listChecklistTemplates` → `listChecklistTemplatesForActor(actor, {}, deps)`
- `createChecklistTemplate` → `createChecklistTemplateForActor(actor, { serviceType }, deps)`
- `updateChecklistTemplate` → `updateChecklistTemplateForActor(actor, { id, patch }, deps)`
- `duplicateChecklistTemplate` → `duplicateChecklistTemplateForActor(actor, { id }, deps)`
- `deleteChecklistTemplate` → `deleteChecklistTemplateForActor(actor, { id }, deps)`

`updateChecklistTemplateForActor` is **one patch-based endpoint**, not thirteen. The client computes
the new value locally — add/edit/remove a document row, toggle `active`, change `serviceType` — the
same way today's in-memory `templatesStore.update(id, patch)` already works, then sends the whole
changed field(s) in one call. This reuses a single mutation hook for every control in the editor
instead of exploding into a server fn per store method, and needs no JSONB-array surgery in SQL:
`update checklist_templates set documents = $1, updated_at = now() where id = $2`, for example.

Each `*ForActor` function validates via the existing Zod-validator convention on its `createServerFn`
wrapper, and is unit-tested against a mocked repository, matching the codebase-wide pattern (593 of
653 existing tests run with no database for exactly this reason).

## UI: demo goes read-only, production becomes real

`-settings-sections.ts`'s `checklistTemplates` flag changes from `demo`-only to `true` in both
modes. Its doc comment is corrected — it currently says "there is no table for either [checklist
templates or the knowledge base]... nothing in production reads them," which becomes false for
checklist templates specifically (the knowledge base and service packages are unaffected by this
task and stay demo-only).

`settings.tsx`'s template section branches on `dataMode`:

- **Demo**: reads a static fixture array (the same five templates, now typed from
  `checklist-templates/types.ts` instead of locally declared), renders the same list/detail view,
  but with every mutating control removed: no "New template" button, no Duplicate/Delete, no
  editable fields in `DocumentsTab`/`RemindersTab`/`RisksTab` — plain read-only rows instead. This
  matches the read-only pattern every other demo screen already uses post-ADR-0001, and closes the
  one exception the ADR calls out by name.
- **Production**: the same UI shell (list + detail + three tabs), wired to `useQuery` (list) and
  `useMutation` (create/update/duplicate/delete) against the new server fns instead of
  `templatesStore`.

Text inputs (name, description, document/reminder/risk-rule labels, trigger text) commit on `blur`,
not on every keystroke, to avoid a network round trip per character — local component state holds
the in-progress edit, matching normal form UX, and the mutation fires once the field loses focus.
Checkboxes, selects, and add/remove/duplicate/delete buttons commit immediately, since those are
already discrete actions rather than continuous typing.

`src/lib/templates.ts` is trimmed to: the five-template fixture array (typed from the shared
module), a read-only `useTemplates()` hook, and `templateForService()` / `SERVICE_TYPES` re-exports.
All 13 mutation methods (`update`, `create`, `duplicate`, `remove`, `addDocument`, `updateDocument`,
`removeDocument`, `addReminder`, `updateReminder`, `removeReminder`, `addRisk`, `updateRisk`,
`removeRisk`) are deleted — matching how `annual-return-store.ts` and `client-portal-store.ts` have
no write path today.

## Existing tests affected

`-final-review-restorations.test.ts`'s `"restores editable settings while retaining the knowledge
base"` test currently asserts `settingsSource` contains `"templatesStore.update"` and
`"templatesStore.addDocument"` — a source-text regression gate for the in-memory editor. Both calls
are removed by this change, so the test is updated to assert the new source shape instead (e.g. the
production mutation hook names), keeping its actual intent — confirming the templates section still
renders with working controls — rather than deleting the coverage outright.

## Testing

- `checklist-templates/server-fns.test.ts`: Admin-only enforcement (rejects non-Admin with
  `"Forbidden: Admin access is required."`, matching the `assertAdminAccess` convention),
  patch-merge semantics for `updateChecklistTemplateForActor`, create/duplicate/delete behavior —
  all against a mocked repository, no database.
- `checklist-templates/repository.test.ts`: a `describe.skipIf(!databaseUrl)` DB-integration suite
  (matching the existing convention for the ~60 tests that need a real Postgres) proving the actual
  JSONB read/write round trip preserves array shape and item ids.
- A route-level test for `/settings` (extending the existing `-settings-admin-guard.test.tsx`
  harness or a new sibling file) confirming: demo renders the template list with no mutating
  controls; production renders the full editor for an Admin actor, backed by the new query/mutation
  hooks.
- Update `-final-review-restorations.test.ts` per above.

Full suite + `tsc --noEmit` + `lint` at the end, same discipline as every prior feature this
session.

## Out of scope

- Wiring templates into actual case creation (`templateForService`, instantiating
  `annual_return_checklist_items` from a template's `documents` list) — that is P1-1's job, which
  will define exactly what accessor shape it needs from this module.
- Any change to the automated reminder cadence (P1-2's fixed system-wide milestones) or a
  risk-scoring engine that would actually consume the persisted `reminders`/`risk_rules` fields —
  they are persisted as configuration; nothing reads them yet, same as today.
- The demo screen's cosmetic per-template "usage count" badge (already flagged in its own code
  comment as "simplistic: assume all AR cases use the AR template") — left as-is, demo-only,
  unrelated to persistence.
- A uniqueness constraint preventing two `active` templates for the same `service_type` — today's
  in-memory store has no such constraint either (`templateForService` just returns the first
  match), and this task preserves existing behavior rather than tightening it.

## Acceptance

1. An Admin actor in production can create, edit (name, description, service type, active flag,
   documents, reminders, risk rules), duplicate, and delete checklist templates, and the changes
   survive a reload (persisted in Postgres).
2. A non-Admin actor's call to any of the five new server fns is rejected with a `Forbidden:`
   error, independent of the page-level gate.
3. Demo mode renders the same five templates read-only — no create/edit/duplicate/delete control is
   present or functional.
4. `templatesStore` (and its 13 mutation methods) no longer exists; `src/lib/templates.ts` exports
   only reads, matching every other demo store.
5. `ChecklistTemplate` and its related types are defined in exactly one place
   (`checklist-templates/types.ts`), imported by both the demo fixture and the production module.
