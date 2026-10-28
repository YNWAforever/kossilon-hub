# Findings mutation reconciliation — local continuation

Product commit: `4cce50fa66ef892c584cef8fc3a14644abb30bdd`.

Baseline: `885a5e8b8c21b778e8e29527530cc7da67a919e8`, `codex/cosec-20261023`, draft PR #147. Re-read the PR and remaining coverage/blockers. Findings mutation-unknown-result reconciliation was explicitly outside the previous read-recovery slice and remains independently actionable locally. Original acceptance rows and approval records are untouched.

## Bounded repair

A failed “mark resolved” command re-enabled commands against cached findings. A response can be lost after a resolution is saved, or a conflict can reflect another employee's decision. Retrying the write without readback risks recording an uninformed decision.

`CaseFindings` now holds a case-panel-wide block after a resolution error. Summaries, cached findings, previews and further resolution controls stay hidden until explicit readback succeeds. A synchronous guard prevents same-turn duplicate commands across all findings; mutation `retry:false` overrides configured retry defaults. No resolution is automatically replayed. An explicit recovery makes one independent findings read, rejects unavailable/non-array results, cancels old/background query reads before publication, and populates the query cache from the actual response before unlocking. Failed recovery, cache updates and ordinary background success cannot clear uncertainty. Saved resolutions are displayed from readback; a new explicit command uses fresh finding/version IDs.

Independent readback avoids a verified TanStack nuance: even `refetch({throwOnError:true})` can return reverted cached data after query cancellation. A query-function completion counter also does not prove cache publication. Focused review prompted the independent-read approach; the final reviewer reported no further findings within this scope, conditional on the array guard that is included.

This is mounted-panel recovery, not a persistent command receipt protocol. Changing case remounts the panel and resets its local state; returning to a case uses its normal read lifecycle. Actor/session isolation, real revocation and server-side concurrency remain Native gates. Existing server authorization and version checks remain the write boundary. No server/DB/schema change is included.

## Reproduction and verification

- `red.txt`: **5 failed / 8 passed** before repair.
- `cancellation-red.txt`: **1 failed / 14 skipped** against the intermediate refetch-based recovery, reproducing cancelled read acceptance of reverted cached success. Final independent readback is not released by query cancellation/cache updates while its read remains pending.
- `unavailable-red.txt`: **2 failed / 15 skipped** before the direct-result array guard; null/undefined could otherwise clear uncertainty.
- `targeted-final.txt`: **44 passed / 3 files**, with **9 new tests**. Covers saved-outcome readback, failed/pending/deduplicated recovery, all findings blocked, background refresh, fresh explicit payload, retry suppression, same-turn commands, pending older reads, cancellation/manual cache updates, case switching and unavailable readback. Adjacent case-detail and findings-summary regressions pass.
- Tests exercise actual React/TanStack behavior in JSDOM with server boundaries mocked. They prove UI state and read/command payloads, not persisted resolutions, native roles/Auth/HTTP/RLS or full browser journeys.
- See `receipt.json` for final commands, outcomes and committed-file fingerprints. Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,821 passed / 289 files**, exit 0 (`unit-final.txt`). Targeted 44 are included, not added again. Typecheck, changed-file ESLint/Prettier and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Historical build receipts do not bind this source delta. Delivery is limited to this fix, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
