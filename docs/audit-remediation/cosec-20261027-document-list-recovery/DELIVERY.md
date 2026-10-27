# Staff document archive read recovery — local continuation

Product commit: `4b40cc34e509d762f2e3b2a02f0c053782c0d9b9`.

Baseline: `d9f2fe46ff7289cc06c7dbf4b7f6974ad2871b89`, draft PR #147, `codex/cosec-20261023`. Re-read live PR and remaining coverage/blockers. Existing payment, preview, findings, party, case and note recovery slices are unchanged. Original acceptance rows and approval records are untouched.

## Bounded repair

The staff document archive showed a list error without recovery and could retain cached preview, accept/reject and controlled-upload controls after a denied refresh. Staff could keep acting on an unverified archive context.

The archive now hides cached rows during a full refresh or any list error, offers a list-only retry, disables duplicate pending retries and prevents pagination from bypassing read recovery. After a next-page error, the whole loaded archive must be refreshed before review resumes; the prior “retained data” copy was updated accordingly. A pending next-page request can still retain already-read rows until success/failure. A successful empty response restores the empty state, and fresh unsafe proofs remain unable to review. Recovery never invokes review, download, recovery-preview, upload-intent or finalize commands. A later explicit rejection uses the freshly read document version and reason.

New bulk selection/submission controls are disabled while the archive is unverified using an optional `selectionDisabled` fieldset around selection controls only. The toolbar session, selection and existing job progress/cancellation area remain mounted; archive errors do not discard a running job's UI context. Other toolbar callers retain their default behavior.

This is archive-read recovery only. Review-write uncertain-result reconciliation, upload retry/receipt protocols, preview-request lifetimes, case-picker/case-context reads and Native authorization remain separate. Per-row rejection forms are remounted after full archive refresh; no draft-retention claim is made for those forms.

## Evidence

- `red.txt`: **4 failed / 1 passed** before repair.
- `targeted.txt`: first repaired run **4 failed / 19 passed**. Three SSR fixtures seeded stale snapshots while expecting an idle view; they now explicitly use infinite stale time for the seeded archive snapshot. One rejection assertion ignored TanStack's additional mutation context argument; it now checks the actual payload argument. These fixture corrections do not weaken live pending/failed-read closure. A later manager test initially matched both filename label and row; its assertion was scoped to the rendered row text.
- `targeted-final.txt`: **24 passed / 2 files**, with **5 new cases**. Covers failed initial read, pending/deduplicated recovery, no command replay, explicit fresh-version rejection, denied cached refresh/repeated denial, unsafe fresh result, successful empty recovery, pagination failure/full read recovery and real manager toolbar selection/disabled behavior.
- Focused independent review reported no findings; reviewer ran no tests.
- Tests exercise actual React/TanStack UI behavior in JSDOM and seeded SSR with mocked server boundaries. They prove read/review payloads and UI state, not persisted reviews/uploads, real Auth/HTTP/RLS, native bulk jobs or full staff journeys.
- `receipt.json` records final commands, outcomes and file fingerprints. Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,859 passed / 290 files**, exit 0 (`unit.txt`). Targeted 24 are included, not added again. Typecheck, ESLint/Prettier for all four changed files and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Historical build receipts do not bind this source delta. Delivery is limited to this fix, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
