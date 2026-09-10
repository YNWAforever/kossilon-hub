# Kossilon implementation — baseline and decisions

Working record for the A–F implementation described in
`CLAUDE_KOSSILON_IMPLEMENTATION_MASTER_PLAN_v1.md` (supplied by the operating owner,
not committed here). Facts below were verified against this checkout, not taken from
the plan. Where the plan and the code disagree, the code is recorded.

## 1. Baseline established (A0)

| Item | Value |
|---|---|
| Checkout | `kossilon-hub-work` (the authoritative one of five local copies) |
| Branch | `codex/outbox-observability` |
| HEAD | `b2c75f4` — `docs: design for P3-1 outbox observability` (documentation only) |
| `origin/main` | `fa02046` — `Merge pull request #57 from YNWAforever/codex/record-provider-mode` |
| Audit baseline in the plan | `fa02046b4288085851c3c4f3a26805b029306c78` |
| Drift from audit baseline | **None in source.** `origin/main` *is* the audit baseline; HEAD adds one docs-only commit |
| Working tree | Clean |
| Migrations | `0001`–`0022`; next unused number is **`0023`** |

The plan anticipated drift and told us to reconcile findings against current HEAD and
preserve newer fixes. There is no newer source work to preserve on this branch: the
audit was taken at what is still `main`. Every Phase A finding was therefore
re-verified as live code rather than assumed.

Other local checkouts (`kossilon-hub`, `auth-fix-worktree`, `task6-fix-worktree`,
`task7-staging`) are older or feature-specific and are **not** touched by this work.

### Baseline checks actually run

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass** (exit 0) |
| `npm run test` | **1 failed, 959 passed, 141 skipped** (135 files) |

The single failure is pre-existing and environmental, not a code defect:
`vite.config.test.ts > injects source locations before TanStack recompiles route files`
times out against Vitest's 15 s default after taking 28.4 s on this Windows machine
(cold Vite plugin resolution). It is unrelated to any Kossilon phase and is not
"fixed" by this work; CI runs the same test on Linux.

The 141 skipped tests are the `describe.skipIf(!databaseUrl)` repository integration
tests across 10 files. See the blocker in §4.

## 2. Architecture to preserve

Confirmed present and to be extended, never replatformed:

- TanStack Start/Router/Query, React 19, Vite, TypeScript strict, Tailwind v4, shadcn/ui.
- Postgres through `postgres.js`, raw tagged-template SQL, no ORM; numbered forward-only
  migrations in `db/migrations/`.
- Neon Auth (`better-auth/client`), `staff_profiles`, `client_company_memberships`.
- R2 document storage with opaque keys, checksums, quarantine, upload intents.
- WOZTELL WhatsApp adapter, signed webhook, `notification_outbox`, retries, receipts.
- The demo/production `dataMode` split (`docs/adr/0001-demo-mode-is-read-only.md`).

### Two in-repo patterns the plan asks us to invent, which already exist

Both are reused rather than duplicated.

**Durable job queue** — `notification_outbox` + `src/features/notifications/outbox.ts`
already implements exactly what plan §10.4 specifies: `claimDue` with
`for update skip locked`, `attempt_count` incremented at claim time and used as a
**fencing token** in every terminal write (`markSent`/`markRetry`/`markFailed` all
match on `attempt_count = ${claimed}` and return `false` when superseded), exponential
backoff capped at one hour (`nextRetryAt`), a `processing` visibility timeout that
reclaims rows stranded by a killed Worker, and `on conflict (idempotency_key) do nothing`
enqueue idempotency. Document scan jobs mirror this shape; no second queue mechanism
is introduced.

**List scope paired with a by-ID counterpart** — `src/features/annual-return/permissions.ts`
already pairs `caseFiltersForActor` (list narrowing) with
`isAnnualReturnCaseVisibleToActor` / `assertAnnualReturnCaseVisible` (the single-case
counterpart), including the deliberate escape hatch that an owner or reviewer may read
a case outside their team because they may act on it. Documents have only the list
half (`documentFiltersForActor`, added by P0-5). Phase A adds the missing by-ID half
in the same shape.

## 3. Supplied-workbook contract, verified against the actual file

`NAR Monthly_Working (1).xlsx` was parsed cell-by-cell from its OOXML (types, style
number-formats and shared strings) rather than through any library. The original is
**not** committed; a sanitized fixture preserving structure and edge cases is.

Confirmed exactly as the plan states: sheet `8.2025`; title `Annual Return 2025` in A1;
header row 2; 35 records at `A3:H37`; `date1904` false; A7 is a single space; D37 is
`30/8`; H7 is the text `5/9/2025`; F23 is `27/8/2025 (Ceredit fr deposit)`; F8/F29/F32
are `(Nil)`; F17 is blank; column H has **11** blanks; column B has 35 values, all distinct.

Three facts the plan does not record, all found in the file and all load-bearing:

1. **`dimension` is `A1:CO65`** — rows 38–65 exist in the sheet XML carrying formatting
   and no values, and the sheet is 93 columns wide. A naive importer that counts `<row>`
   elements gets **65**, not 35. This is precisely what the B gate's "zero extra
   formatted rows" is testing for.
