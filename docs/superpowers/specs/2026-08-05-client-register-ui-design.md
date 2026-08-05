# Client Register UI

**Date:** 2026-08-05
**Status:** Approved, ready for planning
**Depends on:** the client register data layer (PR #32, branch `claude/client-register-data-layer`)

## Goal

Bring `/clients` and `/clients/$id` back as production screens reading the client
register from Postgres, and add a Clients entry to the navigation.

Success is that a staff member can answer "tell me about this client" without opening
psql: who owns the company, who to contact, what has been filed, what is outstanding.

## Why now

`src/components/navigation.ts` states the policy that governs this:

> `/clients`, `/clients/$id`, `/enquiries`, `/teams` and `/tasks` were deleted, not
> parked. Each was either superseded by a screen already reading Postgres
> (`/work-queue`, `/annual-returns`) or had no table behind it. Adding an entry here
> means the screen reads live data — there is no fixture-backed tier.

The data layer satisfies that precondition for the first time. `2026-08-01-delete-orphaned-fixture-screens`
recorded `clients.tsx` as "superseded by `/annual-returns` board (partial)", and the
qualifier is the point: every current screen is case-centric or work-centric.
`/annual-returns` lists cases, `/work-queue` lists work items, `/documents` lists
documents. Nothing lists companies.

A company with no annual-return case is therefore invisible in the entire
application — it appears on no board and in no queue. `listClients()` returns exactly
that row, and this screen is where it becomes visible.

The board answers "what is due next". The register answers "tell me about this
client". They are different questions.

## Goals

- `/clients` lists every company under management, including those with no case.
- `/clients/$id` shows contacts, annual-return history, documents, payment, and the
  company timeline.
- Contacts are manageable from the UI — today `company_contacts` has no interface.
- Navigation gains a Clients entry.
- Writes are permission-gated by role.

## Non-Goals

- **No demo variant.** See "Production only" below.
- No enquiries screen and no enquiry-to-client conversion — there is still no
  enquiries table.
- No service-package editor. Packages remain a seeded, read-only reference list.
- No delete-client operation, now or later. See "No deletion" below.
- No change to `/annual-returns` or `/work-queue`.

## Architecture

Follows the production-screen pattern already established on `main`. The previous
attempt at this feature diverged from it and became unmergeable; this spec treats the
existing pattern as the constraint rather than a suggestion.

### Route files stay thin

`src/routes/clients.tsx` renders the production directory directly — there is no demo
branch, so it does not read `dataMode` at all. The `<Outlet />` guard is hoisted **above**
the heavy hooks, so the parent holds only `useRouterState` and the child route can render
through it.

`annual-returns.tsx:40-46` documents why:

> Hoisted above both the branch and every hook. `/annual-returns/$id` is a child route
> and renders only through this outlet, so a branch placed before it would silently stop
> the detail screen from rendering.

This is not hypothetical. The earlier client-register branch placed the guard after its
hooks and `/clients/$id` rendered the directory instead of the profile — a bug that
passed both a spec review and a code-quality review and was caught only by opening the
page.

### Production only

`/clients` has no demo branch, following `/work-queue`, which is already production-only.
The data layer is Postgres-only, and a fixture-backed variant would reintroduce exactly
what the deletion pass removed.

This means the production component renders in demo mode too, where its queries have no
authenticated staff actor and fail, showing the unavailable state described under Error
Handling. That is the same behaviour `/work-queue` already has, and the nav entry is a
static list so Clients appears in both modes. Implementation should confirm `/work-queue`'s
actual demo behaviour and match it exactly rather than inventing a third pattern — if it
degrades more gracefully than described here, do the same.

### Module layout

```
src/routes/clients.tsx                                     thin brancher + outlet guard
src/routes/clients.$id.tsx                                 thin brancher
src/features/clients/permissions.ts                        role rules (pure)
src/features/clients/board-filters.ts                      URL search sanitiser (pure)
src/features/clients/components/production-client-directory.tsx
src/features/clients/components/production-client-profile.tsx
```

Components fetch through `useQuery` against the existing server functions, matching
`production-command-center.tsx`. Route loaders are not used.

Filters live in the URL via `validateSearch`, so they survive a reload and a return from
a profile. The sanitiser sits in `board-filters.ts` because a route file cannot export a
non-component without tripping react-refresh — the same reason `annual-returns` puts its
sanitiser in `board-filters.ts`.

### Auth

No route-level work. `__root.tsx`'s `beforeLoad` already redirects unauthenticated users
in production mode.

## Permissions

A new `src/features/clients/permissions.ts`, shaped like `annual-return/permissions.ts`
so the two read alike.

```ts
export type ClientAction =
  | "view_register"
  | "edit_details"
  | "create_client"
  | "deactivate_client"
  | "reassign_client";
```

Decided from `AuthenticatedActor` alone, which already carries `userId`, `role`,
`teamId`, and `active` — no extra queries.

| Actor | view_register | edit_details | create / deactivate / reassign |
| --- | --- | --- | --- |
| Inactive, any role | refused | refused | refused |
| `Client` | refused | refused | refused |
| `Staff` | yes | yes | refused |
| `Manager` | yes | yes | yes |
| `Admin` | yes | yes | yes |

`edit_details` covers registered office, company secretary, service package, and all
contact operations. `reassign_client` covers assigned owner and assigned team.
`deactivate_client` covers the `status` toggle.

The inactive check runs **before** the Admin shortcut, matching `caseFiltersForActor`, so
an inactive Admin is refused for being inactive rather than admitted for being an Admin.
`Client` is refused on role, not incidentally for lacking a staff row, so a portal user
can never reach the staff register.

### The deliberate deviation on read scope

`permissions.ts:117` states the codebase principle:

> The narrowing a list read must apply so a board shows exactly the cases whose detail
> screens will accept actions.

The register does not narrow reads by team or owner: every active staff member sees every
company. This departs from that principle and is intentional.

A company register is reference data. Knowing that Harbour Trading Ltd is a client and who
to call there is not sensitive within the firm, and a "system of record" that shows a staff
member only their own slice of the record fails at its one job — looking something up. The
principle's real target is *acting* on something you should not, and `edit_details` plus the
three managed actions still enforce that.

Recorded here so a future reader sees a decision rather than an oversight.

### Enforcement

In the server functions, which currently resolve only `userId`. They resolve the full
`AuthenticatedActor` and assert the action before calling the repository. Failures throw
`Forbidden:`-prefixed errors, matching the codebase convention.

The repository keeps its own `assertActor` database check. It should not trust its caller,
and that check also catches a user deactivated or deleted mid-session.

If PR #32 has not merged when this starts, this is an amendment to it rather than a new file.

## Screens

### `/clients`

Columns: company, CR/BR, package, owner, team, AR deadline, payment status, status.

Search matches company name, CR number, BR number, and owner name. Filters for package,
team, and status, all in the URL. Status defaults to `active`, so deactivated companies stay
out of the way without becoming unreachable.

A company with no annual-return case renders "No case" in the deadline column rather than a
blank or a zero. These rows are the reason the screen exists and must not read as broken data.

"Add client" renders only for Admin and Manager — hidden rather than disabled, so the UI never
offers an action the server will reject.

### `/clients/$id`

Header: company identity, package, owner, team, status.

Panels: contacts; annual-return history linking to `/annual-returns/$id`; documents; latest
payment; and a company timeline from `timeline_events`, which is where the register's own audit
trail surfaces — every create, edit, and contact change the repository writes.

Contacts are the interactive centre: add, edit, remove, promote to primary. The primary contact
is marked, and the dialog states that promoting demotes the current primary. The database enforces
that invariant through `company_contacts_primary_uidx`, so the UI only has to explain it.

Staff see contact controls and a details editor covering registered office, company secretary, and
package. Owner, team, and status controls render only for Admin and Manager.

### Dialogs

`src/components/clients/client-form-dialog.tsx` and `contact-form-dialog.tsx` already exist from the
data-layer work but are unused, because they were written against the architecture `main` replaced.
Two adaptations:

- They call `router.invalidate()`, which suits a loader-based route. On `useQuery` they must call
  `queryClient.invalidateQueries` for the affected keys.
- They take `options` as a prop sourced from loader data; that becomes a `useQuery` result.

They also become permission-aware, rendering the owner, team, and status controls only when the
actor may use them.

## No deletion

There is no delete-client operation and none should be added. `annual_return_cases`, `documents`,
`payments`, and `timeline_events` all cascade on `company_id`, so deleting a company would silently
destroy its statutory filing history. Companies are deactivated through `status`, and the directory
filters on it.

## Error Handling

**Failed query** renders an explicit unavailable state with a retry, not an empty table. An empty
table means "you have no clients", which is false and alarming. `production-command-center.tsx`
already distinguishes these two states; this follows it.

**Unknown id** renders a not-found state linking back to the register.

**Constraint violations** already map to form fields through `errors.ts` — duplicate CR or BR number,
and a contact with neither email nor phone. That work is done and tested.

**Permission failures** throw `Forbidden:`-prefixed errors. Because controls are hidden rather than
disabled, a user should not encounter one unless their role changed mid-session.

## Testing

**`permissions.test.ts`** — every role against every action, including the inactive-Admin ordering
and the `Client` refusal. Pure, fast, and the highest-value test here: it encodes the reasoning
behind the read-scope deviation.

**`board-filters.test.ts`** — URL round-trips, and that a malformed query string degrades to defaults
rather than throwing.

**`production-client-directory.interaction.test.tsx`** — filters narrow the list; a no-case company
renders "No case"; the unavailable state offers a retry; Staff do not see "Add client" while Admin does.

**`production-client-profile.interaction.test.tsx`** — contacts render primary-first; the primary badge
appears; Staff see contact controls but not owner, team, or status controls; the not-found state renders
for an unknown id.

Both interaction suites use `@testing-library/react`, which is available on `main` and was not when the
previous attempt was written.

**Repository integration tests** are already green at 31/31 and change only where `listClients` changes.

## Follow-Up Phases

- **Contacts into WhatsApp:** resolve inbound senders and outbound reminder recipients from
  `company_contacts` instead of manually typed names and phone numbers.
- **Service package configuration:** an editor in Settings, plus default-fee-driven invoicing.
- **Enquiries on Postgres:** an enquiries table, which would restore a persisted
  enquiry-to-company conversion link.
