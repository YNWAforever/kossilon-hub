# Delete the orphaned fixture screens

**Date:** 2026-08-01
**Status:** Approved, ready for planning

## Goal

Remove five screens that are out of navigation and backed by `lib/mock-data`, along
with the code that exists only to serve them. Success is measured in what is gone:
fewer routes, fewer fixture readers, and no promise left in the codebase that these
screens are coming back.

This is a deletion pass. It ships no new capability.

## Why now

`lib/mock-data` had sixteen importers. Five are the screens below, and most of the
rest exist only to feed them. The navigation comment in
`src/components/navigation.ts` says these routes stay "reachable by URL — re-add an
entry here once a screen reads real data", which has not happened and is not
planned for any of them.

Each of the five is either superseded by a screen already running on Postgres, or
has no table behind it at all:

| Screen            | Lines | Production backing                         | Already covered by                    |
| ----------------- | ----- | ------------------------------------------ | ------------------------------------- |
| `tasks.tsx`       | 51    | `work_items`                               | `/work-queue` — four views, real data |
| `enquiries.tsx`   | 334   | none — no enquiries table exists           | `/whatsapp`                           |
| `teams.tsx`       | 126   | teams, users, staff_profiles, staff_skills | `/work-queue` team view (partial)     |
| `clients.tsx`     | 134   | `companies`                                | `/annual-returns` board (partial)     |
| `clients.$id.tsx` | 254   | companies, cases, documents, payments      | `/annual-returns/$id` (partial)       |

`tasks.tsx` reads the demo annual-return store and predates `/work-queue`, which
does the same job on `work_items`. `enquiries.tsx` is the largest of the five and
the only one with no schema behind it — the same wall the WhatsApp inbox hit with
`intent` and conversation `status`.

## Scope

This is sub-project 1 of three. The agreed sequence is:

1. Orphaned screens (this spec)
2. Dashboard on real data
3. Automation backbone — wire a trigger for `src/server/maintenance.ts` and fix the
   `evaluateEscalations` recipient bug

The dashboard was sequenced after this pass because it links to `/enquiries` and
`/tasks`; deciding their fate first avoids designing dashboard links to screens
that are about to be deleted.

### Rejected alternatives

- **Clean cut plus digest untangle.** Would also sever `daily-digest.ts` from
  `enquiry-triage.ts` and relocate `formatDate`, leaving `lib/mock-data` demo-only.
  Rejected: deciding what the dashboard's digest is built from is dashboard design
  work, and doing half of it here would pre-empt sub-project 2 without finishing it.
- **Full eradication.** The above plus rebuilding the dashboard on real data so
  `lib/mock-data` could be deleted outright. Rejected: merges two sub-projects back
  into one and recreates the scope problem the decomposition solved.

## Design

### 1. Deletions

**The five screens**

- `src/routes/clients.tsx`
- `src/routes/clients.$id.tsx`
- `src/routes/enquiries.tsx`
- `src/routes/teams.tsx`
- `src/routes/tasks.tsx`

**Exclusively owned by those screens** — verified by grep, no other importer:

- `src/lib/clients-store.ts` — only the three client and enquiry screens
- `src/components/convert-to-client-dialog.tsx` — only `enquiries.tsx`
- `src/components/timeline.tsx` — only `clients.$id.tsx`

**Already unreachable today**, swept up in the same pass:

- `src/lib/risk.ts` — imported by nothing
- `src/components/case-card.tsx` — imported by nothing

**Falls out of section 2 below:**

- `src/lib/enquiry-triage.ts` and `src/lib/enquiry-triage.test.ts`

### 2. Changes to surviving code

`DailyDigestRoute` in `src/lib/daily-digest.ts` names `/enquiries` and `/tasks` as
route variants. TanStack's typed `Link` will not compile against a deleted route, so
these changes are forced rather than optional:

