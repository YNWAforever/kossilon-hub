# Kossilon implementation status

Current branch: `codex/kossilon-phase-d` · Current commit: `5467ad3` · Base: `main` = `fa02046`

Four states are tracked separately, per plan §3.1. A phase is not "done" because
its code is written.

| Phase | Code | Real integration | Releasable | Blocked on |
|---|---|---|---|---|
| **A** Safe staff document workflow | ✅ complete | ❌ none | ❌ no | scanner provider, a database, a browser walkthrough |
| **B** Monthly NAR intake and daily operations | ✅ complete | ❌ none | ❌ no | a database for the new tables |
| **C** Document intelligence and Kossilon review | ✅ code complete | ❌ none | ❌ no | AI provider, text extraction, a database |
| **D** Messaging, attachments and chasing | 🟨 partial | ❌ none | ❌ no | a WOZTELL media-download endpoint, real accounts, a database |
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
| **C-2** Analysis pipeline and provider adapter | ✅ complete — migration `0028`; queue, worker, two deterministic tiers, disabled provider adapter; wired end to end; 56 tests |
| **C-3** Approved annual-return requirement template | ✅ complete — NAR1/AGM/CDD company-level, identity and address proof per confirmed party; calendar-month freshness rule; parties seeded from the officer register and confirmed by a person, which creates their requirements in the same transaction |
| **C-4a** No synthetic certainty percentage | Complete — `DraftGrounding` replaced `confidence: number`; 8 tests |
| **C-4b** Findings in the review workspace | ✅ complete — findings on the case detail screen, with "not checked" said in words rather than shown as a blank; 27 tests |
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

### What C-2 can actually compute, and what it cannot

The design first assumed tiers 1 and 2 needed no provider. True, and beside the
point: **they need extracted text, and there is none.** `doc-parser.ts` is
browser-only by construction — `pdfjs-dist` evaluates `new DOMMatrix()` at module
scope and `mammoth` requires `fs`, neither of which workerd has, and
`nodejs_compat` appears zero times in the wrangler config. Its output never
leaves `localStorage`, on a demo-only screen. And `EXTENSIONS_BY_CATEGORY`
restricts every upload to **PDF or an image**, so the one reusable server-side
reader — the dependency-free ZIP/OOXML parser in `nar-import` — matches nothing
in the real corpus.

`BLOCKED_INTEGRATION: document-text-extraction`. Both date rules the spec
promised sit behind it: a document's age and its own year can only come from its
content.

So the tiers as built:

- **Tier 1, readability** — head and tail of the stored object only: format magic
  bytes against the declared content type, a PDF end-of-file marker, and whether
  the trailer references `/Encrypt`. Catches a file that will not open before a
  reviewer spends a slot on it. Page count is *not* here; it needs a real parser.
- **Tier 2, cross-checks** — records against each other. The best one falls out
  of C-1: **stored bytes that do not hash to the checksum declared at upload** is
  a critical, deterministic issue. A version nobody has hashed is `uncertain`,
  not an issue — that is every document today.
- **Tier 3, provider** — `BLOCKED_INTEGRATION: ai-provider`. Written,
  contract-tested against a stub, returns null in every mode.

### C-2 was adversarially reviewed

31 agents across six dimensions, each finding then verified by a separate agent
told to refute it. One survived: the provider response schema and `makeFinding`
stated the same rules and disagreed, so `{pageTo: 3}` with no `pageFrom` parsed
cleanly and then threw *out of* `analyze()` — past its own promise to return
`malformed-response` — and the worker awaited it with no catch, unwinding the
whole drain and stranding every job claimed after it in that batch. Fixed at
three layers. Reachability was a two-binding config change, not a code change.

Two refutations conceded facts worth acting on anyway, and both were fixed:
`blocksRelease` had no production caller because the manifest carried its own
tier-less copy of a finding, and `0028` created no jobs for the versions `0027`
backfilled.

