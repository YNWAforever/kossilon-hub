# Kossilon audit remediation — 2026-10-01

## Baseline and authority

- Audit/main/Web SHA: `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`; fetched latest main, no source delta. PR #68 is merged; retain its no-chase/current-state/unknown-dispatch guards.
- Worktree: `audit-t03-readiness-worktree`, branch `codex/audit-20261001-baseline-origin`; initially clean. Primary `kossilon-hub-work` remains clean at `76ad310` on `codex/outbox-safety`. Existing worktrees and published history preserved.
- Local implementation, isolated DB tests, commits and draft PRs are authorised. New production SQL/deployment/provider writes are not authorised. Earlier 0021–0066/b87 approvals do not authorise this new release.
- Outer manifest: 6/6 SHA256 verified. Evidence manifest: 32/32 verified; safe extraction rejected traversal, absolute paths, links and duplicate destinations. ZIP SHA256: `0094757825f85fdd037004e971b3105cb9a8b6cfdce4585a0c75339ed2fbff64`. Plan SHA256: `934cb76190f52f360ccb8ac6d87f76e86124e4722ef2cd6ea51c3aa27ddfd7a1`.
- Full plan, audit, both UAT CSVs, source-index, DOM snapshots, HTML sources, screenshots and pagination reproducer read. Audit evidence is historical evidence, not a new UAT run.
- User selected local source reads after automatic review rejected graph indexing. No source export.
- All original 50 UAT cases retained in `uat-results.csv`, initially `not_run`. CI/mock contracts do not automatically pass a UAT case.

## Task ledger

| Task | Finding     | State         | Commit / tests / evidence                                                                                                                                                    | Blocker / next step                                                                   |
| ---- | ----------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| T00  | F01,F02,F20 | code_verified | baseline aa5d3cb; 175 files / 1752 tests pass, 0 skip; lint 0 errors/1 existing warning; typecheck/build/dev-imports/cron hook pass; evidence/2026-10-01-baseline-gates.json | Production provider/UAT verification remains separate; proceed T01/T03                |
| T01  | F01         | pending       | `schema-health.ts` still ledger-only                                                                                                                                         | Read-only physical contracts, populated backup/restore and forward repair             |
| T03  | F20         | pending       | Live aggregate: 3 companies, all client                                                                                                                                      | Explicit scope/badges; reviewed origin inventory; no automatic reclassification       |
| T02  | F02         | pending       | Last scheduled success 2026-09-30 01:55 UTC                                                                                                                                  | Read-only topology; local scheduler contract; new live activation needs release gates |
| T23  | F17         | pending       | Fixed capability text contradicts configured adapter                                                                                                                         | Follow T01/T02 code; separate configuration, health, approval                         |
| T04  | F03         | pending       | Portal/documents strict UUID version regex                                                                                                                                   | Shared canonical Postgres UUID parser and route regression                            |
| T05  | F16         | pending       | Document list/by-ID policy mismatch                                                                                                                                          | One server scope; real PG role matrix                                                 |
| T06  | F04         | pending       | Vault/read-model mismatch; physical cause unknown                                                                                                                            | Follow T05; metadata reconciliation read-only first                                   |
| T07  | F07         | pending       | Supplied pagination reproducer 8 pass/1 fail                                                                                                                                 | Reproduce locally then terminal cursor/filter epoch fix                               |
| T08  | F05         | pending       | Ready view ignores payment                                                                                                                                                   | Follow T05/T06; shared versioned readiness                                            |
| T09  | F06         | pending       | KPI units and scope differ                                                                                                                                                   | Follow T03/T08; SQL aggregate parity                                                  |
| T10  | F14         | pending       | Owner labels are UUID prefixes                                                                                                                                               | Follow T08; staff names/workload/business blockers                                    |
| T11  | F15         | pending       | Payment review lacks inline evidence context                                                                                                                                 | Follow T05/T06/T08; safe current proof/version review                                 |
| T12  | F08         | pending       | Production Admin is explanatory placeholder                                                                                                                                  | Follow T05; staff lifecycle/invariants; invitation provider gate                      |
| T13  | F13         | pending       | No shared bulk registry in main                                                                                                                                              | Follow T05/T07/T10/T12; durable preview/item auth/version/leases                      |
| T14  | F09         | pending       | Imports only stage                                                                                                                                                           | Follow T03/T12/T13; mapping/approved selected apply                                   |
| T15  | F10         | pending       | HTTP scanner exists; live verification absent                                                                                                                                | Follow T01/T05/T06; provider/approved sample blockers separate                        |
| T16  | F10         | pending       | Text/AI contracts exist; OCR/live accuracy absent                                                                                                                            | Follow T08/T15; grounded suggestions only                                             |
| T17  | F11         | pending       | WOZTELL not connected in audit evidence                                                                                                                                      | Follow T01/T03/T05/T08/T15; official media protocol required                          |
| T18  | F13,F11     | pending       | No common bulk maintenance                                                                                                                                                   | Follow T08/T11/T13/T14/T17 code                                                       |
| T19  | F12         | pending       | Handoff adapter not configured; manual workflow incomplete                                                                                                                   | Follow T08/T15; no export-as-submission                                               |
| T20  | F19         | pending       | Navigation/settings/mobile journey unresolved                                                                                                                                | Follow specified UI dependencies; preserve deep links                                 |
| T21  | F18         | pending       | 5000 hydration / ceiling limits                                                                                                                                              | Follow T07/T08/T09; before/after same-data performance                                |
| T22  | F01–F20     | pending       | 50 original cases not_run                                                                                                                                                    | Full local CI plus real fresh-role/provider UAT; explicit skips                       |