- `src/lib/daily-digest.ts` — remove `/enquiries` and `/tasks` from the
  `DailyDigestRoute` union, delete the two item builders that produce them, and drop
  the `enquiries` and `tasks` inputs to `buildDailyDigest`
- `src/routes/index.tsx` — remove the two `switch` cases that render links to them
- `src/lib/daily-digest.test.ts` — remove the cases covering enquiry and task items

Deleting the enquiry item builder removes the only caller of `triageEnquiry`, which
is why `enquiry-triage.ts` and its test go with it.

**The dashboard's production behaviour does not change.** `src/routes/index.tsx:58`
already calls `buildDailyDigest({ enquiries: [], tasks: [], ... })` with hardcoded
empty arrays — not mode-dependent — so no digest item has ever carried an
`/enquiries` or `/tasks` route in either data mode. The code being deleted cannot
execute. No link repointing is required, because there are no links to repoint.

**Housekeeping**

- `src/components/navigation.ts` — the comment block names the four screens as
  deliberately absent pending real data. Replace it with a note that they were
  deleted, and why.
- `src/routeTree.gen.ts` — regenerated by the router plugin.

### 3. Deliberately kept

- `src/lib/client-portal-store.ts` — a different module from `clients-store.ts`
  despite the near-identical name. Production `/portal` depends on it.
- `src/lib/mock-data.ts` — reduced to two callers: `src/routes/index.tsx`
  (`formatDate`) and `src/routes/settings.tsx` (`cases`, `formatDate`). The settings
  usage is demo-only; `settingsSectionsForMode` gates the checklist-template section
  behind `dataMode === "demo"`, so no fixture-derived figure reaches a production
  screen there.
- `src/lib/daily-digest.ts` itself — the dashboard still uses it for annual-return
  items, which read live data.

### 4. Consequence to accept

These are demo-mode screens. Deleting them removes them from the demo as well as
from production: a walkthrough loses the clients list, enquiry pipeline, team roster
and task list. This was raised and accepted. Demo mode retains the dashboard, work
queue, annual returns, documents, portal, payments, WhatsApp inbox and automation,
admin and settings.

## Verification

- `npm run typecheck` — the primary safety net. Dangling imports and typed
  `Link to="/deleted"` both surface as compile errors.
- `npx vitest run` — the total is expected to **fall**, not hold, because
  `enquiry-triage.test.ts` is deleted and `daily-digest.test.ts` loses cases. Diff
  the list of test files and test names rather than comparing counts, so an
  unrelated disappearance cannot hide inside an expected decrease.
- `npm run lint`, `npm run build`
- `src/components/page-header.convention.test.ts` asserts `routeSources.length > 10`.
  Route files go from 18 to 13, so it holds. Named here because it is the one
  existing test that could have blocked this pass.
- Browser check in **demo mode**, since that is where the visible change lands:
  the sidebar has no dead entries and the dashboard still renders its digest.

### New test

Add a structural test pinning the remaining `lib/mock-data` importers to a known
set, in the style of `src/routes/-production-authorization.test.ts`, which already
polices imports by reading file contents. After this pass the set is
`src/routes/index.tsx` and `src/routes/settings.tsx`. The test documents why each
survivor is there and makes the finish line enforceable: the list may shrink, never
grow.

## Risks and limitations

- **Production rendering stays unverified.** The dev server runs in demo mode, so
  the production dashboard path is not exercised. The claim that production is
  unaffected rests on reading `index.tsx:58`, not on observing it. Same limitation
  as the previous two phases.
- **Deletion forecloses a documented intention.** The comment in `daily-digest.ts`
  invites restoring the enquiry and task inputs "once both read live data". This
  pass removes that path. Restoring enquiry items later would mean designing an
  enquiries table, which does not exist — that is a larger decision than reinstating
  a function, and deleting the dead code does not make it meaningfully harder.
- **Near-identical module names.** `clients-store.ts` is deleted;
  `client-portal-store.ts` is production code and must survive. Any bulk operation
  matching `client*store` will hit both.
