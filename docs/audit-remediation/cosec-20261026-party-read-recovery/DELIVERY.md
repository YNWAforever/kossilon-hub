# Related-persons list recovery — local continuation

Product commit: `f1622ae033c0c97d459c29d9e1e14ff9b03394ab`.

Baseline: `be47049bab5cee55c55cdb3cd56681ac0abb43e0`, draft PR #147, `codex/cosec-20261023`. Re-read live PR and remaining coverage/blockers. The related-persons list is a distinct local gap; the previous payment, preview and findings fixes are unchanged. Original acceptance rows and approval records are untouched.

## Bounded repair

A failed initial related-persons list rendered “0/0 confirmed” and a claim that the officer register had nobody eligible. Pending or denied refreshes could retain cached names, completeness warnings and confirmation controls. This can mislead staff about the person-level filing requirements, and there was no in-panel reload.

The panel now shows counts, names, completeness warnings and confirmation controls only for a successful, idle list. Loading is explicit for initial reads and refreshes. Failure hides stale data and offers a list reload, disabled while fetching, with `cancelRefetch:false` to deduplicate pending requests. A confirmed empty result restores the empty state; a successful nonempty result restores current candidates. Locked cases remain unable to confirm candidates.

Recovery calls only the existing list endpoint and never replays the separate confirmation command. The list endpoint already synchronizes officer candidates before returning them; this is **not** a claim of a side-effect-free server read. No server/DB/schema behavior is changed. This slice does not address confirmation mutation-unknown-result reconciliation, persistent command receipts, actor/session lifetime or native role/RLS acceptance.

## Verification

- `red.txt`: **5 failed / 5 tests** before repair.
- `targeted.txt`: **31 passed / 3 files**, including **5 new related-persons cases** and existing case-detail/findings interactions. Covers failed initial read, pending/deduplicated recovery, denied cached refresh and repeated failure, fresh candidate identity for a later explicit confirmation, successful empty recovery and locked-case behavior.
- Completed the case-detail test fixture's missing party-list API with an empty successful response; this is test-only and avoids accidental missing-mock errors obscuring other command assertions.
- Focused independent review reported no findings; reviewer ran no tests.
- Actual React/TanStack interactions run in JSDOM with server boundaries mocked. They prove displayed state and list/confirmation payloads, not persisted candidate synchronization, person-level requirement creation, real Auth/HTTP/RLS or the full employee journey. See `receipt.json` for final commands, outcomes and file fingerprints.

Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,826 passed / 290 files**, exit 0 (`unit.txt`). Targeted 31 are included, not added again. Typecheck, ESLint/Prettier for all three changed source/test files and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Historical build receipts do not bind this source delta. Delivery is limited to this repair, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
