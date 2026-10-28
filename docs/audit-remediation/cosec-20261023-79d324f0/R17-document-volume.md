# R17 1000-document SQL correctness handoff

Status: **PASS_PARENT_ISOLATED_SQL_1000_DOCUMENT_CORRECTNESS**. The parent executed the frozen new test successfully: one file / one test PASS, reported exit 0. This worker inspected the log and generated exact-ID manifest read-only and amended this document only. Source/tests remain frozen; final same-SHA aggregate verification remains parent-owned. No DB client, network, storage, scanner or provider was started by this worker.

## Actual parent SQL result and identity gate

`R17-volume-db-first.txt` records `npm.cmd test -- --project db src/features/documents/document-volume.integration.test.ts --maxWorkers 1`: **one file / one test passed**, zero failures/skips. Runner duration was 3.81 seconds, including 2.48 seconds in the test. These are single-run durations, not p95 or production-performance evidence.

The actual generated manifest is `R17-document-volume-r17-doc-volume-99605a4d-6d24-4643-9242-91d408ab6fc3.json`. All 15 scenarios completed, with every complete filtered page-ID set matching its independent fixture expectation and persisted snapshot IDs/count. The inspected results include:

| Scenario | Complete unique page IDs = snapshot count |
| --- | --- |
| All Team A documents | 1000; 27 pages of 37 plus one final row |
| Literal Chinese filename / English filename | 429 / 571 |
| Company name / payment category | 1000 / 250 |
| Client / staff / system source | 334 / 333 / 333 |
| Effective pending / verified / rejected review | 600 / 200 / 200 |
| Combined filename/category/source/review | 23; pages 7, 7, 7, 2 |
| Empty search / wrong-team search | 0 / 0 |
| Other-team positive control | 10; pages 3, 3, 3, 1 |

The stored-precision guard checked all 1010 document timestamps with zero mismatches; the original microsecond cursor/tie assertions passed. Explicit wrong-team company denial and no-team denial are both recorded true. The manifest ends with `phase: intentional-rollback-completed`, `rollbackVerified: true`, and empty `remainingExactIds`. Exact created IDs cover two teams, two users, two staff profiles, two companies, 1010 documents, 808 intents, 1010 versions and 15 snapshots; the awaited eight-table post-read found zero remaining owned rows.

The parent's initial identity guard compared Docker `Config.Image`'s short creation reference with a full digest and **stopped before constructing a DB client**. `R17-volume-target-guard-first.json` preserves `STOPPED_BEFORE_DB_CLIENT`; it is an identity-guard comparison failure, not a SQL/test RED. The parent reports read-only reconciliation of actual `Image` and `RepoDigests`, then correction of the guard to use image ID. The preserved `R17-volume-target-recheck.json` records the pinned actual image ID, the owned run/container labels, loopback target, no mounts and `runner_target_verified: true` before execution. No identity guard or Docker action was performed by this worker.

This closes the authored **1000-document SQL cross-page/filter/snapshot correctness** acceptance on that parent-verified disposable run. It does not close p95/native/scanner/Auth/RLS/browser/object-storage/provider/production acceptance. The earlier source-freeze record and static evidence remain historical, unchanged records; final aggregate/same-SHA results are still the parent's responsibility. No further source/test edits, formatting, static checks or test executions were performed by this worker for this amendment.

## Exact changes and freeze

- New `src/features/documents/document-volume.integration.test.ts` only; existing registered document tests remain untouched.
- One additive entry in `src/test/db-integration-files.ts`, immediately after `company-document-register.integration.test.ts`. Other registry entries are preserved.
- No document production, SQL read implementation, schema, migration, existing test or other module changes.
- Checkout `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`, branch `codex/cosec-20261023`, unchanged base/HEAD `1c57a67213af72bff8d776694e6ed8c986b921db`.
- The bounded freeze covers this new test and this worker's registry addition. No further source/test edits or formatting by this worker until the parent reports results. An actual regression must be reported before proposing a source fix. Docs/evidence updates remain allowed.
- Freeze fingerprints and read-only dependency fingerprints are in `R17-document-volume-source-freeze.json`. The parent owns the final shared-candidate/full-suite binding; these individual hashes are not a claim that the whole dirty checkout was tested.

## Authored acceptance and fixture semantics

The test calls actual `listDocumentPageForActor` and its transaction-injected `createDocumentRepository`, plus actual `createBulkOperationsRepository({ sql: tx }).createSnapshot`. The reads and saved snapshot are not mocked. The staff-list authorization scope is the current server helper; the unexpected by-ID authorization callback throws if invoked. No storage/scanner adapter is constructed.

Every run generates fresh exact UUIDs and one `r17-doc-volume-<UUID>` identifier. Two owned teams, two Manager users, two matching authoritative staff profiles and two companies are inserted directly, without selecting/copying any seed or existing business row. Both companies are synthetic transaction-owned `data_origin='client'` rows so the real production fixture-exclusion predicate is exercised. This does not create or seed production data.

Team A has exactly **1000 documents**: 200 metadata-only rows with no current version, 800 with current versions, and 200 superseded versions belonging to replacement documents. The latter retain a verified review naming the old version, so their effective current review must be pending. Current-version verified/rejected controls name their current version. Metadata-only rows carry historic verified labels but must read pending. Effective Team A counts are 600 pending, 200 verified and 200 rejected.

Ten Team B documents provide matching wrong-team controls. Across both companies there are 1010 document rows, 808 upload-intent rows and 1010 version rows. Intents are synthetic quarantined metadata with no scanner verdict/verified bytes. No file objects, outbox work or native provider operations exist. Availability is checked as metadata-only or quarantined, with object availability explicitly `not_checked`.

