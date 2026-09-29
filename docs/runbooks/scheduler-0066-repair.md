# Scheduler repair after the first live tick

## Observed failure
The authorized e7dcb70 deployment reached Ready on 2026-09-29. At 15:50 UTC its actual cron wrote five successful job rows, then PostgreSQL rejected runNarImportStageJobs with SQLSTATE 23514. Migration 0045's job-kind constraint lists six kinds and omits the NAR staging worker later enabled in source. The controller threw before recording the run summary. Four SLA notifications are pending; none was sent by this scheduler.

## Containment
Production deployment dpl_C2qVk7u8yQYFTjwtsvcidPJ5ZQhi runs the same approved e7dcb70 with MAINTENANCE_SCHEDULER_OWNER unset. A subsequent actual cron returned 503. Keep all five job rows and four pending outbox rows. Never replay the interrupted slot or dispatch those notifications automatically.

## Proposed forward repair
Review db/migrations/0066_nar_import_scheduler_job.sql. It adds only runNarImportStageJobs to the existing explicit allowlist, retains all six existing kinds, and changes no job rows. Lock timeout is five seconds; statement timeout is thirty seconds. The normal migrator applies the SQL and ledger entry in one transaction. New application code also retains partial run evidence on claim/begin/state-read errors and blocks schema readiness when this constraint value is absent.

Before any production application:
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
