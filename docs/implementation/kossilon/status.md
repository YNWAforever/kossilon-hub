# Kossilon implementation status

Current branch: `codex/kossilon-phase-b` · Current commit: `2826724` · Base: `main` = `fa02046`

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
| **B-1a** Workbook reader (ZIP + OOXML, no dependency) | Complete, 22 tests, verified against the real supplied file locally |
| **B-1b** Date/marker normalization | Complete, 30 tests |
| **B-1c** Row mapping and disposition | Complete, 26 tests |
| **B-1d** Staging schema, repository, server fns | Complete — migrations `0025`; not applied to any database |
| **B-1e** Import review screen | Complete — `/imports`, in the primary navigation |
| **B-2** A received document is not a missing document | Complete — migration `0024`; 18 unit + 4 integration tests |
| **B-3** Server-side search and real pagination | Complete — including the follow-up-drafts correctness fix |
| **B-4** The daily workspace | **Partial.** The two named defects are fixed (zero-overdue red banner, uuid prefixes in the work queue). The 今日工作 / 五個工作視圖 navigation restructure is **not** done. |
| **B-5** Person-level requirement foundation | **Not started.** |

**Design is complete for all of Phase B**:
`docs/superpowers/specs/2026-09-10-kossilon-phase-b-nar-intake-design.md`.

## Exact next step

**B-5**, the person-level requirement foundation: confirmed case parties and
versioned requirement instances, extending `annual_return_checklist_items` rather
than competing with it, plus evidence links so one requirement may have several
documents and one document may support several requirements. The legacy backfill
maps only unambiguous evidence and flags the rest; a generic identity requirement
is never split into guessed directors.

Then the rest of **B-4**: the 今日工作 / 客戶與案件 / 文件審閱 / 訊息 navigation and
the five work views. Phase A's `documentSafetyOf` and Phase B's
`outstandingForClient` / `awaitingInternalReview` already supply the state each
view needs, so this is composition rather than new derivation.

Applying `0023`, `0024` and `0025` to a database needs explicit authorization
under `CLAUDE.md`, and the CI run is what executes the 15 repository integration
tests.

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
