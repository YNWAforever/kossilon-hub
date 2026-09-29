# T01 schema reconciliation and release gate — 2026-09-27

## Authorized target migration completed — 2026-09-29

The user explicitly designated Neon project red-morning-00331124, branch br-muddy-mountain-aov8bbku, database neondb, and authorized guarded removal of the duplicate 0006_client_register.sql ledger row followed by 0021–0065. This resolves the mutation target authorization independently of the still-unverified Vercel binding. The exact-host check passed for ep-patient-block-aoxmgw78; the original production/default branch and endpoint association remain in place.

Snapshot snap-sweet-sea-ao66v7mt was retained. Neon rejected another snapshot because of its snapshot limit, so a fresh no-compute recovery branch br-flat-heart-aovfw8hr (authorized-before-0021-0065-20260929) was created explicitly from the original branch at LSN 0/53DF528 and verified ready. No restore/finalize operation was used for this backup.

The first guard correctly rejected timestamp literals truncated to milliseconds and rolled back. Reading applied_at as text revealed the exact values 2026-08-03 20:26:37.261845+00 and 2026-08-04 19:03:12.181889+00. Forward and technical rollback SQL now preserve those exact values without relaxing equality or catalog guards. The corrected forward passed a full ROLLBACK rehearsal (21 rows, alias intact), then committed (20 canonical rows, alias absent).

The unchanged repository migrator from deployed source 0230c90a85f4049b006e98ec81888efdbcc70b2d applied all 45 files, one transaction per file, with exit code 0. Read-only db:inspect returned current, 65 exact canonical IDs, zero missing/unknown/definition mismatches and 12/12 required schema capabilities ready. Its canRelease=true result concerns this database schema only. A console summary initially read the wrong capability property and printed zero; the saved report and subsequent assertion use requiredCapabilities and confirm all 12.

Counts and sorted-ID digests remained identical for companies (3), annual-return cases (3), documents (14), payments (3) and checklist items (15). Backfills produced 14 document versions, 15 requirement instances and one eligible legacy Filed case. There are zero orphan document versions and zero unvalidated public foreign keys. Packages and notification outbox remain empty. These checks do not validate every business-field value or an authenticated application journey.

[Saved evidence](evidence/2026-09-29-neon-migrations/summary.json) includes pre/post ledgers, migration SHA-256 hashes, table counts/ID digests, guarded reconciliation result, migrator output and full schema report. T01 is runtime-verified for the named database; T29 remains runtime-blocked for deployed binding, authenticated provider/scheduler/E2E and pilot acceptance. Earlier dated observations and migration blockers are historical. The alias technical rollback now refuses the advanced ledger; retain the recovery branch/snapshot for an approved restore or forward repair.

## Read-only observed state

Target inspected: Neon project `red-morning-00331124`, branch `br-muddy-mountain-aov8bbku` (`production`), `neondb`, region `aws-ap-southeast-1`. This is the branch selected by the Neon connection; its binding to Vercel `DATABASE_URL` still requires independent confirmation before a release.

The ledger has 21 rows: expected `0001`–`0020` plus `0006_client_register.sql`. Expected `0021`–`0033` are missing. The unknown entry is a historical migration from Git commit `092b6ff`; its blob is identical to the current `0008_client_register.sql` blob (`07caa5d8...`). Both ledger rows exist. This explains provenance, but does **not** authorize deleting, renaming, or ignoring the unknown row. `scripts/db-migrate.ts` now refuses it before applying migrations.

A read-only `pg_catalog` probe confirms `payments`, `documents`, `document_upload_intents`, and `payments.payment_proof_document_id` exist. It confirms `document_scan_jobs`, `document_versions`, `document_version_texts`, `case_parties`, `case_requirement_instances`, `requirement_evidence_links`, `document_analysis_jobs`, `document_findings`, `maintenance_runs`, and their sampled indexes do not exist. The release gate therefore fails even if a ledger count alone is misread.

## Forward SQL preview

The forward SQL is the existing, versioned `db/migrations/0021_*.sql` through `0033_*.sql`, applied one file per transaction by `scripts/db-migrate.ts` only after ledger reconciliation and explicit nonlocal DB authorization. No new migration number is allocated for T01. A proposed manual reconciliation must record the legacy `0006_client_register.sql` provenance and verify the catalog before any ledger adjustment; the current implementation intentionally stops rather than making that decision implicitly.

Relevant locking/backfill work in the 13 pending files:

| Migration | Main impact |
| --- | --- |
| 0021 | Two WhatsApp indexes; `CREATE INDEX` takes table lock that permits reads but can block writes. |
| 0022 | Adds outbox delivery column and updates existing rows. |
| 0023 | Adds upload-intent columns, updates existing intents, creates scan-job table, and rebuilds cleanup index. |
| 0024 | Adds checklist-item FK to upload intents and index. |
| 0025 | Creates import staging tables and indexes. |
| 0026 | Creates party/requirement/evidence tables; backfills existing checklist rows and document links. |
| 0027 | Creates version/text tables; backfills one version per existing document. Verified checksum remains NULL until bytes are checked server-side. |
| 0028 | Creates analysis tables/indexes and enqueues version jobs. |
| 0029–0030 | Adds WhatsApp send-mode and company-origin columns/indexes. |
| 0031–0033 | Creates media, handoff/return, and maintenance tables/indexes. |

