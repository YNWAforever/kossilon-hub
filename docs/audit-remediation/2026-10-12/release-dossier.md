# First-batch release dossier — 2026-10-12

This is a review candidate, not full-project or production acceptance. Scope: R14/F16, R18.1/F35, R24/F36; R26 reused-source regression; R25.1 independent security artifact investigation and R25.2 read-only catalog comparison. The original 65 UC baseline records are unchanged. New results: 33 partial, 12 blocked, 20 not-tested, 0 complete scenario passes. Source, staging and release are separate in both execution trackers.

## Exact sources and artifacts

- New source/tests: `c88b530497d22159e2ceab22662f04a1a2dc620f`; normal branch `codex/staff-remediation-20261012`.
- Stack base PR142: `9f2483dfd80433afc3df38f99014bb37746c2168`, branch `codex/audit-20261008-operations-freshness`. PR142 remains open/draft and contains PR143 dependency gates. New PR must target this branch, preserving those histories.
- Main readback: `da82677bdeb35b9255425be61bd66abd295f5cc1`. Live alias readback: `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`. PR143 open/draft at `01b56fa2efd719209c1f9a36ee9cab6cb9b70d3e`.
- Independent security maintenance reuses PR144 merged source `2063d08272a647f8475b3e43aaa0b2e203b254b2`; its head was `d53acdf13c4915fabcf54334322d64f8a7fb473d`. It is on the separate security base, not main/live.
- UX local build manifest SHA256: `0739ae23e22af4606c8b7114e467e17eeb9f421cecebbebccced7810b8125566`. Exact per-file manifests, separate maintenance target digests and installed locks are in `artifact-manifests.json` / `dependency-comparison.json`. The digest is SHA256 of the canonical sorted relative-file/size/SHA256 manifest, not a Vercel deployment digest.
- Security archive had no migration or DB-client source differences from the live source. Normal `npm ci` ran lifecycle scripts; its installed tree/SBOM and build receipts are retained locally. Default build is Cloudflare; a second unchanged-source build with `NITRO_PRESET=vercel` produced a Node24 Vercel artifact. Neither proves deployed runtime parity.
- Other three worktrees retained their original SHA and remained clean; the original auth test file is byte-identical to the stack base. No pushed history rewritten, reset or force-push performed.

## Behavior delivered

| F / R / UC | Changes and purpose | Evidence / limit |
|---|---|---|
| F16 / R14 / UC35,58 | Explicit validated all/team read scope; active staff identity required; list/count/detail apply the same SQL predicate before checklist hydration. Non-Admin missing team, inactive, Client or missing identity fail closed. Existing AR/document/write policies retained. | Two real PG team fixtures plus policy tests. Session-level Client A/B/revocation UAT remains pending. |
| F35 / R18.1 / UC42,59 | Draft screen sends strict `whatsapp_draft_cases` context. Existing persisted current-version checklist/document predicate is shared by list/count/snapshot/preview. Selects unique cases; new cases do not enter saved snapshots. Explicit IDs outside scope are excluded; context unsupported by another resource is refused. | Real PG 20 owned + foreign case, two selected cases, two drafts on one case, document-only rejection, unsafe evidence excluded, cross-team assigned owner/reviewer excluded consistently, no-team denial, revoked actor and same-key job replay. No native side effect. |
| F36 / R24 / UC60–63 | Session/actor errors classify unauthenticated/forbidden/transient/callback; outer finally finishes loading; refresh clears stale writable session; request generations fence old responses; password login requires matching active verified actor. Root redirects only genuine unauthenticated; retry and safe messages retain return path/cache isolation. | Injected client/server contracts and preserved original tests. Installed Better Auth reports INVALID_TOKEN without proving expired vs consumed; no cause invented, no cookie/provider changes. Real callback UAT pending. |
| F03–06,08–09,13–14,17,19,23–24,28 / R26 | Reused existing ID, metadata, readiness, metrics, assignment, Admin/Settings, import journal and Operations implementations. Test-only date updated to exact audit fixture: UTC Oct11 16:05 -> HK Oct12 00:05. | Component and PG contracts accepted locally; 500-row import workbook, full role/device/capacity/provider scenarios not accepted. |

