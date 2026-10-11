# Batch2 review candidate and release dossier

Scope: R25.2, R16→R17, R21 and R26.5 / UC97; incremental candidate in PR145 on codex/staff-remediation-20261012. Tested code source: b25575e762b9be953669ecd662290c0b5fe24f49. Exact-code CI275 passed; the final evidence-only PR head receives its own CI readback in PR145. Production/outbound hold and release NO_GO remain; no migration, deployment, account/permission change, native scheduler invocation or customer send is authorized by this evidence.

## Baseline and commit chain

Fresh readback: main da82677bdeb35b9255425be61bd66abd295f5cc1; production alias aa5d3cbddd895bca953b6eef7266ae1cc0b46215. PR142 remains open at9f2483dfd80433afc3df38f99014bb37746c2168 and is PR145's stack base. PR143 remains open at01b56fa2efd719209c1f9a36ee9cab6cb9b70d3e. PR144 was merged on the separate security base at2063d08272a647f8475b3e43aaa0b2e203b254b2; neither main nor live moved. Their fixes were reused, not rewritten.

| Commit | Delivery |
|---|---|
| 96fa928d0204b5bb3da00e3b265c06453c3d9489 | R16 authorized bounded Queue SQL, totals and validated Queue/Clients return state |
| cb9c465d13ab5c44f8696c3074238f43da76108c | R25.2 populated public restore/reconciliation and immutable data receipts |
| 64cb41e43a1428946490c622af7a49889c8a7669 | R17 global document scope and joined payment/debt workspace |
| dac2c30b571ad175eb1125080dce4563c6d43757 | R16 limit authorized IDs before fact joins; actual25-backend capacity |
| 640bc26b2301351948be8d49cc311e59b9c675ad | R21 authorized complete history/search, retained pages and precise timestamp order |
| 3a3a4a50625a2c48714259b02493dc8f8998b1fb | Real500-row OOXML parser/mapping/apply/replay regression, existing importer reused |
| 6d21114bbd7ff5511db47933c0da88c521861c3f | Whole-branch review: shared mine owner, global bounded facets, document50 gate and truthful debt label |
| dcab54d686bb1b9669793556896997eeb9b55474 | Public Client/Today/AR50 cap, affected callers and cancellable50k traversal |
| b25575e762b9be953669ecd662290c0b5fe24f49 | UTF8 cursor encoding/decoding; Chinese distinct facets paginate safely |

The final code/artifact receipts are recorded in batch2-evidence-index.json and batch2-artifact-manifest.json. Normal commits/pushes only; first-batch evidence remains immutable. Original65UC fields and denominator are preserved; new results occupy execution columns. CSV preservation and other-worktree guards are separate receipts.

## Behavior and changed files

