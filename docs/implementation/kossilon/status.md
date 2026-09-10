# Kossilon implementation status

Current branch: `codex/kossilon-phase-b` · Current commit: `e3897cb` · Base: `main` = `fa02046`

Four states are tracked separately, per plan §3.1. A phase is not "done" because
its code is written.

| Phase | Code | Real integration | Releasable | Blocked on |
|---|---|---|---|---|
| **A** Safe staff document workflow | ✅ complete | ❌ none | ❌ no | scanner provider, a database, a browser walkthrough |
| **B** Monthly NAR intake and daily operations | 🟡 **in progress** — see below | ❌ none | ❌ no | a database for the staging tables |
| **C** Document intelligence and Kossilon review | ⬜ not started | — | — | AI provider |
| **D** Messaging, attachments and chasing | ⬜ not started | — | — | real accounts and conversations |
| **E** External handoff and folder returns | ⬜ not started | — | — | the internal server, its protocol and rights |
| **F** Pilot, scale and operations | ⬜ not started | — | — | pilot staff and representative cases |

## Phase B, work package by work package

| Package | State |
|---|---|
| **B-1a** Workbook reader (ZIP + OOXML, no dependency) | ✅ complete, 22 tests, verified against the real supplied file locally |
| **B-1b** Date/marker normalization | ✅ complete, 30 tests |
| **B-1c** Row mapping and disposition | ✅ complete, 24 tests |
| **B-1d** Staging schema, repository, server fns | ⬜ not started — migration `0024` not yet written |
| **B-1e** Import preview and apply UI | ⬜ not started |
| **B-2** A received document is not a missing document | ⬜ not started — **this is the live client-facing defect**; see the spec |
| **B-3** Server-side search and real pagination | ⬜ not started |
| **B-4** The daily workspace | ⬜ not started |
| **B-5** Person-level requirement foundation | ⬜ not started |

**Design is complete for all of Phase B**:
`docs/superpowers/specs/2026-09-10-kossilon-phase-b-nar-intake-design.md`.

## Exact next step

Write migration `0024` for the three staging structures the spec names
(`nar_import_batches`, `nar_import_rows`, `company_external_references`), then the
repository and server fns that persist a parsed batch. The pure core those sit on
top of is finished and tested.

Then **B-2**, which should not wait: `grep -rn "checklist" src/features/documents/`
returns zero hits, so a client upload is invisible to the checklist, creates no
work item, and both the portal and `deriveProductionFollowUpDrafts` count
`status !== "Verified"` — clients are told "we are still waiting on N documents
from you" for documents they have already sent, and the chase loop has no
outstanding-work test at all.

## Open blockers

| ID | Effect | Cleared by |
|---|---|---|
| `BLOCKED_INTEGRATION: malware-scanner-provider` | Live document scanning stays disabled; the legacy re-scan backlog stays pending | An approved provider, its binding names, its data-handling terms |
| `BLOCKED_INTEGRATION: local-postgres` | Repository tests run only in CI | A reachable `TEST_DATABASE_URL`, or the CI run on the PR |
| `BLOCKED_INTEGRATION: deployment-runtime` | Whether the 5-minute schedule really fires is unverified | Observed evidence of a scheduled invocation on the deployed runtime |

## Open business inputs Phase B will need answered

Not blocking the code — each has a safe default — but each is a real decision:

- What `(Nil)` means in the invoice and payment columns.
- Which deadline the 1-month / 14-day / 7-day reminders anchor on.
- The fee for an imported case. The workbook has invoice numbers but no amounts,
  and `payments.amount` is `NOT NULL CHECK (amount > 0)`, so the importer creates
  no payment and the apply step must ask.

## Not yet done, and deliberately so

- **No migration has been applied to any database.** `CLAUDE.md` requires explicit
  authorization for any non-local `DATABASE_URL`, and none was given.
- **No branch has been pushed and no PR opened.** Awaiting authorization.
- **No browser walkthrough.**
- **No customer message has been sent**, and nothing in this work can send one.
- **The supplied client workbook is not committed.** The reader was verified
  against it locally and that verification file was deleted; committed fixtures
  are built in code with invented names and ids.

## Records

| File | Holds |
|---|---|
| `baseline-and-decisions.md` | Baseline, architecture, the verified workbook contract, blockers, decisions |
| `phase-a-report.md` | Phase A: defects, changes, commands run, gate status |
| `../../superpowers/specs/2026-09-10-kossilon-phase-a-document-safety-design.md` | Phase A design |
| `../../superpowers/specs/2026-09-10-kossilon-phase-b-nar-intake-design.md` | Phase B design |
