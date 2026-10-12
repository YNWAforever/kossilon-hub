# Batch3 review candidate and release dossier

Requested scope: R15 / R19 / R20 / R18.2–3 / R22. All five source deliveries are implemented, normally committed and locally verified in draft PR145. Task state is **待驗收**; native staging is **受阻** and production release remains **NO_GO**. Production/outbound hold remains in force. No official migration/deployment, real account/permission change, scheduler invocation or customer send was performed.

Exact tested source: **d332cd2c0e8bc59971be66e8f42f8ffb1bd7f08c**. Local Cloudflare-module build: **422 files / 14,146,965 bytes**, manifest SHA256 **25891030962b0ed9010f48c90c420f7d51c41f64ff0ca2e5739777e19a501592**. The manifest hashes the sorted path/bytes/file-SHA list; it identifies this local build, not a deployed Vercel artifact. The subsequent evidence-only commit has the same application/test/config files; its CI readback is published in PR145 after normal push.

## Baseline, reused candidates and commit chain

Batch baseline93ad5eb8dee82ed28b48856dc27efa5bcbafa28e. Fresh session readback: main da82677bdeb35b9255425be61bd66abd295f5cc1; production alias source aa5d3cbddd895bca953b6eef7266ae1cc0b46215, deployment dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT (READY is deployment metadata only). Neither source was promoted. PR142 remains OPEN/DRAFT at9f2483dfd80433afc3df38f99014bb37746c2168 and is PR145's stack base; PR143 remains OPEN/DRAFT at01b56fa2efd719209c1f9a36ee9cab6cb9b70d3e. PR144 was merged on its separate security base, head d53acdf13c4915fabcf54334322d64f8a7fb473d / merge2063d08272a647f8475b3e43aaa0b2e203b254b2; it did not change main/live. Existing scope, document/readiness/payment, immutable snapshot, worker/lease, template and importer contracts were reused.

| Commit | Delivery |
|---|---|
| d5615be4be737fda895af260c210a2b42b317cc6 | R20 incorporation/shared bounded list contracts |
| cdebdb6cb3a423bb893cce34494f74f572fa6e00 | R20 corporate-change lists, actor policy and create dialog |
| 348b94e6afe29d196d1dc34ed8edd38642aa3539 | R15 mixed-business daily read model and retained UI |
| 53c1973aa8a0112ac666897cb89a95429aabaa25 | R19 company workspace and lawful contextual links |
| 60202a6e16cf84f76645e33e14d12fe9418ee00b | R18 full-filter snapshot, labelled job center and recovery regressions |
| 3bf8d8ecdd278e2fd48c21de67251740c83ed52e | R22 scoped handover receipts, roles, settings and ownership inventory |
| 124ce31cb306783327faa536e8f75bc4c2ca5742 | Whole-batch review repair: lifecycle locks, Admin resource-team handover, definite refusal and C cursor ordering |
| d332cd2c0e8bc59971be66e8f42f8ffb1bd7f08c | R14 fixture creators use a verified Admin for cross-team setup; negative read assertions retained |

Evidence commits between these source commits retain each small batch's RED/GREEN outputs and tracker updates. All pushes are normal; no history rewrite. No dependency/lock/schema migration change in batch3. Both locks and installed package versions are bound in batch3-installed-dependencies.json; exact-source CI audits both locks with zero vulnerabilities.

## Behavior, files and audit IDs

