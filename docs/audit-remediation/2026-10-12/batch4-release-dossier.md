# Batch4 review candidate and release dossier

Requested scope: R25.2–3 / R27 / genuine isolated cross-role acceptance. The feasible local restore and recovery work is implemented, tested and normally committed in draft PR145. R25 remains **進行中**, R27 **受阻**; native staging **受阻**, release **NO_GO**. Production/outbound hold stays in force. No official migration/deploy, native scheduler invocation, native recovery mutation, account/permission change or customer send occurred.

Exact tested source: **5caa59a3dad927ad05c0e261a4a0fd66d04338f6**. Local module build: **422 files / 14,145,993 bytes**, manifest SHA256 **92f03f028367e3de287c65d08761785c04975ceb2029b14093a869e6d3df56d3**. This is a local build tree; deployed artifact acceptance is pending. The following evidence-only commit retains identical application/test/config source; its exact-head CI is read back in PR145 without rewriting this source receipt.

## Baseline and reused repairs

Batch baseline **8163713095aa0aa3e0531dc5f059a67b1b8ac45c**. Main readback remains **da82677bdeb35b9255425be61bd66abd295f5cc1**. Previous verified production alias source **aa5d3cbddd895bca953b6eef7266ae1cc0b46215** is historical metadata, not this candidate's acceptance. PR145 stays stacked on OPEN/DRAFT PR142, head **9f2483dfd80433afc3df38f99014bb37746c2168**. PR143's independent dependency candidate and merged PR144's security maintenance remain separate; no security candidate was replaced by a broad schema-main rollout. Existing R15–22 workflows, R24 auth handling, R26 readiness, lease/fencing/runtime and provider adapters were reused.

| Commit | Delivery |
|---|---|
| af2a7b468f840b483af2e93df1eb68956ea50fec | Add current R15/R19/R20 scoped readers to the populated READ ONLY restore rehearsal, with real existing SQL role/team evidence and registered integration regression |
| 5caa59a3dad927ad05c0e261a4a0fd66d04338f6 | Reject partial company evidence; portable direct Bun argv; bounded owned child termination and real SQL-lock failure regression; normalize only the CI fixture localhost alias |

No app, scheduler/provider adapter, migration, dependency or lock change in this batch. Installed package/dual-lock receipts are in `batch4-installed-dependencies.json`; CI291 audits both locks with zero vulnerabilities. No force-push, history rewrite, user file reset or other-worktree change.

## Behavior, files and audit IDs

| F / R / UC | Observed result and file reason |
|---|---|
| F01/F17, R25.2, UC57/88/89 | `scripts/audit/rehearse-restored-reads.ts` now exercises Today AR/incorporation/change sources, both business lists and all five company tabs alongside prior queue/AR/docs/payment/history. Select an existing current active Admin SQL row and actual team; never present this DTO as authenticated UAT. `restored-company-evidence.ts` rejects partial summary or subsequent case pages. Actual registered Bun/PG integration verifies both loopback fixture host variants and a held exclusive SQL lock that must fail without an acceptance receipt. |
| F02/F20, R25.3, UC90/91/96 | Existing five safe SQL maintenance passes reused on a newly initialized owned PG17 DB: five persisted started/finished pass receipts; same-slot replay skips all five; expired unstarted lease permits takeover and rejects stale token begin/finish. A committed witness plus lost receipt remains unknown/started after expiry; retry claims zero and performs no duplicate effect. Actual manual runtime evidence is bound to af2, with unchanged runtime bytes through 5c. Native service identity/ticks remain unverified. |
| R25/R23 regression reliability | `src/test/bun-process.ts` directly spawns verified Bun with shell false/windowsHide true, preserves spaces/literal ampersands, and terminates only its owned child after a deadline. Actual child argv, blocked-child termination and SQL lock tests replace the ineffective unbounded synchronous runner. `src/test/db-integration-files.ts` registers the DB test so CI cannot silently skip it. |
| F04/F10/F11/F12/F20, R27, UC53/55/77/85/86/90/95/96/98 | Existing analysis/scanner/WhatsApp/handoff source contracts accepted by the exact plan command: five files / 91 tests / zero skips. No native scan/OCR/AI, WhatsApp delivery or filing receipt was produced. Environment and identity blockers are measured, not replaced by mocks. |
| R23, UC52/55/56/57/58/88 | Fresh full integration suite, build, two viewport demo/parser browser tests, exact-source dual-runtime CI, artifact/index, single review and tracker baseline preservation completed. Genuine role/device/operator and native gates remain open. |

Finance/Reviewer/Ops remain work personas; AuthRole remains Admin/Manager/Staff/Client. Existing SQL and demo profiles do not stand in for genuine cross-role sessions.

## Populated restore and native readback

The owned PG18 public-only restore was started after exact ID/label/loopback checks, used inside **READ ONLY** transactions, then returned **stopped**. Final source5c reads queue2/cases3/documents14/outstanding3/history0; Today2 with all three sources available and partial false; incorporation/change both empty; all five company tabs observed, openCases1/documents2/paymentCases1/activityRows5. Empty tables prove query compatibility, not populated journey acceptance.

