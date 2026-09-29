# Scheduler repair after the first live tick

**Current status — 2026-09-30 HKT:** migration 0066 is applied on the designated Neon target (66 migrations, 12/12 schema capabilities ready). Production deployment dpl_8aTN6kA5qcs3vRWCwUccqZBS6v9o serves b87dfbb with owner=vercel. Three actual scheduled slots at 00:35/00:40/00:45 HKT passed, six jobs each. See the final verification section and [saved evidence](evidence/2026-09-30-scheduler-repair/summary.json). Earlier local-only, activation and containment observations below are historical; authenticated browser/provider/pilot gates remain open.

## Observed failure
The authorized e7dcb70 deployment reached Ready on 2026-09-29. At 15:50 UTC its actual cron wrote five successful job rows, then PostgreSQL rejected runNarImportStageJobs with SQLSTATE 23514. Migration 0045's job-kind constraint lists six kinds and omits the NAR staging worker later enabled in source. The controller threw before recording the run summary. Four SLA notifications are pending; none was sent by this scheduler.

## Historical containment before the approved repair
The historical paused deployment dpl_C2qVk7u8yQYFTjwtsvcidPJ5ZQhi ran the same approved e7dcb70 with MAINTENANCE_SCHEDULER_OWNER unset. A subsequent actual cron returned 503. Keep all five job rows and four pending outbox rows. Never replay the interrupted slot or dispatch those notifications automatically.

## Forward repair procedure (completed under explicit authorization)
Review db/migrations/0066_nar_import_scheduler_job.sql. It adds only runNarImportStageJobs to the existing explicit allowlist, retains all six existing kinds, and changes no job rows. Lock timeout is five seconds; statement timeout is thirty seconds. The normal migrator applies the SQL and ledger entry in one transaction. New application code also retains partial run evidence on claim/begin/state-read errors and blocks schema readiness when this constraint value is absent.

The following preflight and rollout steps were completed for the authorized 0066 application:
1. Obtain explicit authority for migration 0066 and the tested repair commit. Existing authority covered 0021–0065 and deployment e7dcb70.
2. Reconfirm the exact target red-morning-00331124 / br-muddy-mountain-aov8bbku / neondb, paused owner and 65-entry canonical ledger. Review the old constraint and the five historical rows; stop for unexpected drift.
3. Create a fresh no-compute recovery branch or named snapshot. Never use restore_snapshot with implicit finalize.
4. Run only the reviewed 0066 forward migration via the repository migrator; verify the 66-entry ledger, full schema report, unchanged historical job rows and pending outbox.
5. Deploy the CI-green repair source with owner still unset, verify readiness, then re-enable only the reviewed non-dispatch scheduler scope.
6. Observe three actual consecutive scheduled ticks with SHA and each job outcome. Do not use a manual tick as scheduled evidence.

## Local verification
The original behavior failed four targeted tests: missing job-kind allowance, false schema readiness, claim failure and begin failure losing run evidence. After the fix, focused PostgreSQL and controller/schema tests passed 41/41. An isolated upgrade rehearsal preserved all five original job rows byte-for-byte, admitted the NAR job, rejected an unrecognized job, and rolled the entire transaction back. Full local suite: 1,969 tests passed, five skipped; 228 files passed, one skipped; exit 0. Typecheck passed; lint had zero errors and one existing warning. Independent review found no blocking findings. Repair source commit: 1bca4a5671b909278d63327ab69dbda03a2dae38. Exact-head CI results are recorded with the repair PR.

## Rollback
If the migration fails, its transaction rolls back SQL and ledger together. If runtime verification fails, unset owner and redeploy the approved source so the active cron fails closed; verify 503 before any traffic rollback. Keep the additive 0066 constraint and all run/job records: application rollback does not need a destructive down migration. The existing e7dcb70 source remains compatible with the widened constraint, but its scheduler must stay paused until verification can be resumed. Old deployment rollback alone does not update Vercel cron registrations.

## Remaining gates
No authenticated browser E2E or pilot acceptance has been completed. Browser control exits before it exposes a session. Provider sending, scanning, remote handoff and additional permissions are outside this repair.

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
