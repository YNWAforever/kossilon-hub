# Document review-write reconciliation — local continuation

Product commit: `52b76e30ec6fdf8c9230aa2cfb59b726231d036d`.

Baseline: `bab4dbec483a432cf268a736b4dee33d0a29e847`, draft PR #147, `codex/cosec-20261023`. Re-read live PR; the preceding archive-read recovery explicitly left review-write uncertainty open. Existing upload, preview, payment and case workflow code is unchanged. Original acceptance rows and approval records are untouched.

## Bounded repair

A failed accept/reject request previously only set a warning, leaving cached review controls usable despite a possible saved decision or lost response. Reviews now explicitly disable automatic mutation retries and use a synchronous route-wide submission guard. Pending renders disable visible review controls; an error latches the archive closed, including row preview/review/controlled-upload and new bulk selection controls. Ordinary list refresh or filter changes cannot clear that latch, and the existing archive-read retry remains separate.

Explicit reconciliation independently reads the currently selected archive, following fresh cursor chains through the number of previously loaded pages (or stopping at a new terminal page). Results are staged and validated, including non-array/unavailable pages, malformed cursors and final-page cursor cycles. All required pages must succeed before any are published. Older/background archive queries are cancelled; other archive caches are invalidated, the fresh pages/pageParams are published together, and affected-case invalidation is requested before new explicit review commands can resume. No review write, upload command or byte download is replayed.

Filter changes during readback prevent publication/unlocking; the new range requires its own explicit reconciliation. Actor-identity lifetimes remount the route, and active/scope guards discard late recovery results. This is mounted-route recovery, not durable command idempotency or exact outcome/receipt confirmation. Absence from a filtered list is not proof of a particular accept/reject result. Future visits to other archive filters must read invalidated caches afresh. Server authorization/version checks remain the write boundary.

## Evidence

- `red.txt`: **10 failed / 6 passed** before repair.
- Focused review found a final-page self-cycle could escape the initial cursor check. `cycle-red.txt`: **1 failed / 16 skipped** before checking each returned cursor before staging. Reviewer confirmed no remaining findings after correction; reviewer ran no tests.
- The first broad run (`unit.txt`) was deliberately interrupted (143) for that source correction. It is not a completed suite result or acceptance run.
- `targeted-final.txt`: **35 passed / 2 files**, including **11 new cases**. Covers accept/reject saved-state readback without replay, all documents blocked after error, pending/deduplicated recovery, background success, new explicit fresh-version review, same-turn cross-document submissions/configured retry suppression, all loaded pages, partial readback failure, cancellation/manual cache changes, invalid page data, filter changes/late results, and final-page cycles. Existing archive retry and SSR regressions also pass.
- Tests exercise actual React/TanStack behavior in JSDOM and seeded SSR with mocked server boundaries. They verify UI state, payloads and cache handling, not persisted decisions, real Auth/HTTP/RLS, actual upload protocols or full journeys.
- `receipt.json` records final commands, outcomes and file fingerprints. Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,870 passed / 290 files**, exit 0 (`unit-final.txt`). Targeted 35 are included, not added again. Typecheck, changed-file ESLint/Prettier and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

Upload retry/receipt protocols, inline preview-request lifetimes, independent case-picker/context recovery and persistent command receipts remain outside this slice. No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Historical build receipts do not bind this source delta. Delivery is limited to this fix, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
