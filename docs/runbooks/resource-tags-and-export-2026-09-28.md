# T22 resource tags and authorized CSV export

## Local implementation

- 0052 adds separate positive tag revisions and normalized tags to clients, annual-return cases, and work items. Each successful change creates a resource_tag_events audit row in the same transaction.
- 0053 registers the tag action with the existing bulk preview/operation constraints. The T09 runner freezes selected IDs and tag revisions, rechecks the current actor/team and each item, and calls the single-resource tag service. An item failure rolls its domain write back through a transaction or savepoint; retry resumes from the persisted item state.
- Client register, annual-return board, and work queue use current-page IDs or the server-owned all-matching filter and exclusion list. A tag cannot be queued until the read-only preview is explicitly approved. Filter changes close the dialog.
- The same three toolbars export a current, whitelisted CSV through a POST server function. It resolves the selected IDs again, checks the active Admin/Manager profile, and excludes rows outside the current team scope. It never exports private document contents, provider payloads, or arbitrary SQL columns. Each cell is quoted and formula prefixes after leading whitespace are escaped. The response reports selected and exported counts; a moved or unavailable row is omitted.
- Demo routes remain read-only. This local work does not apply production migrations or send messages.

## Evidence and reversal

- Disposable PostgreSQL integration tests cover a foreign team, stale revision, audit, mixed tag operation, interrupted write rollback and resume, strict filter validation, formula escape, and foreign row exclusion. The tag dialog test covers preview-before-approval and preview invalidation after edits.
- On a separate disposable clone, 0053 then 0052 were rolled back and reapplied. 0052 refused rollback while a synthetic tag row existed. The SQL in resource-tags-rollback-0052.sql and bulk-tag-rollback-0053.sql deliberately refuses destructive reversal when business evidence exists.
- For an authorized deployment, reconcile the target migration ledger and schema before any write, apply 0052 before 0053, and run role-specific browser checks for client/case/work selection, preview, approval, resume and CSV download. Do not run the rollback scripts against business data. Runtime DB, auth, browser and provider access were not available for this local proof.