| F / R / UC | Result and reason | Changed file groups / original evidence |
|---|---|---|
| F26/F19, R15, UC34/54/68 | Today reads scoped AR/incorporation/change work with real owners, blocker and safe next-action links. Mine includes owner/reviewer scope; Manager/Admin may use policy-approved team. Five existing AR categories remain. Partial source failures and unsupported/demo sources are explicit; counts/cursors are actor/query/day/coverage bound. No new workflow writes or approval shortcut. | daily-work/{types,repository,server-fns,view-state}, components/daily-work-screen; annual-return/work-view-repository; routes/today and interaction tests; batch3-r15.md/tests.json |
| F31, R19, UC45/76 | UUID-bound company overview/cases/documents/payments/activity, separately bounded active tabs and validated URL state. Linked incorporation only; names never infer ownership. Current authority/team, current document metadata and debt are rechecked; metadata-only links explain repair rather than fake download. Client identity cannot read the staff summary. Legacy client maintenance stays usable without full case/document hydration. | clients/company-workspace*, company-workspace-screen, repository/server-fns/production-client-detail; documents/server-fns and route; list-navigation; batch3-r19.md/tests.json |
| F32, R20, UC46/47/82/83 | Real scope-before-pagination/count/search over300 incorporation and300 change fixtures. Unfinished/history, Mine/team/overdue, real owner and truthful missing-deadline/unassigned capabilities; corporate effective date is not a filing deadline. Create-company picker belongs inside the dialog. Open/back retains URL filters; original writes remain guarded. Company cursor keys explicitly COLLATE C. | incorporation and corporate-changes list-page*, repository/server-fns/components and routes; business-list-controls, business-list/navigation/actor; batch3-r20.md/tests.json |
| F30/F13 plus retained F35, R18.2–3, UC41–44/55/59/94 | Full server-filter snapshot works without loading all rows:1000 authorized documents/page50, exclude2=>998 preview,997 eligible/1 locked; foreign rows and late additions excluded. Job center labels operation/scope/actor/time, links and safe exports; visible polling/backoff/focus/terminal rules. Heartbeat remains unknown; persisted worker receipt time is separate.1000-item interruption/lease takeover yields1000 unique effects.50 mixed47 success/1 conflict/1 retryable/1 unknown retains successful effects and reconciles unknown before recovery. | bulk-selection-toolbar; bulk-operations/types/repository/job-view/components/bulk-job-center; routes/bulk-jobs/documents; batch3-r18.md/tests.json. F35 two-of20 baseline remains in earlier dossier/tests and full suite. |
| F34/F19/F13, R22, UC49–51/54 | Imports/Admin navigation and direct-route denial align. Before disable/team/Client changes, fresh inventory includes AR owner/reviewer, work, business cases, companies and unresolved jobs. Explicit handover uses current resource-team recipients, revision/hash/same-key durable receipts, conflict re-preview and unknown receipt reconciliation. Definite pre-write refusals permit refreshed confirmation. Verified active profile/user row locks fence creation against deactivation. Last Admin and template versions/current case snapshots remain protected; B's conflicted edits stay available. Primary controls44px and wrap; support errors are safe. | admin/business-handover*, repository/server-fns/types/production-staff-admin; clients/incorporation/corporate-changes ownership writes; navigation/imports/settings; staff-copy.zh-HK; existing checklist-template regression reused; batch3-r22.md/tests.json and batch3-review.md |

AuthRole remains Admin/Manager/Staff/Client. Finance/Reviewer/Ops are business personas. SQL fixture profiles, local demo roles and Admin fixture creation are not genuine cross-role authenticated acceptance.

## Exact final checks and environment

Windows Node24.18.0/npm11.16.0/Bun1.4.2. Owned PG17 container56330ed032f6cd999ae55e7399cc8da39da2ec73e237b9ba0f292a85f8ddcb29, label codex.task=staff-batch2-20261012, localhost56433. Fresh final DB **kossilon_staff_batch3_verified**,50 source migrations and3 seeded companies/cases. DATABASE_URL=TEST_DATABASE_URL; DATABASE_SSL=disable; REQUIRE_INTEGRATION_TESTS=1. Full tests never target the populated customer restore. PG18 restore remains stopped; its batch2 compatibility evidence is historical and does not establish new native candidate compatibility.

```powershell
$env:DATABASE_URL='postgres://postgres:local-batch2-fixture-only@127.0.0.1:56433/kossilon_staff_batch3_verified'
$env:TEST_DATABASE_URL=$env:DATABASE_URL
$env:DATABASE_SSL='disable'
$env:REQUIRE_INTEGRATION_TESTS='1'
npm test -- --maxWorkers=2
npm run build
$env:PLAYWRIGHT_BROWSER_CHANNEL='msedge'
npm run test:e2e:local
```

