# Kossilon implementation status

Current branch: `codex/kossilon-phase-f` · Current commit: `cde3cc5` · Base: `main` = `fa02046`

Four states are tracked separately, per plan §3.1. A phase is not "done" because
its code is written.

| Phase                                           | Code                                                                 | Real integration | Releasable | Blocked on                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------- | ---------------- | ---------- | -------------------------------------------------------------- |
| **A** Safe staff document workflow              | ✅ complete                                                          | ❌ none          | ❌ no      | scanner provider, a database, a browser walkthrough            |
| **B** Monthly NAR intake and daily operations   | ✅ complete                                                          | ❌ none          | ❌ no      | a database for the new tables                                  |
| **C** Document intelligence and Kossilon review | ✅ code complete                                                     | ❌ none          | ❌ no      | AI provider, text extraction, a database                       |
| **D** Messaging, attachments and chasing        | 🟨 partial                                                           | ❌ none          | ❌ no      | a WOZTELL media-download endpoint, real accounts, a database   |
| **E** External handoff and folder returns       | 🟨 model complete, nothing transmits                                 | ❌ none          | ❌ no      | the internal server's protocol, address and rights             |
| **F** Pilot, scale and operations               | 🟨 the observability half is built; the pilot half cannot start here | ❌ none          | ❌ no      | a database, a deployment, pilot staff and representative cases |

## Phase B, work package by work package

| Package                                               | State                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-1a** Workbook reader (ZIP + OOXML, no dependency) | Complete, 22 tests, verified against the real supplied file locally                                                                                                     |
| **B-1b** Date/marker normalization                    | Complete, 30 tests                                                                                                                                                      |
| **B-1c** Row mapping and disposition                  | Complete, 26 tests                                                                                                                                                      |
| **B-1d** Staging schema, repository, server fns       | Complete — migrations `0025`; not applied to any database                                                                                                               |
| **B-1e** Import review screen                         | Complete — `/imports`, in the primary navigation                                                                                                                        |
| **B-2** A received document is not a missing document | Complete — migration `0024`; 18 unit + 4 integration tests                                                                                                              |
| **B-3** Server-side search and real pagination        | Complete — including the follow-up-drafts correctness fix                                                                                                               |
| **B-4** The daily workspace                           | Complete — `/today` with the five work views, navigation regrouped into 今日工作 / 客戶與案件 / 文件審閱 / 訊息, plus the zero-overdue banner and work-queue name fixes |
| **B-5** Person-level requirement foundation           | Complete — migration `0026`; 15 tests including the plan's own two examples                                                                                             |

**Design is complete for all of Phase B**:
`docs/superpowers/specs/2026-09-10-kossilon-phase-b-nar-intake-design.md`.

## Phase C, work package by work package

| Package                                             | State                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C-0** Three claims the product could not support  | Complete — dashboard heading, synthetic confidence, both Chinese-stripping tokenizers                                                                                                                                                                 |
| **C-1** Document versions and supersession          | Complete — migration `0027`; 19 unit + 5 integration tests; not applied to any database                                                                                                                                                               |
| **C-2** Analysis pipeline and provider adapter      | ✅ complete — migration `0028`; queue, worker, two deterministic tiers, disabled provider adapter; wired end to end; 56 tests                                                                                                                         |
| **C-3** Approved annual-return requirement template | ✅ complete — NAR1/AGM/CDD company-level, identity and address proof per confirmed party; calendar-month freshness rule; parties seeded from the officer register and confirmed by a person, which creates their requirements in the same transaction |
| **C-4a** No synthetic certainty percentage          | Complete — `DraftGrounding` replaced `confidence: number`; 8 tests                                                                                                                                                                                    |
| **C-4b** Findings in the review workspace           | ✅ complete — findings on the case detail screen, with "not checked" said in words rather than shown as a blank; 27 tests                                                                                                                             |
| **C-5** Package approval contract                   | Complete — 19 tests; AI holds no package-approve permission, structurally                                                                                                                                                                             |

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
  reviewer spends a slot on it. Page count is _not_ here; it needs a real parser.
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
cleanly and then threw _out of_ `analyze()` — past its own promise to return
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

## Phase F, work package by work package

| Package                                                    | State                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-1** The tick leaves a trace                            | ✅ complete — migration `0033` `maintenance_runs`; recorded on the success, partial and failed paths; not applied to any database                 |
| **F-2** Maintenance health and the operations screen       | ✅ complete — `maintenanceHealthOf`, `/operations`, queue depths; 25 tests                                                                        |
| **F-3** Capability inventory                               | ✅ complete — `capabilities.ts` plus a convention test cross-checking it against the `BLOCKED_INTEGRATION:` markers in `src/`, in both directions |
| **F-4** Pilot runbook, measurement plan, next-service spec | ✅ records written                                                                                                                                |
| **F-5** The pilot itself                                   | ⬜ cannot start here — needs a database, a deployment, staff and cases                                                                            |
| **F-6** Scale and query plans                              | ⬜ blocked — no dataset, no measurement, and adding indexes without one is what plan F2 forbids                                                   |
| **F-7** Backup/restore verification                        | ⬜ blocked — needs a database and a bucket to restore together                                                                                    |

