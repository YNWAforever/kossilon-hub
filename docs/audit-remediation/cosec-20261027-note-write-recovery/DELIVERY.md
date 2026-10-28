# Note-write uncertain-result recovery — local continuation

Product commit: `e78e3cc7845fb558873ee134300f318fd626f073`.

Baseline: `162a0fa2e3297813162a719291dbbed516416554`, draft PR #147, `codex/cosec-20261023`. Re-read live PR and remaining coverage/blockers. Note-write uncertainty was explicitly outside the previous notes/history read-recovery slice. Original acceptance rows and approval records remain untouched.

## Bounded repair

The existing note-create command preserved its draft on failure but immediately allowed another write, despite a possible saved note and lost response. It also cleared newer text typed while a successful earlier submission was pending.

A synchronous raw-draft submission guard now blocks duplicate clicks. Note mutations explicitly disable automatic retries. After an error, further note writes stay disabled, the editable draft is retained, and cached notes/ordinary list retry are replaced by an explicit reconciliation control. Recovery independently reads notes, rejects unavailable/non-array results, cancels older/background query reads before cache publication, refreshes related audit history and unlocks only after readback succeeds. It never invokes the note-write command. Failed readback, query cancellation, manual cache updates and ordinary background success cannot unlock the pending recovery.

Recovery retains the draft even when matching saved text is present. The UI asks staff to compare it with the list before another explicit create; matching text is not treated as a command receipt. A known successful create clears only the exact raw draft submitted, preserving newer edits. Case/actor-scope changes remount the detail lifetime so note uncertainty/drafts and late local recovery state do not carry to another case. Existing ordinary notes/history retries still preserve drafts and remain independent.

This is mounted-lifetime recovery, not durable command idempotency or a persistent receipt protocol. Navigating away resets local state. Actor cache/session isolation and real request outcomes remain Native gates. Only the existing create-note path is changed; no update-note API, DB/schema or server command change is introduced.

## Evidence

- `red.txt`: **10 failed / 18 passed** before repair: **9 new cases** plus the tightened existing failed-note assertion (previously expected immediate re-enablement).
- `targeted.txt`: **59 passed / 3 files**, covering saved-note readback without replay/false success toast, retained and edited drafts, failed/pending/deduplicated recovery, ordinary background success, fresh explicit body payload, same-turn duplicates/configured retry suppression, older pending reads, cancellation/cache updates, unavailable readback, a newer draft during known success, and case changes with late readback.
- Focused independent review reported no findings; reviewer ran no tests.
- Tests use actual React/TanStack behavior in JSDOM with server boundaries mocked. Audit-history refresh request counts prove the requested read, not a persisted audit record. No saved notes, exact command receipt matching, real Auth/HTTP/RLS or complete employee journey is proved.
- `receipt.json` records final commands, outcomes and file fingerprints. Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,854 passed / 290 files**, exit 0 (`unit.txt`). Targeted 59 are included, not added again. Typecheck, changed-file ESLint/Prettier and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Historical build receipts do not bind this source delta. Delivery is limited to this fix, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