All **89 original table projections**, **66 ledger entries** and **four pending outbox rows** remain unchanged. Original backup448,528 bytes, SHA256 **faa5564428634ba5b90b2e4977418333d426b458b44c9c2e90d630960111a794**; original and locally rebound reconciliation packet hashes stay in the index. The 101-table local catalog follows earlier isolated additive reconciliation; no new native reconciliation was applied. Managed Auth/platform services are excluded from this portable public dump.

Fresh native child/production reads were **READ ONLY**. Both have ledger66; native production dispatch marker remains absent. There are113 historical maintenance runs, latest started2026-09-30T01:55:14.448Z, which provides no current-candidate native tick evidence. Only one active consistent staff mapping is a Native Auth Admin, with one unexpired database session record; Client membership has no Native Auth user. Neither record proves a controlled browser login. Exact prior preview816 reaches real login; no credentials were supplied or entered. No claim is made that a different browser session or cookie caused the earlier auth issue.

All original four email outbox items are pending, stored client-origin, source event `annual_return_case_seeded`, with no approval/sent/provider reference. All four recipients match current active work owners. Source classification, consent and approval remain Ops gates; seeded event does not establish fixture status or deletion authority. Values, identifiers and emails remain in private evidence. No row was cancelled or removed.

## Exact tests and environment

Windows Node24.18.0/npm11.16.0/Bun1.4.2. Owned PG17 container56330ed032f6cd999ae55e7399cc8da39da2ec73e237b9ba0f292a85f8ddcb29, task label retained, loopback56433. Fresh final DB `kossilon_staff_batch4_reviewed`,50 migrations/seed3; separate manual-runtime DB `kossilon_staff_batch4_safe`. Full suites never target the populated customer restore. `DATABASE_URL=TEST_DATABASE_URL`, `DATABASE_SSL=disable`, `REQUIRE_INTEGRATION_TESTS=1`, task-local direct `BUN_EXECUTABLE`.

| Exact invocation / private log | Actual result |
|---|---|
| `npm test -- --maxWorkers=2`; full-5caa59a.log | **280 files / 2,431 tests / zero skips**,488.98s, exit0; registered real DB integration ran |
| `npm run build`; build-5caa59a.log | Exit0; local manifest above |
| `PLAYWRIGHT_BROWSER_CHANNEL=msedge; npm run test:e2e:local`; browser-5caa59a.log | **12 passed / zero skips**,42.0s;390x844 /1366x900; local demo/parser, nine historical browser files unchanged |
| `npm run typecheck`; `npm run lint` | Exit0; lint zero errors/two preexisting warnings |
| Exact R25 six-file invocation in batch4-evidence-index.json; r25-plan-baseline.log |74 tests / zero skips,4.38s |
| Exact R27 five-file invocation in batch4-evidence-index.json; r27-plan-baseline.log |91 tests / zero skips,7.45s; source/fixture only |
| Current reader + adjacent real SQL regression; current-readers-green1.log |4 files /28 tests / zero skips,5.80s |
| Single-review repair regression; review-green-final.log |4 files /9 tests / zero skips,9.72s; final added absent-output assertion included in the complete suite |
| `R25_LOCAL_URL=<owned loopback restore>; bun scripts/audit/rehearse-restored-reads.ts <private receipt>` | Final source5c READ ONLY compatibility accepted, sideEffects0; subsequent original projection guard accepted |
| `node scripts/audit/verify-populated-restore.mjs <private original inventory> <private guard receipt>` |89 original projections/ledger/outbox unchanged |
| `bun .worktrees/staff-batch4-20261012/safe-runtime-rehearsal.ts` with exact owned safe DB guard | Actual manual safe SQL five passes/replay/fencing/committed unknown; provider effects0/native ticks0 |
| `npm run verify:audit-release`; `npm run verify:firm -- --dry-run` | Exit0; localLedgerContract PASS / productionReleaseGate NO_GO;39 reads/zero network/zero writes, missing live bindings BLOCKED |

