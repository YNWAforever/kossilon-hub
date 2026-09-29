# T07 maintenance runtime: local implementation and activation gate

The deployed production alias observed in T00 is Vercel. The repository also contains a Cloudflare Nitro scheduled hook and a Wrangler cron template; neither is evidence that a Worker currently owns production scheduling. No production scheduler or database was changed by this task.

## Runtime contract

`vercel.json` proposes a five-minute GET to `/api/cron/maintenance`. The handler requires `MAINTENANCE_SCHEDULER_OWNER=vercel` and a matching Bearer `CRON_SECRET`; a user session, unsigned request, or a Cloudflare-owned deployment cannot invoke it. The Cloudflare hook accepts the same owner variable set to `cloudflare`. The variable is unset by default, leaving both new paths inert until a single owner is selected. A separately deployed old Worker must still be found and disabled before activation; this code cannot turn it off remotely.

Each allowed job has a unique scheduled slot in `maintenance_job_runs`. A duplicate invocation skips a completed or started job. A claimed lease that expired before start can be recovered; a started job never auto-resumes because its side effect may have completed. Each job records success/failure separately. A partial scheduled run returns HTTP 500 or fails the Worker invocation and is not reported as success. Manual runs carry `trigger_source=manual` and do not contribute to scheduled-health success.

The original T07 allowlist was evaluateEscalations, settleNotificationAttempts, redactNotifications, and escalateStalledQuarantine. Current source also runs runBulkOperations (at most two approved operations and 25 items per operation per tick); live provider mode adds runNarImportStageJobs. A verified WhatsApp media configuration additionally enables drainInboundMediaDownloads. SLA escalation selects at most 100 unrecorded due items per tick; outbox settlement/redaction and quarantine reads are capped. No notification provider dispatch, reminder enqueue, document scan/analysis, upload deletion, or external handoff is enabled by this adapter. Bulk actions retain per-item server authorization and reuse the single-item domain services. Inspect the actual queued work and provider configuration before activation; the original four-job description alone is insufficient.

## Platform and credential gate

Vercel's current documentation says Cron sends GET to the production URL, may miss or duplicate an invocation, and does not retry failures. Five-minute cadence requires a paid plan; Hobby is limited to once daily. Confirm the project's plan and function duration before deploying. See [Cron Jobs](https://vercel.com/docs/cron-jobs), [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs), and [Usage and Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing). Vercel Instant Rollback does not update active cron registrations.

| Variable | Source before activation | Use |
| --- | --- | --- |
| `MAINTENANCE_SCHEDULER_OWNER` | Deployment configuration after confirming the sole owner | Set to exactly `vercel` or `cloudflare`, never both deployments concurrently |
| `CRON_SECRET` | Operator-generated Vercel production secret, at least 16 characters; never in source/logs | Bearer authorization for the Vercel GET |
| `DATABASE_URL` | Verified target Neon branch binding | Job leases and maintenance evidence; production migration needs separate approval |

## Read-only preflight

Run with a read-only role against the identified target branch and save database identity, ledger, old Worker state, current SHA and deployed alias:

```sql
select current_database(), current_user, inet_server_addr();
select id, applied_at from schema_migrations where id >= '0033' order by id;
select trigger_source, state, job_kind, count(*)
from maintenance_job_runs
group by trigger_source, state, job_kind order by trigger_source, state, job_kind;
select scheduled_for, trigger_source, outcome, failed_passes
from maintenance_runs order by scheduled_for desc limit 10;
```

The last two queries require migration `0035_maintenance_job_runs.sql`; before migration, first check `to_regclass('maintenance_job_runs')`. Record a migration preview and rollback rehearsal on a clone before any production write.

## Acceptance and rollback

Local RED: three named scenarios failed before code. Local GREEN: controller, HTTP auth, owner gate and SQL concurrency/lease tests, including a real-Postgres resumed failure that persists as partial. Full disposable-Postgres suite: 187/187 files and 1753/1753 tests; typecheck, build, 12-route import check, offline verifier, and schema inspection passed. Lint had zero errors and one existing fast-refresh warning.

Follow-up SLA freshness regression: the new scheduler stores successful escalation work under `passes.jobs`, while the work queue previously read only legacy `passes.escalations`. A disposable-Postgres RED test reproduced the stale timestamp; the query now accepts successful `evaluateEscalations` job evidence and ignores a later failed job. Focused 5/5, typecheck and lint (0 errors, 1 baseline warning) passed after the fix.

Runtime acceptance requires **three consecutive actual scheduled** records from the chosen environment with UTC scheduled times, deployment SHA, owner, each job's state, and database identity. Confirm no second scheduler is consuming the same queues and that no provider send ran. Manual invocations cannot replace those three records.

To stop the new path, unset `MAINTENANCE_SCHEDULER_OWNER` and disable the Vercel cron registration in project settings before rolling back code; Vercel's Instant Rollback alone leaves cron registration unchanged. Keep `maintenance_job_runs` as evidence when any rows exist. A schema reversal is safe to test only if the table is empty and no scheduled process is active:

```sql
begin;
lock table maintenance_job_runs in access exclusive mode;
do $$
begin
  if exists (select 1 from maintenance_job_runs) then
    raise exception 'T07 rollback gate failed: job evidence exists';
  end if;
end $$;
drop table maintenance_job_runs;
delete from schema_migrations where id = '0035_maintenance_job_runs.sql';
commit;
```

The forward and reversal SQL were rehearsed on a second disposable PostgreSQL 17 database. The rollback guard rejected a row containing job evidence and left the table intact; after that row was removed, the rollback committed and both the table and 0035 ledger entry were absent. That database was then removed. This reversal remains a review artifact. No production migration, deployment, live send, invitation, or permission change is authorized here.

## Activation preflight — 2026-09-29

The user approved the remaining release process. The exact deployment request and rollback reference are saved in evidence/2026-09-29-runtime-activation. Target source e7dcb70 has the identical tree to PR #99 head 9b6007f, whose CI passed 1,965 tests with five skipped. Fresh focused scheduler tests passed 16 with three database tests skipped.

The available Cloudflare account contains 13 workers, none with a Kossilon name or visible binding match; secret values are opaque and other accounts were not inspected. Vercel is Pro. The named Neon target has 65 migrations and zero bulk operations, NAR staging jobs, outbox entries and maintenance runs. With the current default live provider mode, six jobs are expected; the outdated four-job list above has been corrected.

Automatic approval review rejected the production DATABASE_URL, CRON_SECRET and owner write before execution, requiring explicit permission for transferring the named Neon credential to the named Vercel production project. A precise confirmation is pending. Configuration and deployment have not run. The original sensitive production DB value cannot be read back; the proposed configuration explicitly binds the previously authorized Neon target. Browser verification is separately blocked by the CUA Windows sandbox ACL startup error.
