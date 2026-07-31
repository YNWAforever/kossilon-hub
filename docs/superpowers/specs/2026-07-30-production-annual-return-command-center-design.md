# Production Annual Return Command Center Design

**Date:** 2026-07-30

## Purpose

`/annual-returns` is the flagship screen of the platform and it renders demo fixtures in
production. The route reads `useAnnualReturnCases()` from `src/lib/annual-return-store.ts`
with no `dataMode` branch, while its child detail route `/annual-returns/$id` does branch to
`ProductionAnnualReturnCaseDetail`. In production the board therefore lists Crestview and
Delta Bloom, and clicking a row hands a fixture id such as `ar-delta` to a component that
queries Postgres.

`src/components/navigation.ts:20` already records the reasoning that fixes this — `/clients`,
`/enquiries`, `/teams` and `/tasks` were removed from navigation because "presenting invented
figures beside live ones is misleading". That reasoning was applied to four screens and
stopped. `/annual-returns` has the same defect and is still in production navigation.

This phase gives the board a production implementation reading real cases, and scopes the
list server function to the acting staff member.

## Scope

**In scope**

- A production board component reading `listAnnualReturnCases`.
- Actor scoping on `listAnnualReturnCases`, including the filter-shape change that makes the
  firm's own permission rule expressible.
- Board filter state moved into the URL.
- The route-level `dataMode` branch, with its `<Outlet />` contract preserved.
- Two defects found during design that this screen would otherwise inherit: the `payments.tsx`
  invalidation gap and its simultaneous error-and-empty rendering.

**Out of scope**

- Creating annual-return cases. Cases reach production through
  `scripts/db-seed-annual-return.ts`, and case creation needs the checklist-template decision
  deferred in `docs/adr/0001-demo-mode-is-read-only.md`.
- Automatic case generation from company records.
- Changing the demo board's columns, data or markup. Its markup strings are pinned by an
  existing test (see Architecture). The demo body does move within `annual-returns.tsx`,
  from the route component into a sibling `DemoAnnualReturnCommandCenter` in the same file,
  so the route component can branch — but no line of its JSX changes.
- `/whatsapp`, which reads `lib/app-data` fixtures and has the same defect. Noted, not fixed.

## Chosen Approach

A second component behind a route-level `dataMode` branch, matching the four routes that
already do this (`annual-returns.$id.tsx`, `payments.tsx`, `portal.tsx`,
`whatsapp.automation.tsx`).

The alternative — one component over a shared view model with a demo adapter and a production
adapter — was rejected for now. The two models disagree about what a case _is_, not about
field names: six kebab-case statuses against eleven Title Case ones; `owner` as a display
string against `ownerId` plus `ownerName`; packet requirements as a stored checkbox list
against readiness derived from checklist and payment; follow-ups held on the case against
follow-ups in their own repository. A view model serving both is either lossy or invents
fields for one side, and the cost is paid before anyone knows which columns the firm uses.

Deleting demo mode for this route was also rejected: the demo exists to show the product
without a database, and the annual-return board is the thing worth showing.

Once the production board has been used, the cheapest end state is likely to point demo at the
production component with fixtures shaped as production types — reaching the shared-component
destination by deletion rather than by abstraction.

## What The Board Can Honestly Show

`listAnnualReturnCases({ data: {} })` returns **fully hydrated** cases. `listCases`
(`repository.ts:654`) goes through the same `hydrateCases` (`repository.ts:586`) as `getCase`,
batch-loading every checklist row and payment row for the result set. There is no thin list
projection: a list element and a detail case are the identical shape.

`riskLevel` is server-derived, not the stored column. `hydrateCase` (`repository.ts:339`)
selects `annual_return_cases.risk_level` and then overwrites it with
`riskForCase(case_, today)` where `today` is `hongKongBusinessDate()`. The client must read
this value off the payload and must not recompute it: `workflow.ts` is client-safe, but
supplying a browser-local `today` produces a pill that disagrees with the server for anyone
outside HKT. The demo board already has this bug in miniature — `annual-returns.tsx:252` uses
`daysUntil` from `lib/app-data` for the Due column while the risk pill uses the store's own
day arithmetic.

### Columns

Company · Due (date and day delta) · Status · Risk · Owner · Checklist (verified/required) ·
Payment · Reminders · SLA.

SLA continues to come from the `listWorkQueue` call the screen already makes. Note this is a
behaviour change rather than a port: `work_items.case_id` is
`uuid not null references annual_return_cases(id)` (`src/server/db/schema.sql:281`) while demo
ids are `ar-crestview` and `ar-delta`, so the join never matches in demo and every demo row
reads "No work item". In production it will resolve.

