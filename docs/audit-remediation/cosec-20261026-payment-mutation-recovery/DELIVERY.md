# Payment mutation reconciliation — local continuation

Product commit: `ea48f89b020414aaa10384cb3ea44f2c3538fb3e`.

Baseline: draft PR #147, `codex/cosec-20261023`, `22984cd9c672c6400505ecdb14e876dc24dac1f1`. Read the live PR description, remaining `COVERAGE.md` and `blockers.md` before selecting this bounded local fix. Existing acceptance rows and approval records are untouched.

## Problem and change

A failed payment record/approve/return showed a reload message but re-enabled cached commands. A lost response can follow a committed write; a conflict can mean another employee changed the case. Neither outcome permits assuming that the write failed or replaying it automatically.

The payment page now hides further mutation controls for all proofs of the affected actor/case until staff explicitly reconcile. The accessible, filename-specific recovery control reads the case and refreshes payment-document pages. Both must succeed and the case ID must match. A failed, denied, missing or mismatched read stays closed. A new form displays current saved state; any new action is explicit and uses the refreshed case/proof versions. Unsaved inputs are discarded when a mutation fails.

The case latch survives source-version form remounts and removal of the failed proof. Fresh recovery reads supersede pending pagination rather than joining it. A page-wide synchronous guard serializes recovery across rows sharing the document query. Recovery never calls payment mutations. Existing server authorization, optimistic concurrency and safety checks remain the write boundary; this is an in-page recovery improvement, not a durable command receipt protocol.

## Reproduction and review

- `red.txt`: four new cases failed / 25 passed before implementation.
- Focused review identified two edges: a second proof for the same case remained writable; pending pagination could be mistaken for a fresh proof read.
- `review-red.txt`: both added cases failed / 32 passed before those repairs.
- `concurrency-red.txt`: one case failed / 34 skipped before sharing the recovery guard across rows. Independent reviewer confirmed no remaining findings after the final repair; reviewer did not run tests.
- `targeted-final.txt`: **44 passed / 2 files**, including **10 new cases** over the previous continuation's 34. Covers record/approve/return response failures, saved outcome readback, blocked/pending/failed recovery, new explicit command payload, unavailable case results, multiple proofs, proof removal, pagination and simultaneous recovery clicks.

## Local verification

Log text preserves command output with trailing blank lines normalized. See `receipt.json` for commands, final file fingerprints and actual outcomes. Targeted component tests run the real React/TanStack components in JSDOM with server boundaries mocked. They prove UI state and command/read payloads; they do not prove persisted DB outcomes, native identity, HTTP or RLS.

Final full local unit/component suite: **2,799 passed / 288 files**, exit 0 (`unit-final.txt`). Targeted 44 are included, not added again.

Typecheck, changed-file ESLint, Prettier and `git diff --check`: exit 0. Existing Vite path-resolution and route-export/code-splitting warnings remain.

`unit.txt` preserves the interrupted initial sandbox suite: CLI subprocess failures were observed in validate-neon-auth-demo (2), audit-performance-report (1), audit-performance-samples (1), validate-firm-runtime (4), and dependency-security-f25 (2). It was terminated (143), not a completed suite result. `unit-supported.txt` preserves the first child-process-supported unit run, also deliberately stopped (143) when review required source changes. Neither is a final acceptance run. The final verification uses the revised source with child-process support and excludes DB integration.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. No acceptance row was promoted. Still required: same-candidate deployed artifact binding, required CI/security acceptance, actual DB catalog/ledger compatibility and application-role access; real Auth/roles, cross-team/session/account-switch/RLS/HTTP concurrency; full Today → case → documents/payment → action → independent readback → return/reload; real storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or approved manual handoff.

No DB integration, build, hosted CI acceptance, deployment, production mutation, Vercel/Neon change or Native execution is claimed. Historical build receipts do not bind this new product source. PR must remain draft; no merge or ready-for-review transition. Authorization covers this bounded in-repo fix, local verification, focused commits, push to the existing branch and PR-description update only.
