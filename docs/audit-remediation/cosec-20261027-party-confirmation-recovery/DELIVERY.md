# Party confirmation reconciliation — local continuation

Product commit: `6681bffc3beb6a530dbd3d33290589433568dc2a`.

Baseline: `b3b41448403aae1b00e6d7c454fd5dde0d3b0f24`, draft PR #147, `codex/cosec-20261023`. Re-read the live PR and remaining coverage/blockers. Confirmation-unknown-result reconciliation was explicitly outside the previous party-list recovery slice. Original acceptance rows and approval records remain untouched.

## Bounded repair

After a failed confirmation, the panel re-enabled cached candidate controls. A response can be lost after the confirmation and its person-level requirements are committed. Replaying a confirmation or confirming another stale candidate without readback is unsafe.

The case panel now holds further confirmations after an error, hiding cached counts, completeness warnings and candidate controls until explicit fresh readback succeeds. Synchronous submission/recovery guards prevent same-turn duplicates; mutation `retry:false` overrides configured retry defaults. Recovery cancels old list queries, independently reads the existing list API, rejects unavailable/non-array results, cancels pending background queries before publishing that response, and refreshes dependent findings. It never calls the confirmation API. A saved confirmation is displayed from readback; any new command requires an explicit click and uses the fresh candidate ID.

Query cancellation, manual cache changes and ordinary background success cannot substitute for the independent recovery read. A failed read leaves all confirmations blocked. Existing locked-case restrictions remain. The list endpoint already synchronizes officer candidates before listing; recovery is not described as a side-effect-free server read. Server/DB/schema semantics are unchanged.

This is mounted-panel recovery, not a persistent command receipt protocol. Changing case remounts the panel and resets local state; returning to a case uses its ordinary read lifecycle. Real actor/session/RLS behavior, persisted confirmation and requirement creation remain unverified here.

## Evidence

- `red.txt`: **9 failed / 5 passed** before repair.
- `targeted-final.txt`: **40 passed / 3 files**, including **9 new cases** plus existing party-list, case-detail and findings interactions. Covers saved-outcome readback and dependent findings invalidation, failed/pending/deduplicated recovery, all candidates blocked, ordinary background success, fresh explicit payload, configured-retry suppression, same-turn clicks, older pending reads, cancellation/manual cache changes, unavailable readback and case switching.
- Focused independent review reported no findings; reviewer ran no tests.
- Tests run actual React/TanStack behavior in JSDOM with server boundaries mocked. The findings cache is marked invalidated after recovery; this proves the refresh request, not saved person-level requirements or native readback.
- `receipt.json` records final commands, outcomes and committed-file fingerprints. Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,835 passed / 290 files**, exit 0 (`unit.txt`). Targeted 40 are included, not added again. Typecheck, changed-file ESLint/Prettier and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Historical build receipts do not bind this source delta. Delivery is limited to this fix, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