A third defect was found by tracing arithmetic rather than by the review:
`markRetry` while awaiting a scan verdict spent an attempt, and since
`attempt_count` increments at claim time, five waits exhausted `max_attempts`
about fifteen minutes after upload — every document permanently unanalysable,
including after a scanner is finally configured. `markDeferred` gives the attempt
back.

### The injection defence, in three layers

A provider tier reads text an uploader controls. `critical` is the severity that
holds a package back, so a provider finding can never reach it:

1. `critical` is **absent from the provider response schema**, so a response
   asking for it fails to parse and the whole run is rejected rather than
   silently downgraded.
2. `makeFinding` clamps provider severity regardless of what was requested.
3. `document_findings` has a CHECK constraint refusing the combination, so even
   a direct SQL write cannot create one.

There is no field anywhere in the contract for approving, resolving or releasing.
A model cannot ask.

## Exact next step

**Phase D's two features are built.** The fixture-replay send guard (migration
`0030`) and inbound media capture (migration `0031`). Eight pre-existing defects
in the messaging code were found and fixed first; they are listed below.

What remains in D is what a provider gates:

- **Inbound media cannot become a document.** The reference is recorded, but
  WOZTELL's webhook documentation shows no media-download endpoint, so nothing
  can fetch the bytes. `BLOCKED_INTEGRATION: whatsapp-media-download`. When that
  endpoint is known, the path is: fetch → upload intent (requested by the webhook
  rather than a person) → R2 → document → version → scan job → analysis job, so
  the file passes the same malware gate as every other document rather than
  beside it.
- **Nothing is integration-verified.** No migration has been applied and no
  provider account is reachable.

**Phase E — external handoff and folder returns** is the next phase. Its
dependency (D) is code-complete for everything a provider does not gate.

Applying `0023` through `0031` to a database needs explicit authorization under
`CLAUDE.md`. No Postgres is reachable here, so the repository integration tests
execute only in CI.

## Open blockers

| ID | Effect | Cleared by |
|---|---|---|
| `BLOCKED_INTEGRATION: malware-scanner-provider` | Live document scanning stays disabled; the legacy re-scan backlog stays pending | An approved provider, its binding names, its data-handling terms |
| `BLOCKED_INTEGRATION: local-postgres` | Repository tests run only in CI | A reachable `TEST_DATABASE_URL`, or the CI run on the PR |
| `BLOCKED_INTEGRATION: whatsapp-media-download` | A client's attachment is recorded by reference but its bytes cannot be fetched, so inbound media never becomes a document | A documented WOZTELL media-download endpoint and its auth |
| `BLOCKED_INTEGRATION: document-text-extraction` | No server-side text extraction exists or can be lifted from the browser code; every rule needing a document's own words is unbuildable, including both date rules | A Worker-safe PDF text layer (new work), or `nodejs_compat` plus a Node PDF library (a deploy-surface change) |
| `BLOCKED_INTEGRATION: ai-provider` | No model reads any document. There is no AI SDK, key binding, adapter or provider-mode gate anywhere in the repository; C-2's provider tier stays disabled and every C-1 version stays without a content identity | An approved provider, its binding names, its data-handling terms |
| `BLOCKED_INTEGRATION: deployment-runtime` | Whether the 5-minute schedule really fires is unverified | Observed evidence of a scheduled invocation on the deployed runtime |

## Open business inputs

**From Phase C-3, and it changes verdicts:** the three-calendar-month window
clamps to the end of the target month, so three months before 31 May is
28 February rather than 3 March. Clamping is the conventional legal reading and
is the more lenient of the two by a few days at month ends. The alternative
(rolling forward, as `oneYearLater` does for the statutory anniversary) is
stricter. The difference only appears at month ends and only by a few days --
which is enough to flip a verdict on evidence submitted near a deadline. Confirm
which the firm intends.

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