| Invocation / retained log | Actual result |
|---|---|
| npm test -- --maxWorkers=2; full-source-d332cd2.log |277 files /2424 tests /0 skips,450.11s, exit0; real registered integration files ran |
| npm run build; build-d332cd2.log |Exit0; local artifact manifest above |
| npm run test:e2e:local; browser-d332cd2.log |12 passed /0 skips,34.9s; mobile390x844 and desktop1366x900, Edge local demo/parser;9 historical evidence files byte-for-byte unchanged |
| npx vitest run src/features/daily-work/repository.integration.test.ts src/routes/-today.interaction.test.tsx |2 files /5 tests /0 skips,3.40s |
| npx vitest run src/features/clients/company-workspace.integration.test.ts src/features/clients/components/production-client-detail.interaction.test.tsx |2 files /10 tests /0 skips,2.92s |
| npx vitest run src/features/incorporation/list-page.integration.test.ts src/features/corporate-changes/list-page.integration.test.ts |2 files /2 tests /0 skips,1.58s; each traverses its300-row fixture |
| npx vitest run src/features/bulk-operations/repository.integration.test.ts src/features/bulk-operations/actions.integration.test.ts src/features/bulk-operations/membership.test.ts src/features/bulk-operations/components/bulk-job-center.test.tsx src/components/bulk-selection-toolbar.test.tsx |5 files /41 tests /0 skips,59.71s |
| npx vitest run src/components/navigation.test.tsx src/features/admin/production-staff-admin.interaction.test.tsx src/features/admin/repository.integration.test.ts src/features/checklist-templates/version.integration.test.ts src/routes/-settings-save.interaction.test.tsx |5 files /20 tests /0 skips,4.20s |
| npm run typecheck; npm run lint |Exit0 on repaired application; lint0 errors/2 preexisting warnings; final fixture edit and all checks also verified by CI288 |
| npm run verify:audit-release; npm run verify:firm -- --dry-run |Exit0; localLedgerContract PASS, productionReleaseGate NO_GO. Dry run39 reads/0 network calls/0 writes; missing live/provider/browser bindings explicitly BLOCKED. Exit0 is not release acceptance. |

All five exact plan invocations were rerun on the final isolated DB with no missing paths. Additional targeted repair regression7 files/24 tests/0 skips, adjacent creation regression5 files/41 tests/0 skips and R14 creator regression2 files/2 tests/0 skips are retained. The full suite reruns batch2's201-case payment join,101-thread/201-message history, real500-row OOXML/import/resume/replay,10k/50k SQL and25-backend capacity regressions; their original detailed receipts remain in batch2. These are repository/parser measurements, not hosted application cold-start or native operator acceptance.

Exact-source CI **#288 / run38204660838**: [workflow](https://github.com/YNWAforever/kossilon-hub/actions/runs/38204660838). Node22.23.3 andNode24.21.0 each277 files/2424 tests/0 skips, plus12 local Chromium demo/parser tests. Both lock audits, portable npm install/security10tests,50 fixture migrations/seed, lint/types, dry-run/acceptance-contract gates, build, dev import boundaries, cron-handler and aggregate verify succeeded. Full step conclusions, exact summary output and decoded-log hashes are in batch3-ci-receipt.json. This proves code/CI contracts, not live scheduler/provider/Auth compatibility.

## Review, retained failures and evidence preservation

One fresh read-only GPT-6.1 Sol whole-batch review of3bf8d8e against93ad5eb returned four findings; all were repaired in124ce31 and tested. No second review. Actual SQL barriers reproduce the account-lifecycle race; actual wait_event_type=Lock proves the repaired transaction waits. A rollback-only ICU en-x-icu fixture reproduces a three-row mixed-source traversal returning only one under inconsistent collation; explicit C keys return all three. The no-team Admin handover and definite refusal/transport-unknown paths are separately regressed. See batch3-review.md.

Pre-review full source3bf8d8e:274 files/2417 tests/0 skips. Repaired124ce31 full run:2 failed/275 passed files and2 failed/2422 passed tests; CI287 failed both Test steps and later gates skipped. Both failures were R14 cross-team fixture setup selecting arbitrary first active Staff; d332cd2 changes only setup to a verified Admin with matching team. Original Staff/no-team/cross-team/Client read denial assertions remain. These older runs are retained failures/historical evidence, not final acceptance. Wrong fixture signature, incomplete generated-child cleanup, matcher and formatting attempts also remain logged; assertions/timeouts were not weakened.

