# Client Register UI (P1-3) — Design

## Overview

`/clients` and `/clients/$id` were deleted on `ca3f8e3` ("refactor: delete the orphaned
fixture screens") because they were fixture-backed dead screens with no importer outside
themselves. Since then the write side of the client register was built out completely and
never wired to any UI:

- `src/features/clients/repository.ts` — 704 lines, 10 methods, backed by Postgres.
- `src/features/clients/server-fns.ts` — 8 server functions (`listClients`, `getClient`,
  `listAssignmentOptions`, `createClient`, `updateClient`, `addClientContact`,
  `updateClientContact`, `removeClientContact`), each thin and Zod-validated.
- `src/features/clients/authorization.ts` — team-scoped write policy, fully tested.
- `src/components/clients/client-form-dialog.tsx` (452 lines) and
  `contact-form-dialog.tsx` — complete, already calling the server fns above, imported by
  nothing.

This plan adds the two routes and the navigation entry that make all of the above reachable.
No changes to the repository, server-fns, authorization, or either dialog are in scope beyond
whatever is required to render them from a real screen.

## Confirmed facts

- `src/components/navigation.ts:19-22` documents a deliberate decision: `/clients` has no
  fixture-backed tier. This plan keeps that decision rather than reversing it — see
  "Demo mode" below.
- `listClients()` already resolves each company's owner, team, package, latest AR due date,
  and latest payment status via one query (`repository.ts:226-262`) — the list screen needs
  no additional data-fetching beyond what already exists.
- `getClient(id)` hydrates contacts, timeline, annual-return history, and documents in one
  call (`repository.ts:264-401`) — the detail screen is a single query.
- `client-form-dialog.tsx` already branches on an optional `client` prop to switch between
  create and edit mode, and already renders inline field errors for `crNumber`/`brNumber`/
  `contact` via a `field` property on thrown errors. No dialog changes needed.
- `annual-return/production-case-detail.tsx` and `annual-return/production-command-center.tsx`
  are the direct precedents for both new screens' structure (route branches on `dataMode`,
  delegates to a `Production*` component that owns its own queries).

## Scope

**In scope:**
- `src/routes/clients.tsx` — register (list) route.
- `src/routes/clients.$id.tsx` — detail route.
- `src/features/clients/components/production-client-register.tsx` — list screen.
- `src/features/clients/components/production-client-detail.tsx` — detail screen.
- `src/features/clients/components/demo-client-notice.tsx` — shared demo-mode notice.
- Restoring the `/clients` entry in `src/components/navigation.ts`.
- Wiring `<ClientFormDialog>` and `<ContactFormDialog>` into the two new screens.
- Route-level and screen-level tests for both new routes.

**Out of scope:**
- Any change to `repository.ts`, `server-fns.ts`, `authorization.ts`, `client-form-dialog.tsx`,
  or `contact-form-dialog.tsx` beyond passing them the props they already declare.
- A demo-mode fixture store for clients (explicitly declined — see "Demo mode" below).
- Document upload UI (owned by `/documents`).
- Officers/directors/shareholders data (P1-5).
- Any cross-link work beyond a single `/annual-returns/$id` link from the detail screen's
  annual-return-history rows.

## Demo mode

`/clients` stays production-only, matching the documented decision in `navigation.ts`. In
`dataMode === "demo"`, both routes render `<DemoClientNotice>` instead of calling any server
fn — demo mode has no database binding, so calling `listClients`/`getClient` there would
throw rather than degrade gracefully. `<DemoClientNotice>` takes a `variant: "register" |
"detail"` prop to vary its message slightly, renders a `<PageHeader>` (satisfying the
page-header convention test) plus one explanatory card, and performs no data fetching at all.

## Routes

`src/routes/clients.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientRegister } from "@/features/clients/components/production-client-register";

export const Route = createFileRoute("/clients")({
  component: ClientsRoute,
});

function ClientsRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="register" />
  ) : (
    <ProductionClientRegister />
  );
}
```

`src/routes/clients.$id.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientDetail } from "@/features/clients/components/production-client-detail";

export const Route = createFileRoute("/clients/$id")({
  component: ClientDetailRoute,
});

function ClientDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="detail" />
  ) : (
    <ProductionClientDetail clientId={id} />
  );
}
```

Both are flat leaf routes — no `<Outlet>` layout trick is needed (that pattern in
`annual-returns.tsx` exists only to keep the board's URL-synced filter state and hooks from
running while the child detail route is mounted; the client register has no URL-synced board
state to protect).

## List screen: `ProductionClientRegister`

**Queries**: `useQuery(["clients"], () => listClients())` and
`useQuery(["clients", "assignment-options"], () => listAssignmentOptions())`, both
unconditional on mount (the second feeds the create/edit dialogs; fetching it eagerly avoids a
loading flicker the moment "New client" is clicked, and it is a small, firm-wide, cheap read).

**Header**: `<PageHeader eyebrow="Operations" title="Clients" actions={<button>New client</button>} />`.
The button opens `<ClientFormDialog open onOpenChange={...} options={assignmentOptions} onSaved={...} />`
with no `client` prop. `onSaved` invalidates the `["clients"]` query key.