### Risk and status are separate concerns

`riskForCase` (`workflow.ts:52`) returns `"green"` for Filed and Completed cases **only when
`completionBlockers(case_)` is empty**; otherwise it falls through to the deadline ladder, so a
filed case past its due date returns `"red"`. "Filed" in production is a `currentStatus`, not a
risk level. The board reads status first and risk second. The demo's six-value risk vocabulary
(`overdue | due-soon | blocked | healthy | ready-to-file | filed`) has no mapping onto
`green | yellow | orange | red`.

### Columns that do not survive

| Demo column                     | Why                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Readiness % (the `Case` column) | Five 20-point buckets, two of which are signature status and review status. Neither is a field on `AnnualReturnCase` (`types.ts:61-82`) nor a column on `annual_return_cases` (`schema.sql:70-101`). The nearest shipped analogue is the raw verified/total count at `production-case-detail.tsx:276`. |
| Packet                          | No `packetRequirements` field and no packet table. The only analogue is `caseIsPacketReady`, a single boolean private to `production-case-detail.tsx:48`. Production "submit packet" is a status advance to `NAR1 prepared`.                                                                           |
| Next action                     | No production equivalent exists anywhere. Its inputs — "Collect signature", "Complete internal review" — are not representable.                                                                                                                                                                        |
| Search by contact               | The production case carries no contact name and no phone. `production-case-detail.tsx:470` makes the user type them. Recipient details are available only via `listProductionFollowUpDrafts`.                                                                                                          |
| Follow-ups count                | `deriveProductionFollowUpDrafts` is pure but needs `PersistedFollowUpState` — reminder-log recipients, rejected evidence, outbox deliveries. It cannot be computed from `listAnnualReturnCases` output.                                                                                                |

### Blockers must not use `completionBlockers`

`completionBlockers` (`workflow.ts:83`) exists, is tested, and is the obvious candidate for a
Blockers column. It is the wrong function for this purpose, for two reasons.

It is a **completion gate**, not a work list. It reports "Filing reference is required" and
"Filing confirmation document is required" for every case, including one three months from its
due date. Wired to a board column, every healthy case reads as blocked.

It is also only advisory. The authoritative check is SQL
(`completionBlockerMessagesForLockedCase`, `repository.ts:732`), which additionally requires
the linked document rows to exist with `verification_status = 'verified'` and the correct
file type. The case payload carries bare document UUIDs with no verification state, so a
client-computed list can report "clear" on a case the server will refuse to complete.

The board therefore has no Blockers column. Checklist (verified/required) and Payment carry
the same information without the false negatives.

## Architecture And Boundaries

### The route branch must preserve `<Outlet />`

`/annual-returns/$id` is a **child** of `/annual-returns` (`routeTree.gen.ts:113`), so it
renders only through the parent's outlet. The parent's entire nested-routing contract is
`annual-returns.tsx:75-77`:

```tsx
if (pathname !== "/annual-returns") {
  return <Outlet />;
}
```

Applying the `annual-returns.$id.tsx` pass-through shape deletes this. That failure was
reproduced during design: with the route patched to
`dataMode === "demo" ? <Demo/> : <Production/>` and the demo body kept verbatim,
rendering `/annual-returns/<uuid>` at `dataMode: "production"` produced an empty `<main>` and
the production detail component never mounted.

No existing test catches it. The only router-level test builds its router with
`context: { queryClient: new QueryClient(), dataMode: "demo" }`
(`-annual-returns-workflow.test.ts:110`), so its "renders the annual-return detail route
instead of swallowing it in the parent list route" case still passed. `dataMode: "production"`
appears in no test in the repository.

Required shape, with the guard above both the branch and the hooks:

```tsx
function AnnualReturnsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();
  if (pathname !== "/annual-returns") return <Outlet />;
  return dataMode === "demo" ? <DemoBoard /> : <ProductionAnnualReturnCommandCenter />;
}
```

Hoisting also fixes a second problem: the guard currently sits after every hook, so the demo
store subscription, the `listWorkQueue` query and the whole filter and sort pipeline run while
the detail screen is displayed. `whatsapp.tsx:32` is the precedent.

The guard is exact string equality, so `/annual-returns/` with a trailing slash misses it.
Preserved as-is; noted so it is a known limit rather than a surprise.

### File placement is decided by existing tests

Two source-scanning tests pull in opposite directions:

