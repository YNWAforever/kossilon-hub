# Pilot operations runbook

This is a gate for a small internal pilot, read with [release acceptance](release-acceptance-2026-09-27.md), [firm deployment](firm-deployment.md) and [backup and restore](backup-restore.md). The 2026-09-29 live Vercel redeploy serves integration SHA 0230c90. The explicitly authorized Neon target is verified through 0065; deployment DB binding, authenticated journeys and pilot acceptance remain separate gates.

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

The deployed integration source and designated Neon schema are recorded in release acceptance. Exact deployment DB binding, authenticated browser role and E2E evidence, provider contracts, three scheduled runs, joint DB/R2 restore, deployed performance and pilot acceptance remain unverified. Production scheduler owner and CRON_SECRET are absent in the inspected metadata, despite an enabled five-minute cron registration. The T27 local 20k-case benchmark is a source baseline, not a deployed SLA result.
