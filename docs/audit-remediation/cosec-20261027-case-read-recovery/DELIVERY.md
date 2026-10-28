# Case/readiness read recovery — local continuation

Product commit: `6401add04e92b7e3107b4556060f426b6da1020d`.

Baseline: `59aeb86fc402988faa2a2fc702b02b9013f26942`, draft PR #147, `codex/cosec-20261023`. Re-read PR and remaining coverage/blockers. The completed payment, preview, findings and party recoveries are unchanged. This slice addresses opening the case itself from a staff work list.

## Bounded repair

When the case-detail read failed, staff could only return to the work list. There was no in-page way to recover the exact case and its current checklist/readiness context. The error view now offers a case-query retry with an accessible label, disabled during fetching. `cancelRefetch:false` deduplicates pending retries. The existing query retry policy and return-to-list link are unchanged.

The retry calls only the existing case query; it does not invalidate or replay commands, and does not refetch successful notes/history reads. A successful read restores the current case/readiness. Repeated denial stays closed, a missing result remains not-found, and a newly locked case stays unable to write. An explicit later status action uses the fresh source version from the case cache.

This is ordinary case-read recovery, not case-command uncertain-result reconciliation or a change to general background-refresh mutation policy. It does not establish real navigation, persisted writes, actor/session isolation or readiness acceptance.

## Evidence

- `red.txt`: **5 failed / 9 passed** before repair.
- `targeted.txt`: **45 passed / 3 files**, including **5 new case-read recovery tests**, existing case-detail commands, findings and party interactions. Covers exact-case ID, return-link context, fresh readiness/source version, no command replay, unchanged successful notes/history read counts, pending/deduplicated recovery, repeated denial, missing result and newly locked result.
- Focused independent review reported no findings; reviewer ran no tests.
- Tests exercise actual React/TanStack interactions in JSDOM with server boundaries mocked. They verify UI state and request payloads, not real Auth/HTTP/RLS, saved changes or the full Today → case → action → return journey.
- `receipt.json` records final commands, outcomes and committed-file fingerprints. Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,840 passed / 290 files**, exit 0 (`unit.txt`). Targeted 45 are included, not added again. Typecheck, changed-file ESLint/Prettier and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Original acceptance rows and approval records remain untouched. Historical build receipts do not bind this source delta. Delivery is limited to this fix, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