- `-annual-returns-workflow.test.ts:162-167` asserts `annual-returns.tsx` contains
  `<span>Blockers</span>`, `<span>Packet</span>`, `<span>Follow-ups</span>` and
  `<Field label="Blockers" value={blockerSummary} />`. The demo markup must stay in the route
  file.
- `-annual-returns-table-layout.test.ts` requires exactly one `lg:grid-cols-[minmax` literal
  and zero unprefixed `min-w-[Npx]` in that file. Both assertions were reproduced failing
  against a production stub added to the same file. The production grid must leave the file.

The only arrangement satisfying both without editing either test:

- The demo board stays inline in `src/routes/annual-returns.tsx`, as a
  `DemoAnnualReturnCommandCenter` function beside the route component. Its JSX, its
  `CASE_GRID_COLUMNS` constant and its `CASE_GRID_MIN_WIDTH` constant are untouched — only the
  enclosing function name and the removal of the `<Outlet />` guard (which moves up into the
  route component) change.
- `ProductionAnnualReturnCommandCenter` lives in
  `src/features/annual-return/components/production-command-center.tsx`, with its own grid
  template, which is why it cannot share the file.

This also matches the repository's convention — `Production`-prefixed named export, kebab-case
file under `src/features/<feature>/components/` — and keeps `<PageHeader` present in the route
file, so `page-header.convention.test.ts` needs no new `passThroughRoutes` entry.

The new file is added to the banned-import list in `-production-authorization.test.ts:48-51`,
which currently names only `production-case-detail.tsx` and `production-case-actions.ts`.

Because the demo body stays inline, `annual-returns.tsx` keeps its top-level
`src/lib/annual-return-store` import and the fixture module stays in the production bundle —
as it already does for `payments.tsx`, `portal.tsx` and `whatsapp.automation.tsx`. Not a
correctness problem: the demo stores export no write path (ADR 0001). It is the reason
`annual-returns.$id.tsx` is the cleaner long-term model.

### Actor scoping

`listAnnualReturnCases` applies none. `withAnnualReturnRepository` resolves the actor and
passes it to the handler; `server-fns.ts:297` discards it:

```ts
withAnnualReturnRepository((repository) => repository.listCases(data));
```

`selectCaseRows` (`repository.ts:569-581`) filters solely on client-supplied values. Any
authenticated staff member can list every case in the firm. Meanwhile `permissions.ts:83`
rejects mutations from staff who are not owner, reviewer, team manager or admin. Without
scoping, a Staff user gets a board full of rows whose detail screens reject every action.

The precedent is `queueFiltersForActor` (`work-items/server-fns.ts:58-80`) — a pure
`(actor, requested) => filters` function: Admin unrestricted, Manager forced to their team,
Staff forced to themselves, and a throw when a non-Admin has no team. This phase adds
`caseFiltersForActor` in the same shape, and `getCurrentAnnualReturnActor` already returns the
full `AuthenticatedActor` with `role`, `teamId` and `userId`.

It goes in `src/features/annual-return/permissions.ts`, not in `server-fns.ts`. That module
has zero imports and is already the home of the firm's authorization rules, so the new function
sits beside `getAnnualReturnActionPermission` — the rule it has to agree with — and its tests
need no mocking. `server-fns.ts` imports the repository and the database client, so a rule
placed there could not be tested or reasoned about in isolation.

**The permission rule is not expressible in the current filter type.**
`getAnnualReturnActionPermission` allows a Staff user who is owner **or** reviewer, while
`CaseFilters` AND-s `ownerId` and `reviewerId` in SQL (`repository.ts:569-571`).

`CaseFilters` therefore gains `visibleToUserId?: string`, rendered as one clause:

```sql
and (${visibleToUserId}::uuid is null
     or arc.owner_id = ${visibleToUserId}::uuid
     or arc.reviewer_id = ${visibleToUserId}::uuid)
```

This makes the board's rows exactly the rows whose detail screens will accept actions. The
alternative — narrowing Staff to owner-only — hides a Staff reviewer's own review work and was
rejected.

## Data Flow

### Tiles derive from the scoped list, not from `getAnnualReturnDashboardMetrics`

`dashboardMetrics` (`repository.ts:691`) computes in JS over `listCasesForToday({})` — all
cases, unfilterable — and excludes Filed and Completed from every tile except `assignedToMe`.
Against a scoped list it would show "Overdue: 12" above three rows.

The board derives its tiles from the same query that fills its rows, so tiles and rows agree
by construction and there is no second round trip. `overdue` and `high risk` come off the
server-derived `riskLevel`; `payment pending` off `payment.status`; `assigned to me` off
`ownerId`.

