# Acceptance boundaries and release prerequisites

Run: `cosec-20261023-79d324f0`. Release gate: **NO_GO**. Auth runtime verified: **false**. Final local source candidate is e8ecf3fad979adc4321a58eb64a90d0927e175de. All authorized local checks passed; native acceptance remains blocked. This grants no release authority.

## Candidate and source identity

The shared candidate is `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`, branch `codex/cosec-20261023`, supplied base `1c57a67213af72bff8d776694e6ed8c986b921db`. Intermediate receipts describe dirty working-tree contents and file fingerprints. The final tested source commit is e8ecf3fad979adc4321a58eb64a90d0927e175de, recorded in release-candidate.json. Same-SHA results: 2464 unit/component,146 isolated SQL,21 Node handler and12 demo browser PASS; typecheck/lint/build passed. Full lint has one existing Fast Refresh warning; changed-path reruns passed. Source fingerprints match after all checks. No provisional SHA is repeated in the acceptance matrix.

The production SHA `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` in the supplied audit is historical evidence, not a freshly verified deployment or current production alias. Current production artifact, dependency inventory, migration registry and runtime identity remain unverified by this local documentation task.

## Preserved acceptance inputs

`acceptance-results.csv` contains exactly 184 baseline records: 35 F, 15 R, 100 UC and 34 LA. IDs are copied verbatim; findings have intentional gaps and the supplied UC set is UC99 through UC198. No replacement IDs or extra synthetic acceptance rows are introduced.

The four original CSVs are read from `C:\Users\laich\Documents\kossilon-hub\cosec-input-20261023-79d324f0\Kossilon_Authenticated_Audit_2026-10-23`. Their names and SHA256 hashes are:

| Original basename | SHA256 |
| --- | --- |
| Kossilon_Findings_35_Updated_2026-10-23.csv | BD7663AAF7B95302241F106C56F6CB44E3E42E5B69049B69BBC8EE8F6249C247 |
| Kossilon_Remediation_Tasks_15_Updated_2026-10-23.csv | 9FDB5CBB515EBFA5220A10E55F0DB1A975E7450D8752269FA288B922ADFE91A8 |
| Kossilon_Test_Cases_100_With_Followup_2026-10-23.csv | 4BFE0A2E5E0E0F180BA542F05B901F3F973288119952DD89E76CFBE5BC2D3526 |
| Kossilon_Live_Assertions_34_2026-10-23.csv | 5597705FF8F3A011D3AECBA21A609A69111C3BC0D0B7F2F870E7CC3DED55F4CE |

The four raw CSVs are copied to source-inputs/ with fixed hashes and independent verification. `source_file` is the original basename. `original_row_json` retains every source column and its original string value, including historical result, SHA, timestamps, evidence, blockers and follow-up fields. `historical_result` separately mirrors the original finding evidence status, remediation status or UC/LA result; it is never overwritten by current local verification.

Relationship columns derive from explicit source links, with inverse task/case/assertion links added for navigation. They are not closure evidence. Evidence paths are semicolon-separated file paths relative to this run folder. An unmatched local scenario is `NOT_RUN` and cites this blocker disposition; that citation is not an executed test. `PARTIAL_SCOPED` means only the specifically described slice has local evidence. `SOURCE_ONLY` means source assessment rather than runtime verification. These values are not acceptance pass rates.

Every `native_result` is **BLOCKED** or **NOT_RUN**. BLOCKED identifies a missing native Auth, account, provider, production or controlled-action prerequisite; NOT_RUN identifies a full acceptance scenario not executed in this local scope. Historical production passes/failures remain inside the original rows and do not become current passes. Scope text is deliberately narrower than many complete UC/LA steps.

Documentation readback checks confirmed the exact 184 ID/type set and all 3,350 original string fields, unchanged hashes for all four raw inputs, original basenames, the 15-column schema, and 61 distinct existing evidence files within this run folder. Native dispositions are 70 BLOCKED and 114 NOT_RUN. Local dispositions are 158 PARTIAL_SCOPED, 10 SOURCE_ONLY and 16 NOT_RUN; these are evidence-scope labels, not pass counts. These checks are CSV/file integrity checks only. The parent's delivery CLI, raw-input copies/hash manifest and final candidate verification remain separate; this worker did not execute that CLI or any test suite.

