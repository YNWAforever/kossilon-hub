# Dashboard: fix demo mode and stop fabricating zeros

**Date:** 2026-08-01
**Status:** Approved, ready for planning

## Goal

Give `/` a working demo path, and stop it reporting invented figures when a load
fails. Success is that the demo landing page shows the demo's story instead of an
error state, and that a failed production load never renders a number.

## The premise was wrong

This was queued as "put the dashboard on real data". It is already on real data.
`loadDashboardData()` calls `getAnnualReturnDashboardMetrics` and
`listAnnualReturnCases` — production server functions — for every KPI tile, the
upcoming list, and the digest input. Its only `lib/mock-data` import is
`formatDate`, a pure date helper.

The real defect is the inverse of the one fixed on `/annual-returns` and
`/whatsapp`. There, fixtures leaked into production. Here, a production query
breaks the demo.

`src/features/dashboard/dashboard-data.ts` has no `dataMode` branch. In demo mode it
calls the production server functions anyway, they fail, and a bare `catch {}`
degrades everything to zeros plus "Annual return data is temporarily unavailable."
The demo's landing page is an error state.

Three distinct problems:

1. **Demo mode is broken.** No branch, so the first screen a prospect sees is a
   yellow banner over empty tiles.
2. **Failed loads render fabricated zeros.** `fallbackAnnualReturnMetrics` is all
   zeros and the tiles render them unconditionally, so a failure reads as "0 overdue
   cases" in the same typography as a real figure. `annualReturnDataAvailable: false`
   already exists as a signal; the tiles ignore it and only the banner uses it.
3. **`catch {}` discards the error object.** An authorization failure, a network
   blip and a genuine outage all render as one message, and nothing is logged.

## Approach

Chosen: **swap the injected dependencies**.

`loadDashboardData` already accepts `DashboardDataDependencies`
(`{ getAnnualReturnDashboardMetrics, listAnnualReturnCases }`) and defaults to the
production server functions. A demo implementation satisfies the same interface, and
the route loader chooses between them. `loadDashboardData` itself does not change.

The DI seam already exists and was evidently built for this. One render path means
demo and production cannot drift visually. The demo implementation is pure, so it
tests without a database.

### Rejected alternatives

- **Fork the component** into `DemoDashboard` / `ProductionDashboard`, matching
  `/annual-returns` and `/whatsapp`. Rejected: those forked because production
  genuinely could not represent demo fields. Here the tile set is identical and only
  the data source differs, so a fork would duplicate the whole render tree and let
  the two modes drift.
- **A `dataMode` parameter inside `loadDashboardData`.** Rejected: introduces a mode
  conditional into a module that has none, and every later reader has to work out
  which branch they are in.

## Design

### 1. A narrow view model

`DashboardData.upcomingAnnualReturns` is currently typed as the full production
`AnnualReturnCase` — 15+ fields — while the dashboard renders five (`id`,
`companyName`, `currentStatus`, `filingDueDate`, `ownerName`) and `daily-digest`
reads five more (`riskLevel`, `checklist`, `payment`, `filingReference`,
`confirmationDocumentId`).

Introduce `DashboardCase` in the dashboard feature, carrying exactly that set.
Production maps its `AnnualReturnCase` into it; demo maps the demo store's case into
it.

This is what makes the chosen approach possible at all. The two case types are
irreconcilable as they stand: production statuses are `"Upcoming"`,
`"Client reminder sent"`, `"Documents pending"`, …, while the demo store uses
`"preparing"`, `"waiting-documents"`, `"payment-pending"`, …. Neither type can
satisfy the other, but both can produce a shared view model.

It also tightens a loose boundary: the dashboard currently depends on the entire
production case type to render a handful of fields.

### 2. The demo dependency

New module `src/features/dashboard/demo-dashboard-data.ts` exporting an object
satisfying `DashboardDataDependencies`, deriving metrics and cases from the demo
annual-return store. The store exposes non-hook getters, so a route loader can read
it.

Demo statuses are translated into the production vocabulary through a table defined
in this module and covered by tests.

Fabricating values here is legitimate — that is what demo mode is. The rule this
codebase enforces is no fabrication in **production**, which is why the same
translation would be unacceptable on a production path.

### 3. The loader

`src/routes/index.tsx` picks the dependency set from route context:

```
loader: ({ context }) =>
  loadDashboardData(context.dataMode === "demo" ? demoDashboardDependencies : undefined)
```

`loadDashboardData` is otherwise untouched.

### 4. Unavailable is not zero

When `annualReturnDataAvailable` is false, the KPI tiles render an explicit
unavailable state rather than a numeral. The existing banner stays.

This is the same defect class as fixtures in production, expressed numerically: a
figure a user can act on, presented as fact, that is not a measurement of anything.

### 5. Error handling

Keep the degradation — a failed dashboard should still render — but stop discarding
the cause:

- Carry the real error message through to `annualReturnDataError` instead of a fixed
  string.
- Distinguish a `Forbidden:` / `Unauthorized:` prefix, which means re-authenticate,
  from a genuine outage, which means try again later. The repository already uses
  those prefixes by convention.

### 6. Cleanup

`formatDate` moves from `src/lib/mock-data.ts` into a shared util module. After this
and the orphaned-screens pass, `src/routes/settings.tsx` is the last `lib/mock-data`
importer, and its usage is demo-only.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build`
- Unit tests, no database required:
  - metric derivation in the demo dependency
  - the demo-to-production status translation table
  - `loadDashboardData` returning the demo set when given demo dependencies
- A test asserting the KPI tiles render **no numeral** when
  `annualReturnDataAvailable` is false. This is the guard that would have caught the
  present defect, and it should fail if the tiles go back to reading metrics
  unconditionally.
- A test that a `Forbidden:` error produces a different message than a generic
  failure.
- Browser check in **demo mode**, where the visible change lands: the dashboard
  shows demo figures, no yellow banner, and the digest renders.

## Risks and limitations

- **Production rendering stays unverified.** The dev server runs in demo mode, so
  the production dashboard path is exercised only by tests. Unchanged from the
  previous phases.
- **The status translation is a judgement call.** Mapping six demo statuses onto the
  production vocabulary has no single correct answer; the table encodes one reading
  and the tests pin it so a later change is deliberate rather than accidental.
- **Sequencing with the orphaned-screens pass.** That spec removes `/enquiries` and
  `/tasks` from `DailyDigestRoute`, touching `daily-digest.ts` and `index.tsx` — the
  same files this spec edits. Landing the deletion first avoids a conflict; if this
  lands first, the deletion plan must be rebased onto the new `DashboardCase` type.