Exact-source **CI291 / run38214795435**: [workflow](https://github.com/YNWAforever/kossilon-hub/actions/runs/38214795435). Node22.23.3 and24.21.0 each280 files/2,431 tests/zero skips; durations489.97s/471.03s and12 browser tests each35.5s/34.7s. Both lock audits, portable npm/security10tests, migrations/seed, types/lint, dry-run/contract gates, browser/build/import/cron checks and aggregate verification succeeded. Step conclusions and log hashes are in `batch4-ci-receipt.json`.

The complete suite also reruns existing two-team/Client A-B synthetic SQL authorization,201-case payment join,1,000 documents,300+300 business lists,101 threads/201 messages,500-row OOXML/import/resume,10k/50k SQL and25-backend measurements. Detailed prior receipts remain in batch2/3. These are local repository/parser checks; genuine hosted roles, operator import and capacity acceptance are still blocked.

## Review and retained failures

One fresh read-only GPT-6.1 Sol review found four material issues; all repaired in one pass. No second review. `batch4-review.md` records exact portability, partial-evidence, argv and timeout findings.

CI290/run38212717493 ataf2 is preserved: both Node legs failed the strict localhost guard before DB execution, with2,424 other tests passed and downstream build/browser skipped. The pre-review local full run was deliberately interrupted. Original missing-reader RED and partial-case false acceptance are retained. Final restore's first restart read failed57P03 because PG was starting; bounded `pg_isready` preceded the successful same-source rerun. No failure is backfilled as pass.

Original **65 UC baseline columns are cell-for-cell unchanged** against93ad5eb; new candidate outcomes remain **56 partial /9 blocked /zero native passes**. Sixteen relevant UC rows append this batch's receipts without erasing historical results. Three other worktrees and both locks retain exact original state. Private raw logs/native inventory and credentials remain ignored; public evidence publishes aggregate facts and hashes.

## Minimum remaining gates and owners

| Gate | Owner | Minimum missing input |
|---|---|---|
| R25.2 native recovery | DB/Release | Approved current recovery point and Auth-compatible isolated target/runtime; exact reviewed forward packet and artifact/schema binding. The sole observed2026-09-29snapshot is historical. No new quota/restore claim is made. |
| Genuine cross-role UAT | QA/Auth/Release | Approved exact-artifact isolated origin/bindings and controlled Admin/Manager/Staff/Client A/B sessions with known team/company scope. No account provisioning or permission mutation was performed. |
| R25.3 native scheduling | Scheduler/Release | One isolated owner/service credential, exact web/worker/schema, three native five-minute ticks over at least ten minutes, per-pass and independent heartbeat receipts. Production owner metadata saysvercel; preview lacks owner/secret. Cloudflare worker inventory remains unverified without worker identity/access. |
| R27 provider closure | Integration/QA/Ops | Scanner URL/key, approved OCR/AI capability and AI URL/key, WOZTELL base URL/token/channel/webhook secret; known-answer corpus, approved namespace/recipient/consent and filing destination/native receipt. Shared R2/Resend config presence is insufficient. |
| Four original outbox rows | Ops | Provenance classification and consent/approval; recipients match active owners, but none approved. Keep hold, reconcile unknown, never blind retry or delete. |
| Native operator/device/capacity | QA/Release | Controlled-role isolated sessions/bindings for500-row operator journey, device/conflict/disconnect/unknown and hosted10k/50k/25-concurrent checks. |

## Rollout and rollback boundary

Review the source/evidence-only PR stack first. Before a native rollout, DB/Release must bind the approved isolated exact artifact, current physical catalog/ledger and current Auth-compatible recovery point, rehearse the forward packet and compatibility reads, and capture write/runtime/roles evidence. Scheduler owner must be exclusive and fenced with native tick receipts. Integration/Ops must complete approved namespace/recipient/provider receipts and classify the original outbox before release or outbound activation. Formal release approval is the final step once these concrete gates are ready; this dossier authorizes no such release.

Local source rollback is a normal revert ofaf2/5c or checkout ofbatch baseline816; keep evidence history, ignored raw receipts, original backup/ledger/outbox and owned witness/unknown receipts. Audit/test-only edits require no down migration. Stop only the owned disposable runtime; PG18 customer restore is already stopped. A future deployed rollback must select a separately verified schema-compatible safe artifact, keep unknown receipts for reconciliation and use forward fixes; never assume old production source or an old snapshot is compatible with new native writes. Security PR144 remains its own release candidate.

Review artifacts: `batch4-evidence-index.json`, `batch4-artifact-manifest.json`, `batch4-ci-receipt.json`, `batch4-environment-receipt.json`, `batch4-safe-runtime-receipt.json`, `batch4-installed-dependencies.json`, `batch4-workspace-guard.json`, `batch4-review.md`; trackers and prior dossiers retained. Remaining work is the named native gates; all presently authorized independent local work in this batch is completed and reviewable.


Environment-package confirmation 2026-10-12T15:59:19.748+08:00: the human user explicitly confirmed the isolated package is not ready and instructed retaining blockers/completing feasible evidence. Minimum owners/inputs above remain unchanged. Final prior-head CI292 decoded-log/step receipt is now public in batch4-head-ci-receipt.json; batch4-environment-confirmation.md records the direct reply and exact evidence limits. This follow-up is evidence-only; it does not establish native acceptance or authorize provisioning/release.


Requested CI293 final readback 2026-10-12T20:52:41.013+08:00: run38220954951 completed success forhead6653ef52ce7dd08c8cdab3563278c483e18cbde3, both Node legs and aggregate, each280files/2431tests/zero skips and12demo/parser browser passes. Full safe step/log-hash receipt and evidence limits are in batch4-ci293-receipt.json / batch4-ci293-verification.md. No source repair or additional native action. This receipt-only follow-up preserves original baseline/outcomes and all release blockers/holds.
