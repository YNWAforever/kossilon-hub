# R02 / F01 / F17: approved historical release policy

The ordinary migrator and its strict history checks are unchanged. Historical source IDs remain divergent after an additive release. A database receipt alone cannot authorize compatibility, migration, deployment or a business action.

`evaluateHistoricalReleaseCompatibility` requires an independently reviewed artifact bound to the exact build SHA and stable target identity. Payload, canonical receipt manifest, original ledger and **post-release** catalog hashes must match. Every reviewed physical contract must be present exactly once and match; missing, extra, duplicate, empty or false contracts fail closed. The result always reports `ordinaryMigrationAllowed=false` and `historyState=divergent`. Application schema compatibility is only one release gate.

## Complete read-only catalog

`readReleaseCatalog` reads all non-extension relations and functions in the application namespace. It fingerprints columns/types/defaults/nullability/identity/generated values, visible column order, constraints and validation, index definitions with valid/ready/live flags, trigger definitions and enabled modes, routines, RLS/policies and effective database-role privileges. Unknown tables are included rather than silently attributed. No DDL, grants or ledger writes occur. Operations uses a repeatable-read/read-only transaction and shows ledger history, approved compatibility and native health separately. Without a reviewed release policy it remains blocked.

Algorithm: `canonical-json-v1-sha256`: recursively sort object keys, preserve array order, serialize UTF-8 JSON, lowercase SHA256. Receipt manifest hash is computed from the actual JSONB manifest; no imaginary `manifest_sha256` column is assumed. The external package manifest's added `packageSha256` is a separate package identity. Do not conflate these hashes or trust a database to approve itself.

Database grants/RLS metadata cannot prove the server's company/team authorization. The approved build must also retain the negative authority tests, and R05 must provide fresh provider role evidence. No externally approved artifact has yet been supplied to this build. The injectable server boundary is ready; genuine environment binding remains blocked. The offline release verifier still returns `productionReleaseGate=NO_GO` even when its original UAT parser passes.

## Actual PG18.6 rehearsal

Receipt: [2026-10-03-r02-historical-rehearsal.json](evidence/2026-10-03-r02-historical-rehearsal.json). Reconstructed the exact 66 historical SQL files with original git hashes on a newly owned loopback database. The real `pg_dump -Fc` and `pg_restore --exit-on-error --no-owner` restore verified all original 82 table row hashes, full logical catalog, original ledger and effective local role privileges.

- Before complete catalog: `33ab9559ad18df2d098ffd2df7d1493c1825f4b15340ee5bab7c281207e2ba26`.
- Actual post-release catalog: `00d4cf0315db3edd9d1ff68cff5c444cfc90bb9915d4977ff680561cef2af3d2`.
- Original ledger before/after: `2640a4a57d8b09fff1d21bc35852f23b4d4a18fbe4e31f4396171486322390d4`, 66 rows; no invented file hashes.
- After: 94 tables, one separate release receipt; original data retained.
- Forced error before receipt: P0001, full rollback with no added tables/receipt.
- Changed catalog and repeat attempts: P0001 refusal, no replay or extra receipt.
- Existing two-connection table/function DDL fence tests run on actual PG18.6; function DDL requires the cooperating advisory lock and a sole-owner freeze.

The first restore check exposed that PostgreSQL renumbers internal slots left by dropped columns during logical restore. The new collector uses visible-column order, preserving the actual runtime contract. The frozen 2026-10-02 SQL/manifest and their strict pre-release guard remain byte-identical. A hosted restore must re-observe that guard and may require a separately reviewed target-specific package; never bypass a refusal.

Rehearsal now refuses to overwrite earlier evidence or rewrite the frozen package. It retains uniquely owned local databases/dumps for inspection. Local restore is not hosted restore, real workload or production UAT.

## Remaining approval inputs

DB owner: approved hosted staging identity and app role; logical owners for the seven unattributed tables; sole DDL owner/freeze and non-FK dependency review. Release owner: reviewed external build/environment-bound approval artifact, complete contract hashes, deployment/scheduler identities and acceptance receipts. No new production migration or deployment has been performed.
