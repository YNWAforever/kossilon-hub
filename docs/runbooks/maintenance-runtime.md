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

Automatic approval review rejected the production DATABASE_URL, CRON_SECRET and owner write before execution, requiring explicit permission for transferring the named Neon credential to the named Vercel production project. The user subsequently gave explicit permission. Production-only configuration succeeded, and deployment dpl_9BsDLgpEeYxVicCCZqPE4ykbERHk at e7dcb70 became Ready; actual scheduled-run acceptance is recorded below. The original sensitive production DB value cannot be read back; the applied configuration explicitly binds the previously authorized Neon target. Browser verification is separately blocked by the CUA Windows sandbox ACL startup error.

## Authorized production activation — 2026-09-29

The named Neon DATABASE_URL and a cryptographically generated CRON_SECRET were written as production-only sensitive variables; MAINTENANCE_SCHEDULER_OWNER was set to vercel. Secret values were held in memory and not recorded. Vercel API metadata confirms the scope. The installed CLI rejected array request bodies because its serializer accepts ordinary objects only; documented single-object requests succeeded after the Windows command-shim ampersand issue was separately reproduced and avoided with direct Node argument passing.

The initial activation was deployment dpl_9BsDLgpEeYxVicCCZqPE4ykbERHk, source e7dcb70282eaaf26bb4373b667de98e0d38f83b2, Ready at 2026-09-29T15:47:07Z. Cron registration points at the new deployment every five minutes. Unsigned /api/cron/maintenance returned 401; /login and /operations returned HTTP 200 shells. No authenticated journey is inferred from those shells. Browser initialization still fails before showing a session. See evidence/2026-09-29-runtime-activation for configuration metadata, deployment request/result and the subsequent failure/pause evidence below.

## First scheduled tick failed; scheduler paused — 2026-09-29

At the actual 15:50 UTC scheduled tick, PostgreSQL rejected runNarImportStageJobs with SQLSTATE 23514 because maintenance_job_runs_job_kind_check omitted that existing live worker. Five earlier jobs succeeded and remain recorded in the designated Neon database; the exception prevented maintenance_runs summary insertion. Four SLA notifications are pending, with none sent. These records establish the active application's designated DB binding, but do not satisfy scheduler acceptance.

The owner was then unset and the same approved e7dcb70 redeployed as dpl_C2qVk7u8yQYFTjwtsvcidPJ5ZQhi. The production alias is Ready on that deployment; a subsequent actual cron returned 503. This is an intentional fail-closed pause. Retain all job and outbox evidence and do not replay the interrupted slot.

Local repair 1bca4a5671b909278d63327ab69dbda03a2dae38 adds forward migration 0066, verifies the NAR constraint definition in schema readiness, and records unknown job/partial run outcomes when claim, begin or state reads fail. RED reproduced four failures; GREEN passed 41 focused tests and the full suite passed 1,969 tests with five skipped (228 files passed, one skipped), exit 0. Typecheck passed; lint had zero errors and one existing warning. A populated local migration rehearsal preserved all five original rows, accepted the NAR kind, rejected unknown kinds and verified transaction rollback. Independent review found no blocking findings.

Production remains at 65 migrations and the scheduler remains paused. The repair introduces a new migration and deployment outside the exact 0021–0065/e7dcb70 authorization; obtain explicit approval only after the concrete PR checks pass. See [0066 repair and rollback](scheduler-0066-repair.md) and [saved evidence](evidence/2026-09-29-runtime-activation/incident.json). Three successful scheduled ticks, authenticated browser journeys, provider checks and pilot acceptance remain open.

## Authorized 0066 deployment — 2026-09-30 HKT

The user explicitly approved migration 0066, deployment b87dfbba374add601d6a5fdbf772dd539c73cd88, owner=vercel and three actual scheduled ticks. Recovery branch br-late-sun-aojgnr1k was created without compute from the original production branch at LSN 0/5863840 and verified ready. Original production/default branch and endpoint remain unchanged.

The repository migrator applied only 0066_nar_import_scheduler_job.sql, exit 0. The named Neon target now has 66 canonical migrations and the inspector reports canRelease=true. All 65 prior ledger rows, including timestamps, are unchanged. Full-row fingerprints for eight tables match before/after: maintenance job/run records, notification outbox, companies, annual-return cases/checklist, documents and payments. The five historical jobs and four pending notifications are preserved.

Paused repair deployment dpl_KDH3vNuTJLvLhWpH8MrreLkcyqQo became Ready; an unsigned maintenance request returned 503. Owner was then set to vercel and active deployment dpl_8aTN6kA5qcs3vRWCwUccqZBS6v9o became Ready at 2026-09-29T16:30:04.238Z. Its exact source is the approved b87dfbb merge, identical to PR #100's CI-tested tree. Production aliases and five-minute cron registration point to it; unsigned maintenance returns 401. No secret was rewritten or recorded.

Actual scheduled acceptance is now verified below; manual triggering was not used. See [0066 evidence](evidence/2026-09-30-scheduler-repair/summary.json). Authenticated browser journeys, provider contract checks and pilot acceptance remain open.

## Three scheduled ticks verified — 2026-09-30 HKT

The production scheduler at deployment dpl_8aTN6kA5qcs3vRWCwUccqZBS6v9o passed three consecutive actual scheduled slots on source b87dfbba374add601d6a5fdbf772dd539c73cd88:

| Scheduled time (HKT) | Scheduled time (UTC) | Duration | Successful jobs |
| --- | --- | --- | --- |
| 2026-09-30 00:35 | 2026-09-29 16:35 | 10.809 s | 6/6 |
| 2026-09-30 00:40 | 2026-09-29 16:40 | 6.119 s | 6/6 |
| 2026-09-30 00:45 | 2026-09-29 16:45 | 6.172 s | 6/6 |

Each run has trigger_source=scheduled, matching deploymentRef, no failed passes, and one successful row for each expected job: evaluateEscalations, settleNotificationAttempts, redactNotifications, escalateStalledQuarantine, runBulkOperations and runNarImportStageJobs. Each job's run_id matches its run summary. There was no manual trigger. The old five job rows and the four pending notification rows have unchanged full-row digests. No old slot was replayed, no dispatch job ran, and no duplicate job rows were created.

Vercel's bounded 16:30:04–16:46:00 UTC query reports three HTTP 200 requests and the one expected unsigned 401, with no error/fatal entries. Schema is current through 0066 with 12/12 capabilities ready. The previous real 23514 failure, safe 503 pause, preserved evidence, forward repair and three successful later slots document the observed failure/recovery sequence.

T01 is runtime-verified for the named schema/binding and T07 is runtime-verified for the observed non-dispatch scheduler scope. K01/K02 schema and K21/K13 scheduler evidence is attached; this does not close their unrelated UI/business acceptance. T08 and T29 remain runtime-blocked where authenticated browser/provider/pilot evidence is absent. Browser startup was retried and failed before exposing a session with "trusted Node process exited unexpectedly; kernel reset". Bulk and NAR staging queues were empty; these ticks do not verify real storage, scanner or messaging provider contracts. The visible Cloudflare account's earlier 13-worker ownership inspection found no Kossilon match; secret values and other accounts remain outside that inspection.

See [saved scheduler evidence](evidence/2026-09-30-scheduler-repair/scheduled-observation.json), [read-only acceptance query](evidence/2026-09-30-scheduler-repair/read-only-scheduled-evidence.sql), [release summary](evidence/2026-09-30-scheduler-repair/summary.json) and [remaining gates](evidence/2026-09-30-scheduler-repair/remaining-gates.json).