Principal changed paths: `src/features/auth/team-read-scope*`, incorporation/corporate-change repositories and server functions, `src/features/annual-return/follow-up-scope.ts`, follow-up read path, `case-scope.ts`, bulk types/repository/toolbar and automation screen, `auth-result*`, auth provider, root/login, and integration-test registry. No new schema migration in this incremental PR.

## Executed checks and retained failures

Environment: Windows, Node24.18.0, npm11.16.0; task-local Bun1.4.2 selected explicitly (host Bun1.3.14 retained); Docker PostgreSQL17 bound only to localhost56432. Every DB-write test used task-created disposable databases. Fresh databases were migrated/seeded before full suites. Synthetic provider verdicts are SQL contract fixtures, never native scanner or R2 evidence.

| Command / actual collection | Result |
|---|---|
| `bun install --frozen-lockfile` using task-local Bun1.4.2 | PASS; source locks unchanged |
| `bun audit --audit-level=low`; `npm audit --audit-level=low` | Both zero known vulnerabilities; installed React Start1.168.60 / server-core1.169.39 |
| Independent maintenance normal `npm ci`; `npm audit --audit-level=low`; `npm sbom --sbom-format=cyclonedx` | PASS; no ignored lifecycle scripts; audit0; SBOM retained |
| Independent maintenance `npm run test` on its own freshly migrated/seeded DB | 178 files / 1,773 pass / 0 skip |
| Independent maintenance `npm run build`, then `NITRO_PRESET=vercel npm run build` | Both PASS; targets retained separately; no deployment |
| `npm run lint`; `npm run typecheck` after review fix | Exit0; lint0 errors/2 warnings (auth generation cleanup ref heuristic, inherited work-queue fast refresh); types PASS |
| First candidate full `npm run test` on fresh DB | 252 files / 2,369 pass / 0 skip before added UI assertion/review correction |
| Final-source plain `npm run test` | 2,369 pass / 1 fail / 0 skip: Today lazy-route component exceeded Testing Library's one-second render wait under unrestricted local concurrency. Failure retained, not erased. |
| `npm run test -- --maxWorkers=4 --project unit` | All 217 unit files / 1,979 pass; unchanged assertions |
| Final `npm run test -- --maxWorkers=4` on another fresh DB | All 252 files / 2,370 pass / 0 fail / 0 skip; includes all 35 DB integration files |
| Exact R14 plan selection: `npx vitest run src/features/auth/team-read-scope.test.ts src/features/incorporation/read-scope.integration.test.ts src/features/corporate-changes/read-scope.integration.test.ts` | 3 files / 13 pass / 0 skip with explicit test DB. Earlier accidental no-env invocation had 2 skipped DB tests and is retained, not counted as acceptance. Expanded R14 repository regression: 5 files / 32 pass. |
| Exact R18.1 plan selection: `npx vitest run src/features/bulk-operations/selection-scope.integration.test.ts src/features/annual-return/components/production-whatsapp-automation.interaction.test.tsx src/components/bulk-selection-toolbar.test.tsx` | 3 files / 14 pass / 0 skip |
| Exact R24 plan selection plus new auth/root and Operations tests | 8 files / 64 pass / 0 skip; original auth tests retained |
| Exact R26 plan selection (nine existing paths in plan) | 9 files / 77 pass / 0 skip; component/DB contract only |
| `npm run verify:firm -- --dry-run` | Read-only structure checks; 38 reads / 0 network / 0 writes. Browser/provider/live binding items remain BLOCKED. |
| `npm run verify:audit-release` | localLedgerContract PASS; productionReleaseGate NO_GO; ordinaryHistoricalMigrationAllowed false; inherited ledger remains historical |
| `npm run test:e2e:local` | 12 local demo tests pass at390px/1280px; own artifact root; historic bytes guard unchanged. Not real authenticated staging. |
| Supplemental `npx playwright test --config .worktrees/staff-session-20261012/playwright1366.config.ts` | 6 local demo tests pass at1366px; separate artifact root |
| Final-source `npm run build` | PASS; default Cloudflare worker artifact, retained manifest above |
| `npm run verify:dev-server-imports` | 12 route imports pass, no import-protection violation. This gate is not HTTP/business acceptance. |
| `npm run test:e2e:audit` | BLOCKED at config load: AUDIT_STAGING_ORIGIN missing; no browser/target requests. Presence-only evidence shows all fourteen required staging bindings absent. |