## Verified disposable target and DB ownership

The parent's recorded isolated target is documented in `isolated-target.json` and `db-final-target-recheck.json`:

| Identity field | Recorded value |
| --- | --- |
| Container | 4f5c362905d14782f4bc2c4bf74af3fc8f2b4e76259342e873bfd1ea78424580 |
| Container name | kossilon-cosec-79d324f0 |
| Run label | codex.run=cosec-20261023-79d324f0 |
| Host binding | 127.0.0.1:60953 to container 5432 |
| Database | cosec_79d324f0 |
| Image digest | sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232 |
| Storage and memory | tmpfs data, no mounts, 536870912 bytes |

These are this run's recorded facts, not permanent host/port guards for portable tests. Before any new DB execution, the parent must re-establish container ID, image, labels, binding, database, mount/tmpfs identity and the actual runner target. A localhost URL alone does not prove isolation. The parent exclusively owns DB clients and serialized DB suites. This documentation task starts none and reads no credentials or environment files.

Parent receipts record 50 existing migrations and three synthetic seed records applied only in that disposable target. This does not verify the production migration registry or a safe production upgrade. Owned fixture receipts record exact IDs, rollback and post-rollback zero readback; do not replace those checks with broad cleanup or count earlier failed runs as later successful runs.

## What local evidence can establish

- R14/R20: original denial regressions and unit/component positive controls; parent SQL receipts for 300 incorporation and 300 corporate-change records, assumed-actor role predicates, detail/list scope, bounded pages, filters, counts and precise timestamp/ID cursors. Refresh repair has separate RED/GREEN logs. These do not establish real Auth, HTTP session/RLS behavior or the full create-to-completion journey.
- R15/R16/R28: local Today/readiness/return-context tests and isolated SQL projection, 10,000-work search/page/snapshot sets. Local SQL execution/serialization samples are not authenticated HTTP payloads, production p95 or browser performance acceptance.
- R17/R18/R19/R26.1/R26.2: scoped payment, bulk, client/document context and Portal unit/component evidence, plus parent document/bulk SQL where named. Component payment actions remain mocked; separate actual SQL payment locking/allocation tests passed in the146-test suite. No real payment/native HTTP crediting is proven. Portal RPC mocks do not prove Client membership through real sessions.
- R21/R22: parent exact-ID SQL history traversal and local paginated inbox/navigation component tests. The browser receipt is explicitly read-only demo in Edge at emulated 390/1280 viewports. It does not prove Auth, Safari/WebKit, a physical device, assistive technology or a full mobile work journey.
- R24/R26.4/R27: local Auth recovery, Operations/HKT, Admin/import and provider-adapter contracts. Older green batches precede subsequent review findings. REVIEW-3-disposition.md independently confirms all three original findings repaired in frozen source; final same-SHA aggregate verification passed. Native Auth remains unverified. The separate R19 REVIEW-3 case-recovery receipt records its scoped repair only.
- R25: local artifact/source/migration comparison and NO_GO assessment. Source version or migration files do not prove the deployed dependency graph, current database registry, native scheduler freshness, a backup or a successful restore.

Receipts and logs are historical records with overlapping test batches. Do not add their counts together or infer a final unit/build count. The parent owns final lint/typecheck/unit/build/DB evidence and binding those checks to the final candidate. Initial EPERM/collection failures are environment evidence, not assertion RED. Older mixed or failed SQL attempts remain preserved beside later scoped successes.

## Remaining acceptance and concrete prerequisites