All upload timestamps are staged as JSON text and converted on the SQL server. Before list assertions, an independent exact-ID read checks all 1010 stored timestamps against their full source strings. The owned 1000 use tied groups of 400 at `.123456`, 400 at `.123455`, and 200 at `.123454`. Each continuation cursor is checked against the precise stored boundary and UUID; fixture expectations sort full strings and UUIDs without JavaScript Date rounding.

Fifteen scenarios each compare the **complete ordered page IDs** with independent fixture expectations, require unique IDs and bounded/repeating-cursor protection, then compare the full sorted IDs and count against the actual persisted snapshot:

- All 1000 Team A documents, page bound 37: 27 pages of 37 and a final page of one.
- Literal Chinese filename search containing `_` and `%` (429 expected), English filename search, and company-name search.
- Category `payment`, each of client/staff/system sources, and each effective pending/verified/rejected review status.
- Combined literal filename + category + source + review (23 expected, page bound seven), proving filtering before pagination.
- Empty search, wrong-team search with an empty snapshot, and a positive Team B control (ten expected, page bound three).

There is also an explicit Team B read of Team A's company ID requiring an empty result, and no-team denial through both the list helper and snapshot entry point. No fake Admin bypass is used; snapshots re-read the two newly created Manager identities from the owned users/profiles.

## Rollback and exact manifest

There is no dotenv loading or module-scope client. Only `TEST_DATABASE_URL` from the parent's already verified runner selects the target, with no hostname/port/database hardcoded. The single max-one client is instantiated inside the parent-executed test only. The test has a 120-second deadline, transaction-local 15-second statement and three-second lock deadlines, UTC timestamp rendering and the existing SQL lifetime guard.

All seven fixture INSERT statements, the review FK update (joined only to the exact owned document IDs), snapshot writes and assertions share one rollback transaction. A unique sentinel deliberately rolls it back on success; unexpected assertion/SQL failures also roll it back. No DELETE/TRUNCATE/DROP, prefix cleanup or manual commit is used.

The awaited raw-client post-read covers exact primary keys in eight tables: teams, users, staff_profiles, companies, documents, document_upload_intents, document_versions and bulk_selection_snapshots. All IDs are allocated before the client, except snapshot IDs returned by the actual repository and captured immediately. Each completed insert's IDs are recorded separately. The test requires an empty post-read and closes its one client in `finally`.

With `COSEC_EVIDENCE_DIR`, each run writes `R17-document-volume-r17-doc-volume-<UUID>.json`; otherwise allocation/final receipts go to stdout under `R17_DOCUMENT_VOLUME_FIXTURE`. The receipt contains exact owned/created IDs, stored precision samples/mismatch IDs, complete expected/paged/snapshot IDs and per-scenario bounds/counts, scope checks, and final exact-ID post-read. Successful acceptance requires a passing runner result, final `intentional-rollback-completed`, `rollbackVerified: true` and empty `remainingExactIds`. A receipt without those conditions is not acceptance.

## Validation actually performed

| Evidence | Result |
| --- | --- |
| `R17-document-volume-eslint.txt` | ESLint on the new test and additive registry: exit 0. |
| `R17-document-volume-static.txt` | Zero AST syntax diagnostics; isolated evaluation of only pure fixture declarations confirms all stated counts, the 23-row combined filter and eight exact-ID post-read tables. No test/application module import, client or SQL execution. |
| `R17-document-volume-type-static.txt` | Zero syntax/type diagnostics for the new test using the full repository's compiler ambient context. No application/test module execution. This is not a full-candidate typecheck claim. |
| `R17-document-volume-type-static-initial.txt` | Preserved validator setup failure: checking only one root omitted Node ambient references. Not a product/test RED. Correcting validator context required no source change. |

Prettier was applied only to the new file before the announced source freeze; no additional checks or formatting were run after the parent requested readiness. Existing company-register integration/read/model fixtures and current-version constraints were inspected before authoring; no historical broad cleanup or seed-copying helper was reused. No further unit/static repeats are required for this handoff.

## Parent exclusive runner and limits

The parent reported its previous 13-file DB run finished 118/118 before this addition. That prior pass did not cover this new test. The parent subsequently ran the new file alone successfully as recorded above; its later 14-file aggregate run remains to be bound to the final shared candidate. The original parent-only runner command is retained for reproducibility, not as a request for another run:

```powershell
# Use the parent's externally verified TEST_DATABASE_URL and existing client settings.
# Any TEMP/TMP override belongs under ignored node_modules/.cache/cosec-run-temp.
$env:COSEC_EVIDENCE_DIR = (Get-Content -LiteralPath .run-path -Raw).Trim()
npm.cmd test -- --project db src/features/documents/document-volume.integration.test.ts --maxWorkers 1 2>&1 |
  Tee-Object -FilePath (Join-Path $env:COSEC_EVIDENCE_DIR 'R17-document-volume-parent-sql.txt')
$documentVolumeExit = $LASTEXITCODE
# Retain exit code plus the exact-ID receipt; a skipped collection is not a pass.
```

This task addresses **1000-document SQL cross-page/filter/snapshot correctness only**. No p95/performance, HTTP payload, native Auth/RLS/browser, scanner/provider, object storage, deployment or production proof is claimed. No commits, push or external actions occurred. An actual failure from the parent runner must be classified from its precise assertion/SQL error before any production change.