Important RED records: two R14 real-PG foreign-row failures; original F35 all-AR snapshot20 vs draft2; auth getSession/actor fault and wrong redirect failures; independent review's cross-team draft3 vs snapshot2 failure. Corresponding GREEN records are indexed by SHA256. Startup57P03, sandboxEPERM, wrong seed path, UI-test button-label mistake and no-env skips are environment/test setup evidence, not product RED. Raw output remains in `.worktrees/staff-session-20261012`; `evidence-index.json` records digests and sizes. No later run overwrites the named failed logs.

## Independent review and rulings

One read-only GPT-6.1 Sol reviewer inspected base9f2483d..5700833. No Critical issue; one Important issue: existing follow-up action permission admits assigned cross-team owners/reviewers while bulk uses the stricter existing AR board scope. Fixed in `6e70d707baae76177d8974542801467da1f49828`: draft list now also consumes `caseFiltersForActor`. Real PG regression fails at3 vs2 before repair and passes afterward; 29 targeted tests pass. Bulk permissions were not broadened and send-by-ID action permission remains unchanged. No duplicate reviewer or implementation subagent used.

Reviewer exclusions are explicitly retained: new R16/R20/R21 cursors, R17 byte/payment approval workflows, R18.2–3 results/recovery center, native provider unknown/reconciliation, R25 schema/scheduler/security rollout, inherited R26 functionality outside the incremental diff, and genuine Auth/capacity/device/UAT. Ruling: these remain open in trackers and the next-batch delivery list; none is silently accepted by this review.

Graph discovery initially timed out and required fallback. Re-index later succeeded (project `kossilon-staff-20261012`,4,162 nodes/12,155 edges); subsequent discovery preferred the graph. No graph-derived correctness assertion.

## Fresh schema / scheduler / outbound observations

Production and existing staging were queried with `SET TRANSACTION READ ONLY` and15s statement timeout. Private target identities/catalogs stay in local evidence; public comparison is in `schema-comparison.json`.

- Production: PG18.6;66 ledger IDs,0 recorded hashes;1,043 public columns,274 indexes,1,352 constraints,15 triggers,623 grants observed. These counts are catalog facts, not schema acceptance.
- UX source's isolated PG17 contract:50 ledger entries/811 columns.17 expected source IDs are absent from production ledger;33 historical production IDs are absent from source.147 source columns are physically missing; extra/changed columns, indexes and definitions are retained for reviewed reconciliation. No aliasing/reclassification/ledger mutation.
- `notification_outbox.dispatch_started_attempt` remains physically absent. Existing staging has the same observed physical catalog digest and historical drift; it is not a compatible candidate acceptance environment.
- Four outbox rows remain pending email SLA warnings/breaches; stored company origin is client;0 approval records. Stored classification is not verified provenance/consent. Recipient/row fingerprints are retained privately for owner reconciliation. No deletes, fixture guessing or external sends.
- Latest scheduler success:2026-09-30T01:55Z.683 historical succeeded scheduler lease rows observed; no new native run invoked. Historical green is stale; exact owner/deployed scheduler SHA and three new native per-pass receipts are missing.

