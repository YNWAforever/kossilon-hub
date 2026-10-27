# Current document preview lifetime — local continuation

Product commit: `7e34f7e1c8d169b0b832b62c02267854fd399cd5`.

Baseline: draft PR #147, `codex/cosec-20261023`, `ad53351606d63ed166eb39f4d302e5399dbba12a`. Re-read live PR description and remaining `COVERAGE.md` / `blockers.md` before selecting this slice. The historical coverage review did not identify an independent local gap; this pass found a new source-level preview defect. Original acceptance rows and approval records remain untouched.

## Problem and bounded change

`SafeDocumentPreview` is shared by case findings, client work overview and payment review. Its local source URL was not bound to document identity/version/safety. Changing props could display old bytes under the current document context, and a late response after unmount could allocate an unused object URL. A failed explicit retry also left the previous preview visible.

The exported component now keys an inner preview lifetime by document ID, current version and every supplied safety input. Changing that evidence removes the old preview and revokes its URL. A lifetime guard after asynchronous blob reading discards late results. Explicit retry clears previous bytes first, and a synchronous pending guard prevents same-turn duplicate downloads. A fresh context can immediately start its own version-bound, authorized read. No document/payment write is introduced or replayed. Existing server authorization, scan and MIME checks remain required.

The component does not independently detect actor/session changes; it relies on the existing parent/auth lifetime and server authorization. This fix does not establish native session revocation, persisted approval correctness or whole-journey acceptance.

## Reproduction and verification

- `red.txt`: all **6 initial regression cases failed** before the repair, covering document/version/safety changes, late results, unmount and failed retry.
- `targeted.txt`: first repaired run was **3 failed / 47 passed**. The three failures came from a test fixture returning the same consumed `Response` body for successive downloads. Corrected the fixture to return a fresh response per request. The first broad unit attempt (`unit.txt`) observed the same three fixture failures and was interrupted (143); it is not a completed suite result.
- `targeted-final.txt`: **52 passed / 3 files**, including **8 new preview tests** plus the 44 existing payment interactions. Added explicit deferred-blob and same-turn duplicate-click coverage. Server download boundaries are mocked; actual React component state, URLs and request payloads are checked in JSDOM.
- Focused independent review found no blocking issues. Reviewer ran no tests. See `receipt.json` for final commands, outcomes and committed-file fingerprints.

Final local unit/component suite: **2,807 passed / 289 files**, exit 0 (`unit-final.txt`). The targeted 52 are included, not added again. Typecheck, changed-file ESLint, Prettier and diff checks: exit 0.

Log text preserves command output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still outstanding: same-candidate deployed artifact binding, required CI/security acceptance, actual DB catalog/ledger and application-role access; real Auth/roles, cross-team/session/account-switch/RLS/HTTP concurrency; complete Today → correct case → documents/payment → safe action → independent readback → return/reload; real storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or approved manual handoff.

No DB integration, build, hosted CI acceptance, deployment, production mutation, Vercel/Neon change or Native execution is claimed. Historical build evidence does not bind this new source. Keep PR draft; no merge or ready-for-review transition. This pass is limited to the shared preview lifecycle, tests, local evidence, focused commits, push to the existing branch and PR-description update.
