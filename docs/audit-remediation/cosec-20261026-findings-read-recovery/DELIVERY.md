# Case findings read recovery — local continuation

Product commit: `e5ebb5dfb14fc578b2ab38efc792260de2e9a281`.

Baseline: `2f2de8659e2b8512ed95c707ba157b98bc877e23`, `codex/cosec-20261023`, draft PR #147. Re-read PR description and remaining coverage/blockers before selecting this newly reproduced local gap. The historical coverage review did not identify a local core defect; this pass does not relabel its Native gates or original acceptance rows.

## Bounded repair

A failed initial findings read rendered zero-count badges and “no documents received” alongside the error. A pending or denied background refresh could leave cached findings, previews and “mark resolved” commands visible. There was no in-panel recovery.

`CaseFindings` now hides summary counts and cached findings/previews/resolution controls while fetching or after read failure. Loading remains explicit; a failed read offers an accessible, read-only retry, disabled while fetching. `cancelRefetch:false` deduplicates concurrent retries. Only a successful read can show the empty-document state or restore current findings. Recovery never calls resolution or download APIs. A later explicit resolution uses the fresh finding ID and document version.

This scope is the findings read lifecycle only. It does not implement mutation-unknown-result reconciliation for findings, change server authorization, or establish actor/session/RLS acceptance. Other staff panels require their own evidence; no blanket workflow readiness claim is made.

## Evidence

- `red.txt`: **5 failed / 3 passed** before repair; failures reproduce false empty/zero summaries, absent retry and exposed stale controls.
- `targeted.txt`: **34 passed / 3 files**, including the five new cases. Covers initial failure, pending/deduplicated recovery, denied cached refresh, repeated denial, fresh-version explicit action and successful empty recovery; adjacent findings-summary and preview tests also pass.
- `targeted-final.txt`: **43 passed / 4 files**, adding the case-detail regression suite. The first broad attempt observed one failure in “retains note text and renders the error after a failed command” and was deliberately stopped (143). That fixture omitted the findings-read API, so the new accessible findings error was mistaken for the note error. Added a successful empty findings response to the case-detail fixture; no production change was needed. The final rerun uses the completed fixture. `unit.txt` preserves the interrupted attempt, not a completed suite result.
- Focused independent review reported no findings; reviewer ran no tests.
- `receipt.json` records final commands, results and final product/test fingerprints. Tests use actual React/TanStack behavior in JSDOM with mocked server boundaries; they do not prove persisted writes, real Auth/HTTP/RLS or browser acceptance.

Final full local unit/component suite: **2,812 passed / 289 files**, exit 0 (`unit-final.txt`). Targeted 43 are included, not added again. Typecheck, changed-file ESLint/Prettier and final delta diff checks: exit 0.

Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

## Remaining blockers and scope

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy, promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Original acceptance rows and approval records are untouched. Historical build receipts do not bind this new product delta. Authorized delivery is only this bounded repair, tests/evidence, focused commits and push to the same draft branch.