**Controls row** (same input/select classes as `annual-returns.tsx`'s control row):
- Search `<input>` — client-side filter against `companyName`, `crNumber`, `brNumber`
  (case-insensitive substring match).
- Status filter buttons: All / Active / Inactive, filtering on `status`.
- Team `<select>`: "All teams" + `assignmentOptions.teams`, filtering on `teamId`.

**Table** — a `CASE_GRID_COLUMNS`-style grid (same technique as `CaseRow` in
`annual-returns.tsx`, wrapped in `overflow-x-auto`), one row per `ClientSummary`:

| Column | Source |
|---|---|
| Company | `companyName` (bold) + `crNumber` / `brNumber` (muted, below) |
| Owner | `ownerName` |
| Team | `teamName` |
| Package | `packageName ?? "No package"` |
| Status | pill: `status` |
| AR due | `arDueDate ? formatted : "No case yet"` |
| Payment | `paymentStatus` pill, or "—" when `null` |
| Open | `<Link to="/clients/$id" params={{ id }}>Open</Link>` |

Empty state (post-filter): "No clients match the current filters." — same copy pattern as
the annual-returns board's empty state.

## Detail screen: `ProductionClientDetail`

**Props**: `{ clientId: string }`. **Queries**: `useQuery(["clients", clientId], () =>
getClient(clientId))` and `listAssignmentOptions()` (feeds the edit dialog).

**Not-found / unavailable states**: mirror `production-case-detail.tsx` — a bare
`<PageHeader eyebrow="Client" title="Client not found" />` (or "unavailable" on query error),
no crash, no further sections rendered.

**Sections, top to bottom:**

1. `<PageHeader eyebrow="Client" title={client.companyName} actions={<button>Edit</button>} />`
   — Edit opens `<ClientFormDialog client={client} options={assignmentOptions} ... />`.
2. **Overview card** — two-column definition list: CR number, BR number, incorporation date,
   AR basis date, registered office, company secretary, status pill, owner, team, package,
   latest AR due date, latest payment status.
3. **Contacts** — `client.contacts.map(...)`, each row showing name, role, email/phone, and a
   "Primary" badge when `isPrimary`. Each row has "Edit" (opens `<ContactFormDialog
   companyId={client.id} contact={contact} ... />`) and "Remove" (calls
   `removeClientContact({ data: { companyId, contactId, actorId } })` directly — no
   confirmation dialog needed beyond what the button label communicates, consistent with how
   `removeContact` in the repository has no soft-delete). A trailing "Add contact" button opens
   `<ContactFormDialog companyId={client.id} ... />` with no `contact` prop.
4. **Annual return history** — read-only rows from `client.annualReturnHistory`: return year,
   made-up date, filing due date, status. Each row that has a matching case links to
   `/annual-returns/$id`; since `ClientAnnualReturnEntry.id` is already the
   `annual_return_cases.id`, no extra lookup is needed.
5. **Documents** — read-only rows from `client.documents`: file name, file type, verification
   status pill, uploaded date. No upload affordance.
6. **Timeline** — `client.timeline`, newest first (already sorted by the repository), each row
   rendering `actorName ?? "System"`, `description`, and a relative timestamp using the same
   date formatting helper (`daysUntil`/date utilities in `src/lib/app-data.ts`) the rest of the
   app already uses.

All mutations (`addClientContact`, `updateClientContact`, `removeClientContact`) invalidate the
`["clients", clientId]` query key on success so the page re-renders from the server's returned
`ClientDetail` rather than the client optimistically guessing the new state.

## Navigation

`src/components/navigation.ts`: add `{ to: "/clients", label: "Clients", icon: Building2 }`
(swap in whatever icon isn't already claimed — `Building2` is currently unused there) to the
"Operations" group, positioned after "Annual Returns". Replace the block comment above
`navGroups` — the "deleted, not parked" framing becomes "no fixture-backed tier, by design"
now that the screen exists again in production.

## Testing

- **`src/routes/-clients-data-mode.test.tsx`** (new, prefixed per the route-dir test
  convention): renders `/clients` and `/clients/$id` in both `dataMode`s against a seeded
  fixture row. Asserts production shows real company data (name, CR number) and the "New
  client" action; asserts demo shows the notice text and none of the production markup.
- **Screen-level tests** for `ProductionClientRegister` and `ProductionClientDetail`: mock the
  relevant server fns, assert the table renders expected rows, search/filter narrow correctly,
  and both dialogs receive the right props when opened. Scoped the same way P1-1 scoped
  `CreateCaseDialog`'s coverage — route/render-level assertions, not full
  fill-the-form-and-submit interaction chains, since the dialogs' own logic is already a
  thin, tested wrapper over already-tested server fns.
- No new tests for `navigation.ts` itself — `navGroups` has no dedicated test today and this
  change doesn't alter that.

## Acceptance criteria

1. A Staff/Manager/Admin user can navigate to `/clients` in production mode and see every
   active and inactive company in a searchable, filterable table.
2. From `/clients`, a user can create a new client company via `<ClientFormDialog>` and see it
   appear in the table without a manual refresh.
3. From `/clients/$id`, a user can view a company's full profile (overview, contacts,
   AR history, documents, timeline) and edit the company or its contacts inline.
4. A user in demo mode visiting either route sees an explanatory notice, never a crash, a
   blank screen, or fixture data.
5. All 8 existing `clients` server functions have at least one UI entry point that calls them.