The earlier owned batch3 fixture DB is retained with failed-test residual fixtures; no name-based cleanup is claimed. Final validation uses the fresh DB, with captured generated-ID cleanup and rollback where applicable. Public receipts include115 log hashes/sizes/results plus isolated browser artifact hashes; raw logs and CI decoded output stay private under .worktrees/staff-batch3-20261012. Three other worktrees remain clean at their original SHAs; batch3-workspace-guard.json binds that readback.

Original65 UC baseline columns/results/denominator are cell-for-cell identical to93ad5eb. New execution columns currently56 partial/9 blocked; **0 fully verified native UC passes**. Twenty-one UC execution rows receive this candidate's source/artifact evidence without rewriting their audit result. Task/source/staging/release states remain separate.

## Remaining gates: owner and minimum missing input

| Gate | Owner / minimum missing input | State |
|---|---|---|
| Genuine role/device journeys, revoked sessions, complete Today/company/handover/template/import flows |QA/Auth/Release: isolated exact-artifact origin, compatible current schema/Auth, controlled Admin/Manager/Staff andClient A/B identities;390px/1366px keyboard/operator run |受阻 / 待驗收 |
| Native restore and writable-runtime compatibility |DB/Release: native recovery point/quota and isolated Auth-compatible target; exact catalog/ledger/rollback packet and immutable readback. PG18 local public restore evidence remains batch2 only |受阻 |
| Background worker / actual heartbeat / UC55 |Scheduler/Release: single native scheduler owner, bound web/worker artifact, lease/fencing and3 five-minute ticks observed>=10min, per-pass receipts. Current persisted attempt receipt is not an independent heartbeat |受阻 |
| R27 real scan/OCR/AI, WhatsApp and filing receipt |Provider/Ops: concrete approved test namespace/recipient, configured providers and authenticated native callbacks/delivery/receipt evidence; four original outbox items require provenance/recipient review |受阻 |
| Hosted capacity and genuine500-row operator acceptance |QA/Ops: isolated origin/exact artifact and approved test namespace/workbook; hosted endpoints/cold-warm25-concurrent run and actual role mapping/preview/apply session |待驗收 |
| Independent security release |Security/Release: installed/deployed artifact receipt for the separately scoped security candidate; no wholesale schema main promotion for maintenance |待驗收 |

No missing provider blocked these five local source deliveries. None of these gates is backfilled from mocked provider tests, HTTP200, READY, Git merge or older68-test acceptance evidence.

## Rollout and rollback packet

1. Review PR145 as a draft stacked on PR142. Keep PR143 dependency/source and PR144 independent security lineage visible. Evidence-only final head must preserve d332cd2 application/test/config equivalence and receive its own CI readback.
2. Bind an isolated web/worker artifact to current schema/Auth and a recoverable native backup. Rehearse exact compatible reconciliation and immutable data/catalog checks there, then genuine roles/device/capacity/import journeys under outbound hold.
3. Scheduler owner supplies lease/fencing/tick receipts. Provider/Ops approve only a concrete test namespace/recipient; unknown outcomes reconcile original receipts before any retry. Keep safety scan, manual approval, posted payment, prepared/transmitted/receipt proofs distinct.
4. Production approval is a later gate bound to exact source/artifact/schema/scheduler/backup and recipient decisions. This local implementation session has neither requested nor consumed that approval.
5. Source rollback uses normal reverse-order reverts of reviewed UI/read-model changes or a compatible previously verified artifact. Do not undo current actor checks,50-row authorized boundaries, lifecycle locks, last Admin/version protections or immutable evidence. No batch3 down migration exists. Stop accepting new jobs if necessary; preserve frozen snapshots, committed successes, job ledgers, original unknown keys and handover receipts. R15 may return to a verified AR-only entry with explicit coverage; R19 may revert display while retaining lawful links; R20 retains bounded scope; R18 never deletes/replays uncertain jobs; R22 never discards audit/conflicted drafts.

Disposable container cleanup is separate: verify exact container ID/ownership before stopping; retain prior failed DB and stopped populated restore for review. No customer data or unrelated user modifications were deleted. Next work is the concrete native gates above and external review, not another local implementation plan for these five completed source deliveries.
