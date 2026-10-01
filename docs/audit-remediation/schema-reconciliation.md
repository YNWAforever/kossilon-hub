# T01 — schema reconciliation and guarded release package

## Confirmed current drift

On 2026-10-01 read-only provider queries confirmed Web/main `aa5d3cb` and Neon `red-morning-00331124` / `br-muddy-mountain-aov8bbku` / `neondb`. The DB records 66 historical migration IDs, including `0034_notification_delivery_attempts.sql`. Main requires a different file, `0034_notification_outbox_dispatch_marker.sql`; its nullable integer column `notification_outbox.dispatch_started_attempt` and its partial index are physically absent. These are distinct migrations, not a proved alias. Never insert the marker's old ID to make a health badge green.

The additional 0035–0066 history comes from earlier integration work. Its presence does not establish that current main has those features or that every corresponding table is correct. Keep those IDs and all data. Reconcile each feature against its original source/DDL when its review package is prepared. Do not replay all main migrations against this divergent production DB.

## Implemented diagnostics

`bun scripts/audit-schema-readiness.ts` reads migration IDs, available `sha256` ledger hashes, and the outbox marker column/index in a read-only transaction. Expected file hashes are computed from current SQL files; missing historical recorded hashes remain `null/unknown`. The report distinguishes:

- Missing/empty ledger from physical DDL state.
- Recorded ID with missing or incompatible physical column/index.
- Unknown IDs from physically missing DDL.
- Historical aliases only with explicit reviewed equivalence evidence; no automatic basename inference or ledger mutation.
- Verified physical facts from an unknown observation; the physical scope is explicitly outbox marker contracts, not every application table.

`db-migrate.ts` now takes a transaction advisory lock and refuses unknown IDs, historical gaps, known hash mismatch, empty/absent ledger over existing application tables, and recorded marker SQL lacking its DDL **before DDL**. It can bootstrap an empty isolated DB or advance a verified contiguous known prefix. All applied statements and ledger inserts commit together. This diagnostic precondition does not grant production authority.

## Additive candidate

`db/migrations/0067_repair_outbox_dispatch_marker.sql` uses the next observed sequence after 0066. It adds the marker, validates nullable integer/no-default semantics and exact ready btree index structure/predicate, and fences pre-marker processing rows whose outcome may be unknown. Same-name incompatible definitions cause rollback. Pending rows are not altered. No table, document, payment, audit row or historical ledger entry is deleted/reclassified.

Existing processing rows must be treated as potentially sent: they receive their current attempt marker, remain for reconciliation, and cannot be claimed again. The existing `failStranded` service subsequently records `dispatch_outcome_unknown` and exhausts retry budget. Do not clear the marker or reopen these rows without provider receipt/manual reconciliation evidence.

## Local verification

Environment: verified Node22.23.3/Bun1.3.14, dedicated Postgres17 localhost55441; no production URL used for writes. Logs/evidence in `.worktrees/audit-baseline-20261001/` and committed `evidence/2026-10-01-schema-rehearsal.json`.

- RED: missing `auditSchemaReadiness`; five new contracts failed.
- Real populated isolated-schema reproduction: outbox claim SQL raised PostgreSQL `42703` when the marker was absent.
- Repair executed twice; rows/FKs/history preserved; unknown row excluded from claim and becomes outcome_unknown; pending row remains claimable.
- Wrong OR-predicate same-name index and ledgerless companies-only schema reproduced RED, then guarded.
- Review identified empty ledger/replay and available hash mismatch gaps. Each reproduced RED before fix.
- Full `pg_dump -Fc` / `pg_restore` rehearsal restored a populated recovery point before repair. Retained 3 companies, 3 cases, 14 documents, 3 payments, 2 outbox rows, 34 historical ledger entries and 2 outbox FKs. Backup SHA256 recorded in the evidence JSON.
- Normal known local prefix migration applied 0067 once; rerun skipped it. Manual repeated SQL rehearsal deliberately did not fabricate a migration receipt; after that rehearsal diagnostics still report the unrecorded 0067 ID separately from verified physical DDL.

## Production operation package — blocked pending new release approval

Owner: DB/release operator. Target: the exact Neon project/branch/database above. Candidate includes source 0067, current file SHA256, this runbook, aggregate counts, physical before/after report and recovery-point evidence. Do not execute it using an old 0021–0066 approval.

1. Obtain approval for this new 0067 scope and coordinated compatible Web/Worker release. Confirm current target identity and ledger/catalog again; do not assume today's inventory remains current.
2. Pause the actual dispatch scheduler owner, verify no second owner, drain active workers, preserve counts/status/attempt/provider IDs/unknown outcomes for every outstanding notification. Never activate recipients merely to test schema.
3. Create the provider recovery point and verify restore on an isolated branch. Compare row counts/FKs/catalog. Provider snapshot creation must use its documented non-finalizing operation; never swap the production endpoint merely to inspect a snapshot.
4. Review candidate SHA256 and fail if 0067 already has an unexplained receipt. Under a transaction/advisory lock, execute exactly the reviewed 0067 SQL, verify catalog and counts, then insert **only** `0067_repair_outbox_dispatch_marker.sql` as the receipt for SQL actually executed. Preserve all previous IDs, including both unresolved histories. Commit only if all checks pass.
5. Run the read-only diagnostic. Missing historical 0034 marker ID remains reported as ledger drift; physical marker repair is separately verified. Do not manufacture its ledger row. Resolve expected history through reviewed source lineage in later packages.
6. Deploy the compatible approved application package while dispatch stays paused. Validate schema/auth/object/provider gates, then separately approve activation and observe three actual scheduled ticks. Manual ticks are not evidence for cron.

### Rollback

- Any failed DDL/catalog check before commit rolls the entire transaction back. Lock acquisition is limited to five seconds.
- After commit, keep the additive marker/index and fenced unknown rows. Prefer code rollback with dispatch paused; old workers must not reclaim unknown sends.
- If data corruption is independently confirmed, use the tested recovery point under a separately approved incident operation. A restore may lose later writes, so preserve/reconcile them first. Do not destructively drop the marker or rewrite the ledger as a rollback shortcut.

OPS-01 remains production-blocked while drift is unresolved. OPS-05 local backup/restore can pass with its precise environment and fixture version; no production recovery claim follows from that local pass.
