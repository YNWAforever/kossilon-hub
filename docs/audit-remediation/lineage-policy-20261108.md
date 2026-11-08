# Reviewed historical lineage policy — 2026-11-08

## Why this exists

The production database was reconciled by the frozen package
`kossilon-historical-release-20261002` (package SHA256 `3b8bb436…`; receipt
`e685b365…`, executed 2026-11-08). That package intentionally preserves the
**66 historical migration IDs** and applies the 16 forward candidates on top,
recording one release receipt. It does not rewrite `schema_migrations`.

As a result the database ledger is, by design, not identical to the current
`db/migrations/` directory (50 files). Before this change the app's schema gates
treated that expected divergence as failure:

- `assertMaintenanceSchema` saw `diverged` and refused every maintenance tick (HTTP 503);
- `assertApplicationWriteSchema` — which uses the same assertion — refused **every app write**
  with `SCHEMA_WRITE_BLOCKED`.

## What this change does

1. `HISTORICAL_MIGRATIONS` — the exact 33 recorded IDs that the package preserves
   (`0034_notification_delivery_attempts.sql`, `0035`–`0066`). Provenance: the frozen
   package manifest in `docs/audit-remediation/releases/2026-10-02-historical-release-manifest.json`
   (historical source `b87dfbba…`; 66 original SQL files, source hashes verified).
2. `FORWARD_REPAIRED_MIGRATIONS` — the one expected ID whose ledger receipt is
   satisfied another way: `0034_notification_outbox_dispatch_marker.sql` was applied
   forward-only as `0067_repair_outbox_dispatch_marker.sql` on this lineage. Physical
   facts (nullable integer column + exact partial index) are still checked separately by
   `assertMaintenanceSchema`.
3. `schemaHealthOf` accepts optional `historical` / `forwardRepaired` inputs, defaulting to
   the reviewed lists. Passing `historical: []` restores strict equality for tests or future
   audits.
4. `db-migrate.ts` / `assertMigrationPreflight` are deliberately **unchanged and remain strict**:
   the normal migrator still refuses unrecognised IDs and historical gaps. Applying future
   migrations to this lineage remains a reviewed release operation.

## What this does not do

- It does not rewrite, insert or delete any ledger row.
- It does not make unknown/future IDs acceptable: an unlisted recorded ID still reports `ahead`.
- It does not authorise a release; it makes the reconciled release the app already runs on
  detectable as compatible.

## Verification

- Unit: `schema-health.test.ts` adds 5 lineage cases (current production lineage, unknown extra
  ID still ahead, missing expected migration still behind, alias cannot hide a gap, explicit
  strict mode); `application-schema.test.ts` admits the lineage only when physical facts hold.
- Run 2026-11-08: 122 passed / 56 skipped across `src/features/operations` + schema gates;
  `tsc --noEmit` clean.