| F / R / UC | Source delivery and purpose | Files / evidence |
|---|---|---|
| F01/F02/F17/F20/F21, R25.2, UC57 (partial) | Owned local public restore, row/catalog/ledger equivalence, guarded additive local reconciliation and actual READ ONLY candidate reads | scripts/audit/verify-populated-restore.mjs, rehearse-restored-reads.ts; batch2-restore.md, batch2-restore-receipt.json, batch2-restored-runtime-final.json |
| F27/F28, R16, UC36/37/56/67/72/73 (partial) | Scope/filter precede51-ID boundary, default/max50, global count and tie breaker including nullable historical SLA. URL q/filter/sort/cursor/return anchor retained; missing anchor prompts reselection. Separately authorized searchable owner/type facets include later rows. Public Client/Today/AR page boundaries and affected Portal/picker callers align50 | work-items/{repository,server-fns,queue-page,queue-scope,queue-filter-options}.ts; lib/{list-page,list-navigation,use-retained-page}; routes/work-queue; Clients register/server/repository; annual-return/server-fns; batch2-r16.md and capacity before/after.json |
| F15/F29, R17, UC38–40/53/79 (partial) | Global document search/count/snapshot share predicate; current review proof rows join their case/payment/readiness hash. Outstanding cases include no-proof cases and credit only verified posted evidence. Approvals still require current source version, genuine scan, locks and existing safety gates | documents/{list-scope,repository,server-fns}; payment-workspace{-repository,-scope}.ts, readiness-repository shared payload; routes/documents, production-payment-review; Portal/scoped-pickers; batch2-r17.md |
| F33, R21, UC48 (partial) | Complete authorized contacts/messages in50-row cursor pages; shared-contact foreign messages excluded, global search and full same-thread transcript. More/retry retains rows; prepend preserves scroll; new message banner does not switch selection; actor cache scope resets | whatsapp/history-{page,repository,server-fns}.ts, conversations.ts, production-whatsapp-inbox.tsx and regression fixtures; batch2-r21.md |
| F09, R26.5, UC75/84/97 (partial) | Existing guarded importer/journal accepted locally through genuine500-row ZIP/OOXML. Mapping/preview writes no case/payment; interruption, rolled-back row error, resume, same-key replay and newly reviewed no-op replay preserve exactly500 cases/work/payment records | src/test/xlsx-fixture.ts; nar-import/monthly-workbook-fixture.ts and apply.integration.test.ts; batch2-nar500.md |

All AuthRole values remain Admin/Manager/Staff/Client. Finance/Reviewer/Ops are business personas; synthetic test DTOs never represent genuine authenticated sessions. Internal legacy adapters retain separately bounded contracts; the newly used public paged APIs cap50. No new source schema migration or dependency/lock change in batch2.

## Exact local checks

Environment: Windows, Node24.18.0/npm11.16.0, task-local Bun1.4.2, owned localhost Docker PostgreSQL17 for synthetic writes/capacity and PostgreSQL18.6 for the restored public database. DATABASE_URL and TEST_DATABASE_URL point to the same owned disposable fixture; DATABASE_SSL=disable and REQUIRE_INTEGRATION_TESTS=1 for final suites. Only the restore reads use R25_LOCAL_URL and READ ONLY; full suites never point to restored customer data.