Two supporting moves:

- `hongKongBusinessDate` (`repository.ts:209`) is pure — `Intl` only — but stranded in the
  server-only repository module. It moves to `workflow.ts` so the "due in 7" and "due in 30"
  tiles use the same calendar day the server used for `riskLevel`.
- `hasRequiredChecklistEvidence` (`workflow.ts:27`) is private and becomes exported, for the
  "missing documents" tile. The repository's `hasOutstandingRequiredEvidence`
  (`repository.ts:242`) is not usable client-side at all — that module imports the database
  client.

`getAnnualReturnDashboardMetrics` is unchanged and continues to serve the dashboard, where
firm-wide totals are the point.

### Filters move into the URL

All board state is local `useState` (`annual-returns.tsx:42-46`), lost on reload and on every
return from a detail screen. `work-queue.tsx:31-53` is the `validateSearch` precedent; the
board's own header link already supplies `/work-queue` a fully specified search object because
that route requires one.

Search params map onto the server's existing filter schema, which already accepts `risk`,
`missingDocuments` and `overdueOnly`. The repository applies those three in JS after hydration
(`caseMatchesHydratedFilters`, `repository.ts:345`), so the client sends them and reimplements
nothing — which matters, because that function is private and inside the server-only module.

Two controls change shape:

- Search matches company name only. The production case has no `contactName`.
- Owner becomes id-valued with name labels. The server filter takes
  `ownerId: z.string().uuid()`; the demo compares display-name strings.

### Loading, error and empty

The client receives the **verbatim server error**. The server-function handler catches and
returns a serialized error rather than letting `errorMiddleware` (`start.ts:5-18`) render an
error page, and the client rehydrates and rethrows the real `Error`. So `query.error.message`
in the browser is a postgres `ECONNREFUSED <host>:<port>`, or
`DATABASE_URL is required for Annual Return Control Center data access.`

`production-case-detail.tsx:170` renders that raw. `payments.tsx:83-87` deliberately does not,
substituting a fixed string. The board follows payments — it is the screen most likely to be
open when infrastructure breaks. The established degradation precedent is
`dashboard-data.ts:36-61`, which catches and returns `annualReturnDataAvailable: false` with a
fixed message rendered as a banner at `index.tsx:73-79`.

**The board must not copy the payments empty state.** It has a live collision: on error `data`
is `undefined` so the filtered array is empty, and `isLoading` is `false` because the status is
`error`. The alert at `payments.tsx:83-87` and "No production payment evidence is awaiting
review." at `payments.tsx:160-164` render simultaneously — the screen says both "unavailable"
and "nothing to review". The board gates its empty state on `!isError` as well as
`!isLoading`. Fixing `payments.tsx` itself is in scope; it is one condition.

`retry: false` is set on every query, matching `payments.tsx` and `portal.tsx`. It is absent
from `production-case-detail.tsx`, so an authorization failure there retries with default
backoff before surfacing.

The work-item query needs its own banner. `queueFiltersForActor` throws
`Forbidden: staff actor has no assigned team.` for a Manager or Staff user with no team, which
today makes every row read "Unavailable" (`annual-returns.tsx:274-275`, `:286-287`) with no
banner and no retry.

### Cache invalidation

`annualReturnQueryKeys.all` is `["annual-returns"]` and `list(filters)` is
`["annual-returns", "list", filters]`, so invalidating `.all` covers the board by prefix.
`production-case-detail.tsx:98-101` does this, so detail-to-board refresh works.

`payments.tsx:63-71` does not: it invalidates only `documents(caseId)` and `payment(caseId)`,
never `.all` and never its own list key. The board goes stale after any payment review. In
scope; one added invalidation.

### Result size

There is no `LIMIT`. `selectCaseRows` (`repository.ts:545-583`) ends at
`order by arc.filing_due_date asc, c.company_name asc`, and `hydrateCases` then loads every
checklist row and payment row for the whole result set. `dashboardMetrics` already carries
`// TODO: Move dashboard tiles to SQL aggregates and paginated reads as case volume grows.`
(`repository.ts:695`); the board has the same exposure.

`limit` is added to the filter schema with a default of 200 and applied as a SQL `LIMIT` in
`selectCaseRows`, so the cap is on rows fetched rather than rows rendered — hydration then
loads children for at most 200 cases instead of the whole table. When exactly that many rows
come back the board renders "Showing the first 200 cases — narrow the filters." No count query
is needed, and a future incident becomes a visible message instead.

