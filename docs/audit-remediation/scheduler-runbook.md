# Scheduler recovery — T02 / F02

## Observed topology (2026-10-01, read-only)

- Web: `kossilon-hub`, Vercel `prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC`, production `dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`, SHA `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`, Node24.x.
- Project and deployment cron definitions are both empty; the plain owner binding is `vercel`. Presence of production `CRON_SECRET` does not prove the secret is valid.
- Explicit Neon target: `red-morning-00331124 / br-muddy-mountain-aov8bbku / neondb`. Its historical `maintenance_job_runs` table and scheduled lease index exist. Latest recorded scheduled jobs succeeded at 2026-09-30 01:55 UTC; these are stale.
- Cloudflare Worker identity, build, trigger and actual DB binding remain unknown. Empty Vercel cron definitions do not prove no Worker exists.
- Evidence: `evidence/2026-10-01-vercel-{project,cron}-metadata.json` and `evidence/2026-10-01-maintenance-catalog.json`. Inventory contains no secret values or recipient data.

## Candidate code and schema

Reuse `maintenance_runs` and the historical per-job registry. Additive `0069_restore_maintenance_job_contract.sql` creates the registry on a fresh database, or validates the existing registry without deleting rows, changing old job-kind constraints, or inventing historical ledger receipts. It rejects wrong types/nullability, identity defaults, primary key, lease uniqueness and scheduled slot index. Populated repeat and rollback tests use disposable local schemas.

The candidate's execution scope is **safe-maintenance-only**: SLA evaluation, stranded-attempt reconciliation, expired notification redaction, and stalled quarantine counting. It does not dispatch outbox messages, enqueue reminders, scan/approve documents, run AI, download media, or run import/bulk jobs. Their adapters and activation gates remain T15/T17/T18 dependencies. A successful safe tick does not mean the full document or messaging pipeline is healthy.

`MAINTENANCE_SCHEDULER_OWNER` accepts `vercel` or `cloudflare`; absent/invalid means paused. Both entrypoints check ownership. Postgres enforces one scheduled `(slot,job)` across processes. An expired **unstarted claimed** lease may be renewed; a started/unknown lease is never automatically replayed, even after expiry. Reconcile it using domain evidence and a reviewed recovery action.

Vercel uses an authenticated GET with `CRON_SECRET` and its cron user agent; ordinary authorised GETs are recorded as manual. The user agent is a classification hint, never authorisation or proof. Platform invocation logs must corroborate scheduled candidate rows. Five-minute slots come from the server clock; caller query parameters cannot set trigger/time/run ID. See [Vercel Cron](https://vercel.com/docs/cron-jobs) and [cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

The Nitro `cloudflare:scheduled` hook retains `waitUntil` and receives the binding owner. The Wrangler template defaults to paused. Neither local build nor a manual tick counts as a platform invocation.

HTTP candidates persist `platformTriggerVerified=false` and are excluded from the new scope's scheduled health and last-success queries, even when the caller supplies the cron user agent. Native-hook rows are identified separately. Historical records are retained as historical scope with their existing provenance; they do not prove the new runtime. After actual Vercel log correlation, an authorised release operator must prepare a guarded per-run attestation with invocation IDs, build and timestamps before any candidate can become verified; no automatic attestation or unapproved evidence mutation is implemented.

## Release sequence — production actions still require new approval

1. Release owner selects the exact tested source SHA and verifies account plan supports the proposed five-minute schedule. Vercel Hobby's daily limit cannot satisfy it; do not change a plan or buy an upgrade implicitly. See [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
2. Operations owner supplies Cloudflare Worker/trigger identity and binding parity. Pause the old actual trigger before changing owner; preserve its previous configuration for rollback.
3. DB owner follows `schema-reconciliation.md`: exact target, approved restore point, populated rehearsal, known historical aliases and hash/DDL review, then applies only the approved additive 0067/0068/0069 SQL. No reset/reseed or invented ledger records. Existing mismatched historical IDs block the generic migrator until reconciliation is reviewed.
4. Business/messaging/document owners refresh the original 4 notification / 14 analysis inventory: origin, recipient, idempotency, attempt/dispatch markers, provider acceptance and unknown outcomes. No automatic reclassification or send retry. The existing aggregate snapshot is not an activation inventory.
5. Release owner approves deployment and owner/trigger change separately. Keep unsafe provider passes disabled until their own controlled-recipient/scanner/AI acceptance is complete. Do not decrypt secrets into evidence or logs.
6. Observe **three real platform scheduled ticks** on staging with an isolated DB/recipients. Save platform invocation IDs/time/build, matching run correlation IDs, per-job lease states, started/finished times, counts and queue before/after. Cadence approximately5min; latest scheduled evidence <=10min. Safe scope must be reported separately from full-pipeline queue drainage. Manual tick is not acceptance evidence.
7. Run fresh roles and provider UAT; then approve the concrete production release. `OPS-02` remains blocked until these facts exist.

## Failure and rollback

- No recent tick: check actual owner/trigger/deployed SHA, then platform invocation logs. Do not manufacture a run row.
- Start/claim/begin failure: correlation ID in platform logs; no job executes on uncertain claim acknowledgement. Read durable registry state. A missing DB/table prevents activation, not an automatic migration.
- Per-job failure: other jobs continue; run is partial with failed job names. Completion acknowledgement loss is `unknown`; no blind replay.
- Run-record write failure: platform invocation fails visibly; job leases retain evidence. Compare job states with the correlation ID. Error payloads/URLs are not logged or returned.
- Queue/catalog read failure: Operations shows unknown independently; it does not replace counts with0 or pretend schema behind.
- Stale evidence or failed/unknown jobs: alert Ops owner using the state/correlation ID, with approval gates retained.
- Rollback: pause both triggers, restore the previous owner/config and compatible tested deployment. Preserve additive tables, historical rows and leases. Do not drop the registry or downgrade ledger records. Restore a DB snapshot only as a separately approved incident recovery, with writes paused and data-loss window reviewed.