| Exact invocation | Actual result / evidence |
|---|---|
| npm test -- src/features/work-items/queue-pagination.integration.test.ts src/features/work-items/server-fns.test.ts src/features/bulk-operations/repository.integration.test.ts src/routes/-work-queue.interaction.test.tsx src/features/clients/components/production-client-register.interaction.test.tsx src/lib/list-navigation.test.ts --maxWorkers=4 | 31pass0skip; nullable-SLA extra1pass0skip; final full suite includes both; r16-green-final.log |
| npm test -- src/features/annual-return/payment-workspace.integration.test.ts src/features/annual-return/payment-review.integration.test.ts src/features/annual-return/readiness.integration.test.ts src/features/documents/global-search.integration.test.ts src/features/documents/repository.integration.test.ts src/features/bulk-operations/repository.integration.test.ts src/routes/-payments.interaction.test.tsx src/routes/-documents-production-data.test.tsx --maxWorkers=4 |8files95pass0skip (r17-final.log); final document page contract changes100→50 |
| npm test -- src/features/whatsapp/history-pagination.integration.test.ts src/features/whatsapp/conversations.test.ts src/features/whatsapp/components/production-whatsapp-inbox.interaction.test.tsx --maxWorkers=4 |3files36pass0skip. Microsecond-order RED subsequently fixed and included in34-test broader regression |
| npm test -- src/features/nar-import/apply.integration.test.ts --maxWorkers=4 |24pass0skip in83.43s; source-only500-row rehearsal, not native Manager UAT |
| npm test -- src/features/work-items/queue-capacity.integration.test.ts src/features/work-items/queue-pagination.integration.test.ts src/features/whatsapp/conversations.test.ts src/routes/-production-authorization.test.ts src/features/annual-return/components/production-whatsapp-automation.interaction.test.tsx src/routes/-today.interaction.test.tsx --maxWorkers=4 | 6files34pass0skip; last-regressions-attempt1.log |
| npm test -- src/features/work-items/queue-review.integration.test.ts src/features/documents/global-search.integration.test.ts src/features/work-items/server-fns.test.ts src/routes/-work-queue.interaction.test.tsx src/routes/-documents-production-data.test.tsx src/routes/-payments.interaction.test.tsx src/routes/-today.interaction.test.tsx --maxWorkers=2 | 7files35pass0skip; review-green-attempt1.log |
| npm test -- src/features/documents/server-fns.test.ts src/features/work-items/queue-review.integration.test.ts src/features/documents/global-search.integration.test.ts src/routes/-work-queue.interaction.test.tsx src/routes/-payments.interaction.test.tsx --maxWorkers=2 | 5files39pass0skip; review-green-final.log |
| npm test -- src/features/annual-return/server-fns.test.ts src/features/annual-return/components/scoped-pickers.interaction.test.tsx src/routes/-portal-identity.interaction.test.tsx src/features/clients/components/production-client-register.interaction.test.tsx src/routes/-work-queue.interaction.test.tsx --maxWorkers=2 | 5files33pass0skip; public-callers-complete.log |
| npm test -- src/features/annual-return/scale.integration.test.ts --maxWorkers=2 |1file2pass0skip,241.59s (scale-final.log);50,000 documents traversed through1000 capped pages without duplicate/omission; original10k case/tail assertions retained |
| npm run typecheck; npm run lint |Both exit0 on final code (utf8-types.log / utf8-lint.log); lint0errors/two preexisting warnings |
| npm test -- --maxWorkers=2 on a newly migrated/seeded owned DB |Exit0:260files/2390tests/0skips,450.37s (full-suite-utf8final.log); earlier runs below remain failures/incomplete |
| npm run build; npm run verify:audit-release |Both exit0 (final-build.log / final-release-gate.log); localLedgerContract PASS, productionReleaseGate NO_GO. Cloudflare-module build397files/13,892,243bytes; no deployed-artifact claim |
| R25_LOCAL_URL=owned localhost; bun scripts/audit/rehearse-restored-reads.ts OUTPUT; node scripts/audit/verify-populated-restore.mjs PRIVATE_INVENTORY OUTPUT |READ ONLY queue2/cases3/documents14/debt3/owner facets2; payment proof0, threads0 and empty-contact message query0. This exercises SQL compatibility, not populated native/Auth history acceptance. All89 original table projections,66ledger and4pending outbox remain unchanged |

The final full-suite fixture was freshly migrated/seeded (utf8final-db-migrate.log / utf8final-db-seed.log:50 source migrations committed,3 companies/cases seeded). Exact final PowerShell environment and invocation:

```powershell
$env:DATABASE_URL='postgres://postgres:local-batch2-fixture-only@127.0.0.1:56433/kossilon_staff_batch2_utf8final'
$env:TEST_DATABASE_URL=$env:DATABASE_URL
$env:DATABASE_SSL='disable'
$env:REQUIRE_INTEGRATION_TESTS='1'
npm test -- --maxWorkers=2
npm run build
npm run verify:audit-release
```

Final-code restored readback was rerun on b25575e after the complete suite/build:

```powershell
$env:R25_LOCAL_URL='postgres://postgres:local-r25-restore-only@127.0.0.1:56434/restored_public_retry'
& '.worktrees/staff-runtime-20261012/node_modules/.bin/bun.cmd' scripts/audit/rehearse-restored-reads.ts docs/audit-remediation/2026-10-12/batch2-restored-runtime-final.json
node scripts/audit/verify-populated-restore.mjs .worktrees/staff-batch2-20261012/clone-private-inventory.json .worktrees/staff-batch2-20261012/post-b255-reads.json
```