## Testing

468 of 500 tests run with no database; the other 32 are behind
`describe.skipIf(!databaseUrl)`. This plan is verifiable without Postgres except where stated.

### Harness constraints

`@testing-library/jest-dom` is not installed — there is no setup file and no `expect.extend`,
so `toBeInTheDocument`, `toBeDisabled`, `toHaveTextContent`, `toHaveValue` and
`toHaveAttribute` all throw. The in-repo substitutions are `.toBeTruthy()` for presence,
`(el as HTMLButtonElement).disabled` for disabled state, `.textContent` with `toContain` for
text, and `.value` for inputs. `// @vitest-environment jsdom` must be line 1.

The board uses native `<select>`, as `production-case-detail.tsx:245` does. Radix `Select` and
`Dialog` cannot be driven by `fireEvent` here: there are no `ResizeObserver`, `matchMedia` or
`hasPointerCapture` polyfills anywhere in the repository.

### Test files

1. **`caseFiltersForActor`** — pure. Admin unrestricted; Manager forced to team; Staff forced
   to `visibleToUserId`; non-Admin without a team throws. Mirrors the existing
   `queueFiltersForActor` tests.

2. **Tile derivations** — pure, over hand-built `AnnualReturnCase[]`. Written first: a Filed
   case past its due date carries `riskLevel: "red"`, so a naive "overdue = red" tile counts
   completed work as overdue. This test must fail before it passes.

3. **`production-command-center.interaction.test.tsx`** — jsdom, `vi.hoisted()` fakes for
   `listAnnualReturnCases` and `listWorkQueue`, wrapped in `QueryClientProvider`. Covers rows
   from the fake; the empty state; that an error renders the fixed message and **not** the raw
   `ECONNREFUSED`; that error and empty never render together; that a work-queue failure
   surfaces a banner rather than silent "Unavailable"; and the limit notice at exactly 200
   rows.

4. **A router test at `dataMode: "production"`** — the gap that let the `<Outlet />` failure
   through. Renders `/annual-returns/<uuid>` in production mode and asserts the detail screen
   mounts; renders `/annual-returns` in both modes and asserts the correct board. Written
   before the route change, so it fails first.

### Not verifiable here

The `visibleToUserId` SQL clause runs only in the `describe.skipIf(!databaseUrl)` integration
tests, which will not run without a `DATABASE_URL`. The test is written so it runs when one is
present; the clause itself is unverified by the implementing session. Everything above it —
that `caseFiltersForActor` produces the right filter and that the filter reaches the
repository — is covered by the pure test.

Browser verification runs in demo mode only, so it confirms the `<Outlet />` guard and that the
demo board still works. It does not exercise the production board's data.

## Success Criteria

1. In production mode `/annual-returns` lists real cases from `listAnnualReturnCases`, and
   every row links to a case id the detail screen accepts.
2. In production mode `/annual-returns/<uuid>` still renders the production detail screen — the
   `<Outlet />` contract survives, proven by a test at `dataMode: "production"`.
3. A Staff user's board contains only cases they own or review, matching what
   `getAnnualReturnActionPermission` will allow them to act on.
4. Filter state survives a reload and a return from a detail screen.
5. With the database unreachable the board shows one fixed message, never a raw
   `ECONNREFUSED`, and never the empty state at the same time.
6. Demo mode is unchanged: same board, same columns, same fixtures.
7. `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build` all clean.

## Deliberately Not Addressed

- **`/whatsapp`** reads `lib/app-data` fixtures with no `dataMode` branch and remains in
  production navigation. Same defect as this one, unfixed.
- **`documents.tsx`** mixes demo stores and production queries unconditionally with no branch.
  It should not be used as a reference while implementing this.
- **`index.tsx`** links to production case ids in demo mode (`loadDashboardData` has no
  `dataMode` branch), landing on "This annual return case does not exist in the mocked
  workspace." The same is true of `work-queue.tsx`, `documents.tsx` and `ai-assistant-panel.tsx`.
- **No id guard on the detail route.** `annual-returns.$id.tsx` declares no `params` validation,
  and `production-case-detail.tsx` fires its query with no UUID check, so `/annual-returns/ar-delta`
  in production renders a serialized `ZodError` as its error message.
- **`isUuid` is duplicated** with different version nibbles in `portal.tsx:584` (`[1-5]`),
  `production-case-detail.tsx:45` (`[1-8]`) and `documents.tsx`, with no shared export.
- **Checklist templates** and case creation, per ADR 0001.