## Rollout and rollback packets — execution held

Security maintenance and UX have separate release packets. A Git merge, local manifest or generated Vercel artifact is not a deployed artifact/readback.

1. Security owner reviews unchanged-source PR144 plus normal install/SBOM, exact Vercel artifact digest/runtime and live DB compatibility. Resolve runtime smoke/read-only contracts on a correctly bound isolated environment before promotion. Keep outbound paths held. Do not package this UX schema candidate into the security release.
2. DB owner supplies a fresh recovery point and populated isolated restore/rehearsal against observed historical physical catalog, preserving all66 ledger IDs, counts/FKs/grants/triggers and private business data. Resolve only reviewed additive differences; ordinary production `db:migrate` is forbidden. Existing staging is drifted, so its name/readiness is insufficient.
3. QA/Auth owner binds isolated origin, exact release SHA, explicit controlled-account approval reference and five distinct identities (Admin/Manager/Staff/ClientA/ClientB). Replay scoped first-batch UC before wider navigation/capacity acceptance. Secrets use existing secret mechanism, never PR/document values.
4. Scheduler owner verifies a single owner, schedule/runtime/source identity, lease/fencing and each pass. Only after authorization, observe three new native five-minute ticks for at least10 minutes. Keep provider sending disabled until the four outbox items' provenance/recipient/consent/approval is reconciled.
5. Release owner obtains scope-specific authorization at actual promotion/migration/scheduler/native dispatch boundary, promotes the verified compatible security artifact first, then captures alias/deployment/installed artifact/source parity and read-only DB/queue status. No such authorization or execution is claimed here.

Rollback: retain both safe patched independent artifacts and manifests. Disable an affected route/pass or provider dispatch and preserve durable jobs/audit/outbox. Do not roll back to known vulnerable live dependencies, down-migrate historical schema or replay unknown side effects. R14 may only revert to equivalently strict reads; otherwise hold incorporation/change entrypoints. R18.1 can hold the draft bulk action while retaining jobs. R24 rollback is display/classification only, preserving server authorization and existing cookie settings. Source regressions have individual normal commits; existing user work and all failed evidence are retained.

## Remaining work and minimum inputs

| Owner | Missing item / next delivery |
|---|---|
| DB / Release / Security | Fresh populated restore/rehearsal, complete independent security runtime compatibility, safe recovery artifact, exact deployed installed SBOM/readback; approval only at eventual consequential execution |
| QA / Auth | Fourteen staging bindings above; five real distinct sessions; approved fixture namespace; route16/control32/UC65 denominator acceptance |
| Integration / Ops | Known-answer native documents, scanner/OCR/AI capabilities; WOZTELL test namespace/recipient/receipt; filing destination/transmitted/receipt capability; source provenance and consent for pending outbox |
| Backend / Frontend | R16 bounded SQL/read summaries/URL return; R17 global document search and201-case joined payment/unpaid model; proceed independently of providers |
| Backend / Frontend | R15 mixed daily queue, R19 company workspace, R20 two300-case lists, R21 101 threads/201 messages, R18.2–3 document snapshots and recovery results center, R22 handoff/role navigation according to explicit delivery dependencies |
| QA / Capacity | 500-row workbook full journey;1,000-document filtered snapshot;10k/50k active work,25 concurrent,200 warm/20 cold samples per endpoint;50-item47/conflict/retryable/unknown recovery; controlled role390/1366 keyboard/error states. Local browser runner duration is not website performance. |

R14/R24 are待驗收; R18 is進行中 with R18.1 source verified; R26 is待驗收 for local contracts only; R25/R23進行中; R27受阻; remaining feature tasks待開始 with concrete next actions. Full project remains incomplete and release remains NO_GO. CI on the new draft PR is recorded separately against its exact documentation-inclusive head; historical PR142/143 green is not reused as new-head CI.