**Design:**
`docs/superpowers/specs/2026-09-11-kossilon-phase-f-pilot-operations-design.md`.

### What F-1 found

`runScheduledMaintenanceForWorker` ran the nine passes and then
`console.log`ged the result. That was the entire record. It goes to the
Cloudflare log stream: ephemeral, requires a person to go and look, and
unreadable by the product.

So a cron that stopped firing — or, the live possibility under
`BLOCKED_INTEGRATION: deployment-runtime`, one that never registered on the
deployed runtime and never fired at all — produced **no visible symptom**. SLA
escalations are never evaluated, reminders are never evaluated, the outbox is
never dispatched, quarantined documents are never scanned, expired intents are
never reclaimed, and every screen still looks completely normal, because every
screen reads tables a human writes to. The first real signal is a missed
statutory deadline.

Three decisions carry the weight:

- **The recorder is constructed before the repositories.** A tick that dies while
  assembling them — a missing binding, a Hyperdrive that will not resolve — is
  precisely the failure worth a row, and a recorder built after them would not
  exist yet to write one. This also made `outcome: 'failed'` reachable; before
  the reorder it was a branch nothing could enter.
- **A failed record write never fails the run.** Nine passes did their work, and
  losing the bookkeeping row is the smaller loss. It is not silent either: the
  health goes `stale` after two missed records.
- **`failure_summary` records an error class, never its message.** A top-level
  failure here is usually the database, whose error text carries a host and can
  carry a connection string, and this row is rendered on a screen. Same rule the
  handoff destination already follows. The full text still goes to
  `console.error` exactly as before.

### What `never-observed` is for

`maintenanceHealthOf` has five states, and the first is the point of the
exercise. An empty `maintenance_runs` is **not** healthy: it is what a deployment
whose cron never registered looks like, and it is this repository's actual state.
A green tick over an empty table would be a positive claim made out of no
evidence, about the one subsystem nobody watches.

Two further rules:

- **Staleness outranks the last run's outcome.** A cron that stopped after a
  clean tick and one that stopped after a failed tick are the same emergency.
- **A `not-configured` pass is not a fault.** Under six blocked integrations the
  scan and analysis passes say that on every single tick, permanently. Folding it
  into `degraded` would paint the screen red forever and train staff to ignore
  it — and the day something actually broke, the colour would not change. Blocked
  capabilities are their own channel of the same screen.

`trigger_source` exists so an operator running the entrypoint by hand cannot make
a dead cron look alive; the health rule counts scheduled runs only. It defaults
to `manual`, so a caller that forgets under-reports rather than over-reports.

### The inventory test is the part that lasts

`capabilities.test.ts` compares the declared blocked integrations against the
`BLOCKED_INTEGRATION:` markers in `src/`, both ways. The reverse direction — an
entry claiming something is disabled after the code stopped saying so — is the
one that rots quietly, because nothing else in a build would ever notice. Both
directions were mutation-tested: removing the `ai-provider` entry fails naming
the five files that carry its marker, and adding an entry with no marker fails
naming it.

## Exact next step

**Every phase A–F that can be built without a database, a deployment or a
provider account has been built.** What remains is not code.

The next step is to **apply migrations `0023`–`0033` to a database and deploy**,
in that order, and then open `/operations`. That single screen answers the
question five phases of work could not: whether the schedule fires at all. Until
it shows a run with trigger 排程, `BLOCKED_INTEGRATION: deployment-runtime`
stands, and every reminder, escalation and scan the tick owns should be assumed
not to have run.

Both steps need authorization that has not been given: `CLAUDE.md` requires
explicit approval for any non-local `DATABASE_URL`, and no branch has been
pushed.

After that, in order of what unblocks the most:

1. **A malware scanner provider.** It gates `verified` safety, which gates
   package approval. Nothing can be filed until it exists, so it blocks the
   pilot's most important step.
2. **A `TEST_DATABASE_URL`, or the CI run on a PR.** Every SQL claim in A–F rests
   on reading, not running.
3. **The internal server's handoff protocol.** Without it a pilot can prepare and
   approve packages but not send them, and 回件與異常 stays unreleased.
4. **A pilot cohort and a baseline.** See `pilot-measurement-plan.md`: collect
   the observed metrics for the current spreadsheet process _before_ handing
   anyone the product, or the pilot can only produce anecdotes.

### What five phases have and have not produced

Code is complete for A, B, C, for everything in D and E that a provider does not
gate, and for the half of F that does not need a pilot. **Nothing is
integration-verified.** No migration (`0023`–`0033`) has been applied to any
database; no provider account exists; the repository integration tests execute
only in CI. Every SQL claim in this work rests on reading, not on running.