Both exit0; the original89 table projections/66 ledger and4 pending outbox remain identical. Credentials above belong solely to the task-owned local containers. The private input/output inventories and dump remain local.


Final build digest: f78e6b9e0a68f71a0bf20020570bd7131a5f987001c04930e38e2f52c4b861a0 (SHA256 over the manifest's sorted path/bytes/file-SHA list). Both locks match first-batch hashes byte-for-byte; installed packages and preserved other worktrees are in batch2-installed-dependencies.json / batch2-workspace-guard.json. Raw private logs/dumps remain under the task-local evidence directory;130log SHA/size/command/result receipts are in batch2-evidence-index.json.

Exact code CI: [run38175141879](https://github.com/YNWAforever/kossilon-hub/actions/runs/38175141879), Node22/Node24 each260files/2390tests/0skips and12local demo/parser browser tests. Both lock audits, portable npm install, fixture migrations/seed, lint/types, build, dev import boundaries, cron-handler and aggregate verify steps passed. batch2-ci-receipt.json retains actual output and step conclusions. Browser evidence uses390px/1280px local demo identities;1366px and genuine Auth journeys remain outstanding.

Original65UC history is unchanged, verified against first-batch evidence5563bd48253f42a9d9fa179c826de8ca4b8b95bc. New execution columns:43partial/10blocked/12not-tested,0fully completed native scenario passes. A previously blocked or untested UC now marked partial has explicit local SQL/component evidence and its remaining Auth/provider/browser blocker. No baseline result was upgraded.

Local capacity before→after:10k warm p95 301.24→139.26ms;50k 1962.65→371.28ms. At each size25 distinct PG backend connections,200 warm samples and20 fresh-connection samples;50k response<=61,447bytes,50rows,0errors. These are repository SQL measurements; fresh connection is not app cold start. Five-endpoint hosted HTTP/Auth/cold-warm acceptance remains open. Retained plans and ephemeral-ID-redacted receipts allow independent comparison.

## Failures, skips and whole-branch review

See batch2-review.md: one fresh reviewer,0Critical/3Important/1Minor, all actionable findings fixed in one pass; no second reviewer. Later full regression additionally found old200-row scale expectations and two100-row document callers. All discovered callers moved to50. Empty Portal search omits q, because the existing AR schema rejects an empty q. Public boundary tests reject51 before the repository read.

Final UTF8 regression reproduced InvalidCharacterError when a Chinese distinct facet entered the next cursor. The shared cursor now converts JSON through TextEncoder/TextDecoder before base64, preserves earlier ASCII cursors and rejects invalid UTF8.62authorized work types (60Chinese) paginate50+12 uniquely; changed scope remains rejected. Exact command is recorded by utf8-green.log:7files7tests0skip; both RED logs retained. The dcab54d local full run was interrupted when this new edge was found, and is not PASS. Final b25575e full suite was run after fixes without source changes.

Retained failures include missing total/new module RED, lazy SQL observer fragment failures (fixed without weakening locks), microsecond ordering RED, wrong500-versus1000 journal expectation, missing-role restore attempts and unsupported/quota-limited native snapshots. Focused initial500 selection had22 deliberately unselected/skipped tests; it is not accepted integration evidence. Final full suites require0skips.

The first local whole run had31failures/2353passes: three direct postgres test clients interpreted DATABASE_SSL=false as require TLS; other failures were a cursor-error contract, renamed history authorization assertion, microsecond test being added during the run and one-second UI waits. Correct disable value, matching contract/authorization assertions and precision fix were applied. Subsequent3a3a4a5 local run recorded Today1s and500-row120s timeouts, then was interrupted for the review fixes. Whole6d21114 run was interrupted after the legitimate50 cap rejected the old200-document scale request. Its exact-head CI38173177642 likewise failed only that old scale assertion:2387pass/1fail,0skips on Node24. Earlier3a3a4a5 CI38172118500 passed258files/2384tests0skips on both Node22/24, but is historical evidence only.

The complete50-row scale traversal requires1000 rather than250 document pages; a local120s timeout and10s teardown timeout were retained. Test budget300s plus guardSqlTestLifetime/context signal and awaited pending rollback now protect the fixture on cancellation. 500-row multi-pass rehearsal budget240s; Today query notification wait5s. Correctness, authorization, source-version and safety assertions remain. These budgets are not performance PASS thresholds.

## Remaining minimum gates / owners

| Gate | Owner / minimum missing item | Status |
|---|---|---|
| Native platform/Auth restore |DB/Release: available native recovery point/quota and an approved isolated platform/Auth restore target; public-only dump excludes Auth/platform/provider objects |受阻 |
| Genuine role/revocation and390px/1366px journey acceptance |QA/Auth: isolated candidate origin/exact deployed SHA and real Admin/Manager/Staff/ClientA/ClientB sessions; Finance/Reviewer/Ops persona assignments using existing roles |受阻 |
| Scheduler compatibility |Scheduler/DB: exact same compatible web/worker schema, sole scheduler owner/lease/fencing, per-pass receipts and3native ticks over>=10minutes; writable restored-runtime rehearsal |待開始/受阻 environment |
| Native scan/OCR/AI/storage and WhatsApp/filing receipts |Provider/Ops: scoped test credentials/storage namespace plus explicitly approved test recipient and filing target; genuine scanner/version/checksum and delivery/final receipt readback |受阻 |
| Original4pending outbound rows |Ops: source/provenance, intended recipients and consent/authorization; reconcile unknown outcomes before any retry |hold |
| Hosted capacity |QA/Perf: same-region candidate topology/DB and25real concurrent users across Today/Queue/Documents/Payments/client search; cold/warm, response bytes, SQL/count/plan samples |待驗收 |
| Supplied-business-workbook operator acceptance |Admin/Manager owner: approved real500-row namespace/workbook and genuine role mapping/preview/apply session; local invented OOXML remains contract evidence |待驗收 |
| Deployed independent security artifact |Security/Release: installed/deployed SBOM and production-runtime readback of the separately scoped PR144 candidate; no wholesale schema main promotion for security |待驗收 |

R15/R19/R20/R18.2–3/R22/R27 remaining deliveries stay open in the trackers; they are not silently completed by this batch. Remaining missing evidence is not replaced with mock/provider HTTP200, Git merge or old acceptance ledger68tests.

## Rollout and rollback packet

1. Keep PR145 draft/stacked on PR142. Source/fixture/CI review can proceed independently of native gates. Main/live remain unchanged; do not promote this UX/schema candidate for independent security maintenance.
2. DB owner supplies a native recovery point and isolated Auth-compatible target. Re-run immutable catalog/data/ledger checks, authorize an exact compatible reconciliation packet and rehearse its restore/writable runtime there. The local rebounded-ordinal packet is not a production migration packet.
3. Attach the exact compatible web/scheduler artifacts to that target with outbound hold, one owner/lease/fencing and receipts. Run genuine role/browser/capacity tests. Provider/Ops approve only a concrete test namespace/recipient and verify native receipts.
4. Production release approval must bind exact artifact/source/schema/scheduler owner, backup/recovery point and recipient/provenance decisions. This session has not requested or consumed that approval; these gates must finish first.
5. Roll back source through normal revert(s) or a compatible previously verified security artifact. Do not reintroduce full hydration or bypass current actor/safety/version checks. Preserve original ledger, journals, successful side effects, unknown outcomes and receipt records; no blind down migration.

Disposable PG17 fixture may be stopped only after its exact container ID/ownership label is checked; the populated PG18 restore and native child are retained for DB review with private backups. No fixture-like customer row was deleted. Native child deletion/recovery-point pruning needs DB owner authority; no cleanup of unrelated databases or user changes.
