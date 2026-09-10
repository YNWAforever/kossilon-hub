# Kossilon implementation status

Current branch: `codex/kossilon-phase-a` · Current commit: `9f2c76e` · Base: `main` = `fa02046`

Four states are tracked separately, per plan §3.1. A phase is not "done" because
its code is written.

| Phase | Code | Real integration | Releasable | Blocked on |
|---|---|---|---|---|
| **A** Safe staff document workflow | ✅ complete | ❌ none | ❌ no | scanner provider, a database, a browser walkthrough |
| **B** Monthly NAR intake and daily operations | ⬜ not started | — | — | — |
| **C** Document intelligence and Kossilon review | ⬜ not started | — | — | AI provider |
| **D** Messaging, attachments and chasing | ⬜ not started | — | — | real accounts and conversations |
| **E** External handoff and folder returns | ⬜ not started | — | — | the internal server, its protocol and rights |
| **F** Pilot, scale and operations | ⬜ not started | — | — | pilot staff and representative cases |

## Exact next step

Begin **Phase B**. Write
`docs/superpowers/specs/<date>-kossilon-phase-b-nar-intake-design.md`, then
implement the XLSX importer against the verified workbook contract in
`baseline-and-decisions.md` §3.

Phase B's first design constraint is already known: `companies` has eight
`NOT NULL` columns the workbook does not supply (`cr_number`, `br_number`,
`incorporation_date`, `annual_return_basis_date`, `registered_office`,
`company_secretary`, `assigned_owner_id`, `assigned_team_id`), so an unmatched row
must stage rather than create a company — the plan's "no fabricated incorporation
year / CR number / fee" rule falls straight out of the schema.

## Open blockers

| ID | Effect | Cleared by |
|---|---|---|
| `BLOCKED_INTEGRATION: malware-scanner-provider` | Live document scanning stays disabled; the legacy re-scan backlog stays pending | An approved provider, its binding names, its data-handling terms |
| `BLOCKED_INTEGRATION: local-postgres` | 11 new repository tests run only in CI | A reachable `TEST_DATABASE_URL`, or the CI run on the PR |
| `BLOCKED_INTEGRATION: deployment-runtime` | Whether the 5-minute schedule really fires is unverified | Observed evidence of a scheduled invocation on the deployed runtime |

## Not yet done, and deliberately so

- **`0023` has not been applied to any database.** `CLAUDE.md` requires explicit
  authorization for any non-local `DATABASE_URL`, and none was given.
- **No branch has been pushed and no PR opened.** Awaiting authorization.
- **No browser walkthrough.** It needs an authorized login against a real
  environment; a fixture demo would not be evidence of a staff flow.
- **No customer message has been sent**, and nothing in this work can send one.

## Records

| File | Holds |
|---|---|
| `baseline-and-decisions.md` | Baseline, architecture, the verified workbook contract, blockers, decisions |
| `phase-a-report.md` | Phase A: defects, changes, commands run, gate status |
| `../../superpowers/specs/2026-09-10-kossilon-phase-a-document-safety-design.md` | Phase A design |
