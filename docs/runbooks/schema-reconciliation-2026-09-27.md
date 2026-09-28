# T01 schema reconciliation and release gate — 2026-09-27

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