| Remaining check | Prerequisite before execution or acceptance |
| --- | --- |
| Remote integration and release | Local candidate and184-record integrity completed. Push/CI/merge/deploy remain unauthorized and unexecuted. Review concrete source.patch, compatibility/rollback and native blockers before separately authorizing any external action. |
| Native role and account matrix | A same-version Auth-compatible disposable application, verified target, approved Admin/Manager/Staff/Client/inactive/no-team accounts and team membership, with permission to exercise sessions. Test actual browser/HTTP reads, logout, account changes, cache/selection clearing, forbidden IDs and detail mutations. Assumed actors are insufficient. |
| Full UC99–UC198 and LA01–LA34 execution | An approved native target, exact scenario data and role identities, controlled write scope and recorded expected/actual results. Preserve the original audit history and append current evidence. Native browser history/reload/return navigation, keyboard/screen-reader/zoom, physical device and Safari/WebKit checks still need their own evidence. |
| Runtime schema and dependency compatibility | Approved exact deployment/artifact and database identity, deployed lock/SBOM/advisory evidence, actual ordered migration IDs/checksums/catalog readback and a fail-closed compatibility decision. No production migration is authorized here. |
| Native ticks and freshness | Approved scheduler/worker target and observation window; consecutive real executions, successes, queue freshness and HKT timestamps tied to the same deployed version. Configuration/capability flags and mocked ticks are insufficient. |
| Scan, storage, OCR and AI | Approved provider/storage identities and credentials, disposable files with recorded bytes/version/hash, consent for cost, timeout/retry and malware/accuracy samples, and genuine correlated provider evidence. Local adapters, synthetic corpora and fake responses do not close this gap. |
| WhatsApp/webhook/delivery | Approved provider/account, controlled recipient and template, consent for external sends and signed callback handling; preserve genuine references and reconcile unknown outcomes before any retry. Current local scope authorizes no sends. |
| Filing destination and statutory return | Approved destination, safe manifest/version/hash and explicit transmission permission, followed by a genuine correlated receipt. Disabled destination and stub acknowledgments are not filing acceptance. |
| Durable writes and concurrency | Parent-owned isolated SQL evidence for the precise acceptance behavior, followed by authorized native account/session coverage. UI mocks alone do not prove payment totals, concurrent assignment, import crash/resume, offboarding or success replay. |
| Representative performance | Approved same-version target, representative authorized dataset, defined cold/warm routes and budgets, repeated HTTP/browser measurements and profiling evidence. Demo timings and one local SQL sample do not establish production acceptance. |
| Backup and rollback rehearsal | Verified compatible rollback artifact and exact data target, approved backup/restore resources, proven backup readability/integrity, restore and readback, and explicit rollback authorization. A source rollback description is not a completed rehearsal. |

## Action and rollback boundaries

The user authorized local source/tests/docs and independently verified disposable resources. The final sources are frozen; it did not authorize push, merge, deploy, production DB access, account/provider changes or real sends. All new SQL execution remains exclusively parent-owned. No dependency install, copied environment, network request, DB client, migration, fixture execution or cleanup is performed by this documentation task.

Private-repository graph indexing/upload was rejected by automatic approval review because MCP disclosure risk was unverified. The refusal remains in force: no retry, alternate index/upload route or disclosure workaround. User-authorized local-source inspection remains the fallback.

The parent may review and commit the candidate locally under its existing scope. Publication or runtime actions require separate exact-target authorization and the prerequisites above. Preserve dirty work and every historical input/log. Candidate rollback means choosing a known compatible source artifact under the parent's release procedure; it does not authorize resetting the shared tree or deleting another worker's changes. Data rollback requires a verified backup/restore plan and explicit approval; do not issue blind down-migrations or broad deletes. Successful external actions must not be replayed, and unknown outcomes require reconciliation rather than automatic retry.


## Final local closeout

The exact owned container and generated credential/helper files were removed only after identity/zero-connection checks. Other pre-existing container IDs were preserved (cleanup-result.json); all source/evidence remain. DB before/after baseline counts match; outbox remains0. SQL logs retain20281 observed parameter/reference IDs and gzip roundtrip hashes. No production data/account/provider was touched. Actual durable NAR tests include100 rows; the500-row RPC boundary is unit-tested, while500-row native import remains unexecuted. Native ticks still require one approved scheduler owner and at least3 genuine five-minute invocations spanning at least10 minutes, with platform correlation/per-pass/heartbeat evidence.