## Finding recheck at current main

`still-present` denotes source/aggregate evidence, not a fresh multi-role production reproduction. No finding is marked fixed without a tested change.

| Finding | Classification         | Current evidence                                                                                                                   | Task    |
| ------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------- |
| F01     | still-present          | Live DB: 66 recorded IDs, missing required 0034 marker ID and physical dispatch column/index; `schema-health.ts` only compares IDs | T01     |
| F02     | still-present          | Last scheduled 2026-09-30 01:55 UTC; current Web aa5; pending notifications=4, analysis=14                                         | T02     |
| F03     | still-present          | `routes/portal.tsx`, `routes/documents.tsx` regex rejects seeded canonical UUIDs; supplied UUID/portal DOM                         | T04     |
| F04     | needs-runtime-evidence | `documents/repository.ts` inner joins and supplied empty vault vs populated client detail; lineage not yet established             | T06     |
| F05     | still-present          | `annual-return/work-views.ts` ready checks documents; supplied Kowloon payment-pending appears ready                               | T08     |
| F06     | still-present          | `dashboard/dashboard-data.ts`, `routes/index.tsx`, board metrics use different units                                               | T09     |
| F07     | still-present          | `production-command-center.tsx` terminal null converted to undefined and falls back to first page; supplied failing regression     | T07     |
| F08     | still-present          | `routes/admin.tsx` production unavailable branch; admin DOM                                                                        | T12     |
| F09     | still-present          | `nar-import/server-fns.ts` stage-only; imports DOM                                                                                 | T14     |
| F10     | needs-runtime-evidence | Existing scanner/text/AI adapters; no verified live scanner/OCR/model roundtrip evidence                                           | T15/T16 |
| F11     | needs-runtime-evidence | Audit missing four WOZTELL bindings; current binding presence not yet read                                                         | T17     |
| F12     | still-present          | `package-handoffs` prepared-only external adapter; real protocol absent                                                            | T19     |
| F13     | still-present          | Main has no bulk-operation migration/registry; historical integration DB tables do not prove main functionality                    | T13/T18 |
| F14     | still-present          | `routes/work-queue.tsx` uses Staff UUID prefix and SLA-only blocker evidence                                                       | T10     |
| F15     | still-present          | `routes/payments.tsx` source lacks same-screen proof context; production populated review untested                                 | T11     |
| F16     | still-present          | `documents/server-fns.ts` team list filter differs from owner/reviewer by-ID authorisation; no fresh live role test                | T05     |
| F17     | still-present          | `operations/capabilities.ts` says no AI binding despite `DOCUMENT_AI_URL/API_KEY`; old tick described never-observed               | T23     |
| F18     | still-present          | `annual-return/repository.ts` listAllCases/5000 hydration and work read-model bounds; scale/live vitals unmeasured                 | T21     |
| F19     | needs-runtime-evidence | Supplied nav/settings DOM and unchanged source; mobile/keyboard journey not yet executed                                           | T20     |
| F20     | still-present          | No displayed data origin/scope; live 3 rows are client, seed resemblance is not classification evidence                            | T03     |

## Evidence and continuation

- `evidence/2026-10-01-provider-inventory.json`: scoped read-only catalog and active Web metadata; no secrets/recipient data.
- Local original input evidence: `.worktrees/audit-inputs-20261001/evidence-2026-10-01/` (ignored; supplied artefacts retained).
- Local gate logs: `.worktrees/audit-baseline-20261001/` (ignored; summaries committed separately).
- PR packages follow the original 11-package plan. Reuse older integration code only after contract review; do not merge its whole history to solve schema drift.
- Next: T00 baseline commit, T01 physical readiness and restore rehearsal, T03 local scope, then early T02/T23. External access gaps do not block independent T04/T07 fixes.
