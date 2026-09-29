# Pilot operations runbook

This is a gate for a small internal pilot, read with [release acceptance](release-acceptance-2026-09-27.md), [firm deployment](firm-deployment.md) and [backup and restore](backup-restore.md). The current live Vercel deployment serves approved b87dfbb with owner=vercel. The designated Neon binding is observed through actual cron writes. Its schema now has 66 migrations after the explicitly authorized forward repair; three actual scheduled ticks at 00:35/00:40/00:45 HKT passed with six successful jobs each. Authenticated journeys and pilot acceptance remain separate gates.

## Before any pilot

1. Bind the exact reviewed commit SHA, deployment ID, database identity and migration ledger. The named Neon target legacy alias was reconciled and 0021–0065 applied under explicit authorization; retain its recorded evidence. Obtain authorization for any further non-local schema change.
2. Rehearse the exact forward migration on a populated isolated clone, including existing outbox and package rows. Record row counts, checksums, failed/processing states and a named restore point. The T28 local 0001–0060 to 0061 rehearsal is evidence for that change only.
3. Run `npm run verify:firm -- --dry-run` and resolve every blocked binding against an approved provider contract. This command checks names only; it neither tests a provider nor sends anything.
4. On the deployed SHA, run the role matrix and the three end-to-end journeys with permitted test identities and non-sensitive cases. Record the case, audit and document-version IDs. Keep demo read-only.
5. Observe three consecutive scheduled ticks and one controlled failure/recovery. A manual tick is not scheduler evidence. Verify the built Vercel scheduler handler and the runtime trigger.
6. Obtain an internal pilot acceptance decision on the release record. Start with a small set of authorized cases; enable bulk scope only after the single-item workflow is accepted. Do not send to a live recipient or invite staff without the required separate authorization.

## Daily operations

Open `/operations` → 五分鐘排程. Record the last scheduled run ID, time and pass results. `從未觀察到執行` means the trigger has not been proven on that runtime; `排程已停止` means ticks were missed; `最近一次執行失敗` and `部分環節失敗` require the named pass and deployment logs. A manual run must not clear a missing-schedule finding.

Work in this order: monthly import preview and mapping → approved apply → chase draft and approval → clean scanned document and human review → payment proof and human reconciliation → immutable package approval → human external upload with submission proof → internal server return or manual intake → human reconciliation → completion. Downloading a package is preparation, not a filing. A date in a monthly table is not payment evidence. An unknown provider send remains unknown until provider reconciliation; never auto-retry it.

## Pause and recovery

Stop the affected scheduler/worker or remove its approved provider binding through deployment configuration. Preserve pending and unknown outbox rows, package manifests, proof versions, return candidates and audit IDs. Do not delete evidence or reverse a forward migration to pause a capability. Missing scanner or AI bindings leave documents in manual review; missing messaging bindings leave drafts/queued outcomes for inspection. A processing or unknown external outcome needs provider evidence before replay.

If a write or release check fails, stop consumers, keep the current records, and use the named pre-change snapshot in an isolated restore rehearsal. Compare the database and R2 object versions together before any traffic switch; see [backup and restore](backup-restore.md). Roll back an application deployment only after checking its compatibility with the current schema. Report the exact failed gate and owner in the release record.

## Open runtime gates

The initial e7dcb70 cron failed at 2026-09-29 15:50 UTC with PostgreSQL 23514 on the missing NAR job-kind allowance. Five jobs succeeded; four SLA notifications remain pending and none was sent. Owner was then unset, and the subsequent scheduled request returned 503 on the historical paused deployment dpl_C2qVk7u8yQYFTjwtsvcidPJ5ZQhi. Do not replay the old slot or automatically dispatch pending notifications.

The local repair and migration rehearsal are in [scheduler-0066-repair](scheduler-0066-repair.md). New migration 0066 and repaired deployment were explicitly approved and completed; active production is dpl_8aTN6kA5qcs3vRWCwUccqZBS6v9o at b87dfbb. Three successful scheduled ticks are verified in the release record. Authenticated browser role/E2E evidence, provider contracts, joint DB/R2 restore, deployed performance and pilot acceptance remain unverified. Browser control currently fails at initialization. The T27 local 20k-case benchmark is a source baseline, not a deployed SLA result.
