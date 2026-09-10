# Kossilon implementation status

Current branch: `codex/kossilon-phase-c` · Current commit: `d312596` · Base: `main` = `fa02046`

Four states are tracked separately, per plan §3.1. A phase is not "done" because
its code is written.

| Phase | Code | Real integration | Releasable | Blocked on |
|---|---|---|---|---|
| **A** Safe staff document workflow | ✅ complete | ❌ none | ❌ no | scanner provider, a database, a browser walkthrough |
| **B** Monthly NAR intake and daily operations | ✅ complete | ❌ none | ❌ no | a database for the new tables |
| **C** Document intelligence and Kossilon review | 🟨 partial (C-0, C-1, C-4a, C-5) | ❌ none | ❌ no | AI provider, a database |
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
| **B-4** The daily workspace | Complete — `/today` with the five work views, navigation regrouped into 今日工作 / 客戶與案件 / 文件審閱 / 訊息, plus the zero-overdue banner and work-queue name fixes |
| **B-5** Person-level requirement foundation | Complete — migration `0026`; 15 tests including the plan's own two examples |

**Design is complete for all of Phase B**:
`docs/superpowers/specs/2026-09-10-kossilon-phase-b-nar-intake-design.md`.

## Phase C, work package by work package

| Package | State |
|---|---|
| **C-0** Three claims the product could not support | Complete — dashboard heading, synthetic confidence, both Chinese-stripping tokenizers |
| **C-1** Document versions and supersession | Complete — migration `0027`; 19 unit + 5 integration tests; not applied to any database |
| **C-2** Analysis pipeline and provider adapter | ⬜ not started |
| **C-3** Approved annual-return requirement template | ⬜ not started — Phase B's `case_requirement_instances` already carries applicability per party |
| **C-4a** No synthetic certainty percentage | Complete — `DraftGrounding` replaced `confidence: number`; 8 tests |
| **C-4b** Findings in the review workspace | ⬜ not started — depends on C-2 |
| **C-5** Package approval contract | Complete — 19 tests; AI holds no package-approve permission, structurally |

**Design is complete for all of Phase C**:
`docs/superpowers/specs/2026-09-10-kossilon-phase-c-document-intelligence-design.md`.

### What C-0 actually found

Three live claims, in descending severity:

- `src/routes/index.tsx:158` rendered **"AI daily digest"** with a `Sparkles`
  icon **outside any `dataMode` branch**, so a production user read "AI" over
  `buildDailyDigest`, a hardcoded severity weight table. Renamed to "Priority
  queue", with the ranking rule stated in the panel.
- `draftReply` returned `confidence = min(96, 70 + faqs.length * 4 +
  documents.length * 3 + 8)`. Both arrays are capped, so it was a pure arity
  function bounded to 70–96 that printed **"Confidence 70%" over zero matched
  sources**; Regenerate decremented it without rerunning retrieval.
- Both tokenizers normalised with an ASCII-only class, so every CJK codepoint
  became a space and **any Chinese message retrieved nothing**, on a Hong Kong
  company-secretary platform. Verified by execution before and after.

The confidence number and the tokenizer ship in the **demo only**
(`AiAssistantPanel` is demo-gated by `demo-store-boundary.test.ts` and
`-production-authorization.test.ts`). The dashboard heading was not.

### The declared/verified split

The single most consequential finding of C-1.
`document_upload_intents.checksum_sha256` and `expected_size_bytes` are supplied
by the client when the intent is created and are **never compared to the stored
object by any enabled code path** — only the provider scanner reads and hashes
it, and that is `BLOCKED_INTEGRATION`. A manifest hash built over that value
would certify whatever the uploader typed. So `document_versions` stores the
claim as `declared_checksum_sha256`, leaves `verified_checksum_sha256` null
until something has actually read the bytes, and `canCiteInManifest` refuses a
version without one. That refuses every version today — the same gate Phase A
already applies to approval, from the same missing provider, not a new one.

## Exact next step

**Phase C-2 — the analysis pipeline**, then C-3 and C-4b on top of it. C-2 is
durable work claimed with the same lease-and-fence mechanics as
`document_scan_jobs` and `notification_outbox`, running only after a real
malware verdict, in three tiers: classification and readability, deterministic
rule checks, and provider-assisted extraction under
`BLOCKED_INTEGRATION: ai-provider` — written against a strict schema with an
explicit `uncertain` outcome, contract-tested against a stub, and disabled via a
sibling accessor rather than `REQUIRED_BINDINGS`. Extracted text is untrusted
evidence: the adversarial fixture the plan requires (a document whose text says
to approve the case) belongs to that package.

Applying `0023` through `0027` to a database needs explicit authorization under
`CLAUDE.md`. The CI run is what executes the 20 repository integration tests.

## Open blockers

| ID | Effect | Cleared by |
|---|---|---|
| `BLOCKED_INTEGRATION: malware-scanner-provider` | Live document scanning stays disabled; the legacy re-scan backlog stays pending | An approved provider, its binding names, its data-handling terms |
| `BLOCKED_INTEGRATION: local-postgres` | Repository tests run only in CI | A reachable `TEST_DATABASE_URL`, or the CI run on the PR |
| `BLOCKED_INTEGRATION: ai-provider` | No model reads any document. There is no AI SDK, key binding, adapter or provider-mode gate anywhere in the repository; C-2's provider tier stays disabled and every C-1 version stays without a content identity | An approved provider, its binding names, its data-handling terms |
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