The local disposable Postgres 17 test took about 2 seconds for each fresh/upgrade transaction with one legacy case/document/audit row. This does **not** estimate production duration. Before scheduling production, measure row counts for `notification_outbox`, `document_upload_intents`, `annual_return_checklist_items`, and `documents` using read-only counts, inspect active transactions/locks and storage headroom, and choose a maintenance window. `ALTER TABLE` and index builds can wait on concurrent writers; the larger backfills scale with real row counts. Apply one file per transaction and stop at the first error. Do not infer safety from the small local fixture.

## Local rehearsal and acceptance

- Fresh empty schema: `0001`–`0033` applied; `npm run db:inspect` returned `canRelease: true`, no missing/unknown/definition mismatches, all five capabilities ready.
- Upgrade schema: `0001`–`0020`, then one case, document, checklist link and audit event; applying `0021`–`0033` preserved all four and produced one version, one requirement instance, one evidence link. Replaying 0026 and 0027 did not duplicate these rows. Tests use a transaction that rolls back.
- Injecting `0006_client_register.sql` into the disposable ledger made `db-migrate.ts` fail before any additional migration; the row remained present until explicitly removed from that local test database.
- CI now runs `npm run db:inspect` after migrating its disposable Postgres. This validates migration/catalog compatibility in CI; it is not production evidence.

## Nonlocal release and recovery checklist

1. Verify the actual Vercel `DATABASE_URL` metadata maps to the inspected Neon project/branch without exposing the value. Read the ledger and complete catalog report against that exact binding.
2. Resolve the historical `0006` ledger entry in a separately reviewed, explicit reconciliation; retain evidence of both original and canonical SQL hashes. Do not run the current migrator while it reports unknown.
3. Create a named Neon recovery branch/snapshot and verify restore access. Capture pre-migration ledger, catalog diff, row counts and application deployment ID. Take a backup according to the firm's runbook.
4. Obtain the required authorization for nonlocal DDL/data backfills. Apply the reviewed forward files in order with a maintenance window and monitor locks/errors. Do not send live notifications during the migration.
5. Run `npm run db:inspect` on the target and representative authorized Documents, Payments, parties, analysis and maintenance reads. Confirm pre/post row counts and FK integrity. Only then consider a deployment or provider activation gate.
6. If a file fails, stop. Its transaction rolls back, but previously applied files remain. Keep the old application version serving where compatible, preserve the failure and ledger evidence, and restore to the pre-migration Neon branch/snapshot under the approved recovery procedure if needed. Do not run ad hoc `DROP TABLE` down migrations against business data.

No production migration, recovery branch creation, recipient send, or deployment was performed by T01.

## Reviewed legacy-alias reconciliation preview — 2026-09-28

The read-only Neon production-branch check still has exactly the 20 canonical `0001`–`0020` IDs plus `0006_client_register.sql`. The alias was recorded at `2026-08-03T20:26:37.261Z`; canonical `0008_client_register.sql` was recorded at `2026-08-04T19:03:12.181Z`. Git verifies both SQL files are the same blob, `07caa5d8f8b6924d00a07a8ba35de73e885f7c81`. The current catalog has `company_contacts` and both 0008 indexes. Migration 0018 intentionally removed `service_packages` and `companies.service_package_id` and added `service_subscriptions`; absence of the retired table/column is expected, not drift.

The [guarded forward SQL](sql/2026-09-28-client-register-alias-forward.sql) removes **only** the duplicate ledger ID, and the [guarded technical rollback](sql/2026-09-28-client-register-alias-rollback.sql) restores that ID with its original timestamp. They are review-only files outside `db/migrations`, so the normal migrator cannot apply them automatically. Both require the exact reviewed canonical ledger set and timestamps. The forward also checks the post-0018 catalog. Rollback refuses once later migrations have advanced, at which point recovery must use the named snapshot and approved procedure.

On disposable PostgreSQL database `kossilon_alias_20260928_a1`, canonical migrations 0001–0020 plus the historical alias reproduced the migrator RED (`Unknown migration ledger entries: 0006_client_register.sql`). A synthetic extra ledger row made the forward guard fail with the original alias intact (22 rows, alias 1). After removing that synthetic row, forward → rollback → forward produced 20/0 → 21/1 → 20/0 (ledger rows/alias rows). The normal migrator then applied 0021–0062 and left 62 canonical rows. The rollback correctly refused that advanced ledger and left the alias absent. `db:inspect` reported `current`, no missing/unknown/definition mismatch, 12/12 capabilities ready and `canRelease=true` **on that disposable clone only**.

Ruling: treat `0006_client_register.sql` as an obsolete duplicate ledger alias, not as SQL to replay or silently ignore. Identical Git blobs, both ledger rows and the expected post-0018 catalog support this. Cost if wrong: an unobserved historical manual change could still exist; retain a named recovery snapshot and compare the actual deployment's database binding, full catalog, row counts and migration preview before any production ledger write. This assignment has not authorized that write. No reconciliation SQL was executed on Neon.

Vercel CLI read-only metadata identifies project `prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC` (`ynwaforevers-projects/kossilon-hub`) and lists production `DATABASE_URL` as a sensitive variable. An in-memory `vercel env run --environment production` comparator received that variable name but a zero-length value, as it did for the other two sensitive Neon variables. This is an access/redaction limitation of this local check; it is **not** proof that the deployed function has an empty binding. No value, credential or URL was printed or kept. The disposable CLI link was removed. The exact deployed `DATABASE_URL` host/database still needs a privileged metadata comparison or an authenticated read-only runtime fingerprint before production reconciliation can be authorized.