The one thing that changed in F: the deployment can now _say_ that it is not
running. That does not clear `deployment-runtime` — only a real invocation on a
real deployment can — but it turns an unverifiable blocker into a verifiable one.

Six integrations are blocked, and four of them gate a capability the product
appears to offer:

- `malware-scanner-provider` — no document can reach `verified` safety, so no
  package can be approved.
- `document-text-extraction` — no rule can read a document's own words.
- `ai-provider` — the third analysis tier never runs.
- `whatsapp-media-download` — a client's attachment is recorded but never fetched.
- `external-handoff-destination` — no package can be filed.
- `local-postgres` / `deployment-runtime` — nothing has been executed or observed.

The honest reading is that the product is code-complete and integration-zero. F
is where that changes or is confirmed.

## Open blockers

| ID                                                  | Effect                                                                                                                                                                                                            | Cleared by                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BLOCKED_INTEGRATION: malware-scanner-provider`     | Live document scanning stays disabled; the legacy re-scan backlog stays pending                                                                                                                                   | An approved provider, its binding names, its data-handling terms                                              |
| `BLOCKED_INTEGRATION: local-postgres`               | Repository tests run only in CI                                                                                                                                                                                   | A reachable `TEST_DATABASE_URL`, or the CI run on the PR                                                      |
| `BLOCKED_INTEGRATION: external-handoff-destination` | No package can be transmitted to the filing agent; every handoff stays `prepared` and the 回件與異常 work view stays unreleased                                                                                   | The internal server's protocol, address, authentication and rights                                            |
| `BLOCKED_INTEGRATION: whatsapp-media-download`      | A client's attachment is recorded by reference but its bytes cannot be fetched, so inbound media never becomes a document                                                                                         | A documented WOZTELL media-download endpoint and its auth                                                     |
| `BLOCKED_INTEGRATION: document-text-extraction`     | No server-side text extraction exists or can be lifted from the browser code; every rule needing a document's own words is unbuildable, including both date rules                                                 | A Worker-safe PDF text layer (new work), or `nodejs_compat` plus a Node PDF library (a deploy-surface change) |
| `BLOCKED_INTEGRATION: ai-provider`                  | No model reads any document. There is no AI SDK, key binding, adapter or provider-mode gate anywhere in the repository; C-2's provider tier stays disabled and every C-1 version stays without a content identity | An approved provider, its binding names, its data-handling terms                                              |
| `BLOCKED_INTEGRATION: deployment-runtime`           | Whether the 5-minute schedule really fires is still unverified — but no longer unverifiable. `maintenance_runs` records every invocation and `/operations` reports `never-observed` until the first one arrives   | The first row on `/operations` with trigger 排程, from a real invocation on the deployed runtime              |

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

- **No migration has been applied to any database.** `0023`-`0033`. `CLAUDE.md`
  requires explicit authorization for any non-local `DATABASE_URL`, and none was
  given.
- **No branch has been pushed and no PR opened.** Awaiting authorization.
- **Almost no browser walkthrough.** One was done in Phase F, and it is worth
  being precise about what it proved: on a local dev server, `/operations`
  redirects an unauthenticated request to `/login` (so the gate does not depend
  on navigation), and after a demo sign-in the route renders with `<h1>系統運作</h1>`
  and its demo notice. The **production** branch of that screen — the health, the
  queue depths, the run list — has never been rendered, because rendering it
  needs a database.
- **No customer message has been sent**, and nothing in this work can send one.
- **The supplied client workbook is not committed.** The reader was verified
  against it locally and that verification file was deleted; committed fixtures
  are built in code with invented names and ids.

## Records

| File                                                                                 | Holds                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline-and-decisions.md`                                                          | Baseline, architecture, the verified workbook contract, blockers, decisions                                                              |
| `phase-a-report.md`                                                                  | Phase A: defects, changes, commands run, gate status                                                                                     |
| `pilot-measurement-plan.md`                                                          | Phase F: which metrics the system can compute, which need a person, the baseline to collect first, and what a pilot report may not claim |
| `../../runbooks/pilot-operations.md`                                                 | Phase F: the pre-pilot checks, how to read `/operations`, capability pause and rollback                                                  |
| `../../superpowers/specs/2026-09-11-kossilon-phase-f-pilot-operations-design.md`     | Phase F design                                                                                                                           |
| `../../superpowers/specs/2026-09-11-kossilon-next-service-government-mail-design.md` | Phase F4: the proposed next workflow, mapped onto the existing contracts. The choice is unconfirmed                                      |
| `../../superpowers/specs/2026-09-10-kossilon-phase-a-document-safety-design.md`      | Phase A design                                                                                                                           |
| `../../superpowers/specs/2026-09-10-kossilon-phase-b-nar-intake-design.md`           | Phase B design                                                                                                                           |