2. **Invoice numbers are not unique.** `IAHK-25-07071` appears on both row 14
   (`K13785`) and row 28 (`K12826`) — two different companies, one invoice number.
   Column E can therefore never be an import identity or a dedupe key.
3. **The anniversary-plus-42 pattern holds for 34 of 35 rows, not all 35.** Row 27
   (`K13791`, D = `27/08`) has an AR due date of **2025-10-07**, while
   2025-08-27 + 42 days is 2025-10-08. Recomputing column G from column D would
   silently corrupt one real record. This is direct evidence for the plan's rule that
   the supplied due date is preserved with its provenance and never overwritten.

Also observed: `(Nil)` in column F always coincides with `(Nil)` in column E (rows 8,
29, 32); E31 carries an `R` suffix (`IAHK-25-07010R`); and row 18's payment date
(2025-11-05) falls after its AR due date (2025-09-29) — a live instance of the case the
plan warns must not be read as late filing.

## 4. Named blockers

Recorded against the exact unavailable dependency, per plan §1.2. Independent work
continues around each; the affected capability stays disabled.

| ID | Blocker | Effect | What would clear it |
|---|---|---|---|
| `BLOCKED_INTEGRATION: local-postgres` | No local Postgres. Docker Desktop is installed but its `com.docker.service` is **Stopped** and starting it needs elevation this session does not have; nothing listens on 5432. | The 141 `describe.skipIf(!databaseUrl)` repository tests cannot run locally, including the new Phase A concurrency tests. They are written and pushed so CI (which provisions `postgres:17-alpine`, migrates and seeds) executes them. **Skipped is recorded as skipped, never as passed.** | A running Postgres reachable as `TEST_DATABASE_URL`, or the CI run on the PR. |
| `BLOCKED_INTEGRATION: malware-scanner-provider` | No scanning provider is configured or named by the operating owner. | The live scanner adapter is implemented against a real content-inspecting interface and contract-tested in isolation, but the live capability stays disabled and refuses to start rather than falling back. | An approved provider, its endpoint binding name and its data-handling terms. |
| `BLOCKED_INTEGRATION: deployment-runtime` | Source targets Cloudflare Workers with a 5-minute cron (`wrangler.template.jsonc`, `src/server.ts` `scheduled`); the URL supplied in the plan is on Vercel. Which runtime actually executes the schedule cannot be determined from source. | Scan jobs are enqueued durably and drained by the existing `runFirmMaintenance` entry point, which is trigger-agnostic by design. Whether that entry point is really invoked on the deployed runtime is unverified. | Deployment evidence: a real scheduled invocation observed on the actual runtime. |

Providers, accounts and folder access named in later phases (AI, WeChat/WeCom, group
messaging, the internal file server) are not yet in scope and are tracked in
`integration-readiness.md` when their phase begins.

## 5. Decisions taken

1. **Work on a new branch off `main`**, `codex/kossilon-phase-a`, per the repository's
   `codex/<feature>` convention and the Lovable constraint against rewriting pushed
   history. HEAD's docs-only commit is preserved; nothing is force-pushed or rebased.
2. **Scan jobs get their own table rather than rows in `notification_outbox`.** The
   outbox's `NOT NULL` `channel` check constrains it to `email`/`whatsapp`/`in_app` and
   its redaction constraint is built around a recipient and payload; a scan job has
   neither. The *mechanism* (claim/lease/fence/backoff) is copied; the table is not
   overloaded. This follows the plan's "extend the existing job conventions" while
   avoiding a channel enum lie.
3. **Upload-intent expiry and received-quarantine retention become separate columns**,
   because they are separate facts with different owners: an abandoned intent may be
   swept in minutes, a received file must survive a scanner outage. See
   `phase-a-report.md` for the migration.
4. **Legacy documents scanned by the deterministic scanner are treated as
   unknown-safety, not clean.** Their bytes and every historical staff decision are
   preserved; a genuine re-scan is scheduled. No artificial clean verdict is
   grandfathered into permission to preview or release a file.
5. **The demo/production split is not weakened to make anything pass.** No production
   route gains a demo store, and no guard, gate or test is relaxed.

## 6. Open inputs awaiting the operating owner

These do not block implementation; each has a safe default recorded in code.

| Input | Safe behavior now |
|---|---|
| External system name, client-ID mapping and export format | Manual export/import; unresolved rows stage rather than create companies |
| Meaning of `(Nil)`, blank BR dates, deposit-credit notes | Preserved verbatim with provenance; never mapped to paid/unpaid |
| Which deadline the 1-month/14-day/7-day reminders anchor on | Configurable versioned policy; reminders stay off for unconfirmed cases |
| Per-person document applicability, address-proof reference date, waiver authority | Versioned template with explicit unresolved applicability |
| Scanner and AI providers, and permitted data handling | Real adapters, capability disabled until configured |
| Actual WhatsApp/WeChat accounts, groups and conversation access | Manual routes with explicit per-capability states |
| Internal server protocol, folder rights, returned-file meaning | Reconciliation UI plus a transport interface against a local fixture |
