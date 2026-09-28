# T27 performance baseline (local, 2026-09-28)

Scope: K23, T27. This is disposable local PostgreSQL evidence, not a deployed API SLA or pilot acceptance. The benchmark inserts synthetic cases inside a transaction and rolls it back. No production data, recipient, or provider was used.

## Implemented read paths

- `listWorkViewForActor` calls one scoped SQL statement for total and 50-row keyset page against the same snapshot and `asOf`; max page size is 200. The selected page alone is hydrated for blockers. The risk view keeps a cursor after filtering.
- `getOperationalMetricsForActor` aggregates scoped case and missing evidence counts in SQL using the same `asOf`. The interactive Today view and board no longer load 5,000 cases for summary tiles.
- WhatsApp follow-up listing now reads an authorized 50-case page. An approval preview rereads its one case and persisted recipient/evidence state, then retains the existing explicit approval and provider gates. Bulk review includes only drafts visible on that page.
- The scheduled reminder sweep advances 200 cases per keyset page instead of silently stopping at 5,000. This is a local code-path change; cron runtime duration has not been measured.
- Import review and immutable preview return 50 rows per page and search at most 20 companies at once. The browser does not receive a 10,000-row preview. Staging rows and bulk operation items use set-based inserts; one approved apply row reads one indexed JSON object member and reuses the single-row domain service.

## Disposable PostgreSQL measurements

Command: `RUN_T27_BENCHMARK=1 npm run test -- scripts/benchmark-operations.test.ts` with `TEST_DATABASE_URL` set to the disposable local database. Full machine-readable output: [t27-benchmark-local.json](t27-benchmark-local.json). Seven warm samples per size; one SQL query per list or summary request. Times are repository calls, not HTTP round trips.

| Cases | Cold list ms | Warm list p50/p95 ms | Summary p50/p95 ms | First page bytes | Rows/page | Deep page rows |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 17.0 | 11.3 / 14.8 | 5.2 / 15.0 | 10,545 | 50 | 10 |
| 10,000 | 30.2 | 33.5 / 36.7 | 35.3 / 48.5 | 10,595 | 50 | 10 |
| 20,001 | 65.4 | 78.5 / 89.7 | 65.1 / 66.5 | 10,641 | 50 | 10 |

At 20,001 cases, `EXPLAIN` on the local clone had a `Sort` root. No index was added without a measured need. Heap deltas were +2,155,544, +1,843,968, and -5,356,368 bytes respectively; these single-run values are noisy and are not a browser memory claim. An earlier repeat of the old lateral checklist aggregate exceeded 180 seconds after the seed changed planner statistics. A set-based aggregate replacement was followed by two successful full 20,001-case benchmark runs (about 12 and 11.5 seconds for the entire test). The JSON records the second successful run.

The 10,000-row synthetic workbook parse, atomic stage, 50-row read and identical upload replay passed in the disposable DB. A genuine synthetic OOXML workbook with 10,000 rows then ran through the durable worker, existing parser and domain staging service, private-storage abstraction, cleanup and replay; this local test passed. A separate 10,000-row immutable preview, approval, 10,000-item operation and partial apply/resume passed. The static preview renderer emitted 50 row markers on both first and last pages. These checks do not measure live R2 transfer, browser heap, or deployed scheduler timing.

## Topology and release gate

The current PostgreSQL client defaults to pool `max: 1`; Worker configuration binds `HYPERDRIVE` and private `DOCUMENTS_BUCKET` R2. The actual deployed DB and R2 regions, pool saturation, cold Worker timing, provider latency and authenticated browser DOM/memory were not accessible. No pool or region setting was changed on guesswork.

Before claiming runtime verification, obtain a read-only deployed environment inventory, run authorized 1k/10k/>20k equivalent load or safe staging replay, measure cold and warm HTTP p50/p95/query count/payload, and capture browser DOM/heap at 10k import scale. Engineering targets are warm list API p95 <= 1 s, summary <= 1 s, first-page payload <= 300 KB. The local repository results are below these numerical targets but cannot prove the HTTP targets.

The authenticated upload request now only places verified-size bytes in private R2 and queues a creator-owned job. The existing five-minute scheduler claims at most two jobs per pass; a worker rechecks Admin status, private object metadata and actual SHA256 before using the existing server parser/staging service. Claims are fenced with a lease token; transient failure waits five minutes and a crash after domain staging reuses the same byte-keyed batch on resume. Three exhausted attempts become a visible failed job. Terminal objects are deleted and cleanup is retried if deletion fails. The UI polls status and stores only the opaque job ID in session storage to resume after reload. Demo mode cannot queue jobs. Approved apply remains a separate resumable bulk operation. Local tests prove the repository and worker path; live R2/cron behavior remains runtime-blocked.

## Schema and recovery

Migrations `0057_import_preview_scale.sql`, `0058_import_apply_selection_limit.sql`, `0059_nar_import_stage_jobs.sql`, and `0060_nar_import_stage_error_detail.sql` were applied only to the disposable local database. `0057` adds `rows_by_id`, backfills existing immutable previews, and does not change preview hashes. `0058` permits at most 10,000 selected items only for `importApply`; every other bulk action remains capped at 1,000. `0059` adds a private-object key, checksum, creator, lease, result, and cleanup ledger. `0060` retains at most 500 characters of parser-owned validation detail for the uploading Admin; provider, SQL and storage errors remain non-sensitive codes. All four are included in `src/server/db/schema.sql` and the expected migration manifest. Production has none of these migrations from this task.

Before any production migration, reconcile the exact production DB identity and existing migration ledger read-only, inspect old preview count and action-specific selection sizes, back up the affected tables, and run upgrade and rollback rehearsal on a clone. After rollout, query `nar_import_stage_jobs` by state and count rows whose `object_deleted_at` is null; these are the durable retry and private-object cleanup indicators. A code rollback can leave these additive schema changes in place. Reinstating the old 1,000-item constraint requires zero `importApply` previews above 1,000; dropping `rows_by_id` requires the prior application version and no active preview/apply work depending on it. Never drop the column or tighten the constraint automatically during rollback. Before removing `0059` code, stop intake, drain or explicitly fail active jobs, confirm terminal R2 cleanup, and retain the job table for audit; dropping it is a separate reviewed data-retention decision. Production DB mutation and deployment need their separate authorization.
