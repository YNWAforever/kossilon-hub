# R02 / F01 / F17: approved historical release policy

The ordinary migrator and its strict history checks are unchanged. Historical source IDs remain divergent after an additive release. A database receipt alone cannot authorize compatibility, migration, deployment or a business action.

`evaluateHistoricalReleaseCompatibility` requires an independently reviewed artifact bound to the exact build SHA and stable target identity. Payload, canonical receipt manifest, original ledger and **post-release** catalog hashes must match. Every reviewed physical contract must be present exactly once and match; missing, extra, duplicate, empty or false contracts fail closed. The result always reports `ordinaryMigrationAllowed=false` and `historyState=divergent`. Application schema compatibility is only one release gate.

## Complete read-only catalog

`readReleaseCatalog` reads all non-extension relations, sequences and functions in the application namespace. It fingerprints columns/types/defaults/nullability/identity/generated values, visible column order, constraints and validation, index definitions with valid/ready/live flags, trigger definitions and enabled modes, routines, RLS/policies and effective database-role privileges. Relation persistence, options, view definitions and partition definitions are included. Sequence definitions, ownership dependencies, grants and privileges are included; advancing sequence values are business state and are excluded. Relation and routine owners, effective RLS enforcement, current/session role, role security attributes and reachable membership INHERIT/SET/ADMIN options are included. Membership traversal also starts from object owners: a security-definer owner's inherited role can change its tenant policy without changing the collector's role. No role password is read. Unknown tables are included rather than silently attributed. No DDL, grants or ledger writes occur. Operations uses a repeatable-read/read-only transaction and shows ledger history, approved compatibility and native health separately. Without a reviewed release policy it remains blocked.

Algorithm: `canonical-json-v1-sha256`: recursively sort object keys, preserve array order, serialize UTF-8 JSON, lowercase SHA256. Receipt manifest hash is computed from the actual JSONB manifest; no imaginary `manifest_sha256` column is assumed. The external package manifest's added `packageSha256` is a separate package identity. Do not conflate these hashes or trust a database to approve itself.

Database grants/RLS metadata cannot prove the server's company/team authorization. The approved build must also retain the negative authority tests, and R05 must provide fresh provider role evidence. No externally approved artifact has yet been supplied to this build. The injectable server boundary is ready; genuine environment binding remains blocked. The offline release verifier still returns `productionReleaseGate=NO_GO` even when its original UAT parser passes.

## Actual PG18.6 rehearsal

Original receipt: [2026-10-03-r02-historical-rehearsal.json](evidence/2026-10-03-r02-historical-rehearsal.json). This immutable first receipt used the incomplete collector subsequently rejected in fresh review; its catalog hashes are **not eligible approval inputs**. It reconstructed the exact 66 historical SQL files with original git hashes on a newly owned loopback database. The real `pg_dump -Fc` and `pg_restore --exit-on-error --no-owner` restore verified all original 82 table row hashes, the then-observed catalog and original ledger.

- Superseded before catalog: `33ab9559ad18df2d098ffd2df7d1493c1825f4b15340ee5bab7c281207e2ba26`.
- Superseded post-release catalog: `00d4cf0315db3edd9d1ff68cff5c444cfc90bb9915d4977ff680561cef2af3d2`.
- Original ledger before/after: `2640a4a57d8b09fff1d21bc35852f23b4d4a18fbe4e31f4396171486322390d4`, 66 rows; no invented file hashes.
- After: 94 tables, one separate release receipt; original data retained.
- Forced error before receipt: P0001, full rollback with no added tables/receipt.
- Changed catalog and repeat attempts: P0001 refusal, no replay or extra receipt.
- Existing two-connection table/function DDL fence tests run on actual PG18.6; function DDL requires the cooperating advisory lock and a sole-owner freeze.

The first restore check exposed that PostgreSQL renumbers internal slots left by dropped columns during logical restore. The new collector uses visible-column order, preserving the actual runtime contract. The frozen 2026-10-02 SQL/manifest and their strict pre-release guard remain byte-identical. A hosted restore must re-observe that guard and may require a separately reviewed target-specific package; never bypass a refusal.

Rehearsal now refuses to overwrite earlier evidence or rewrite the frozen package. It retains uniquely owned local databases/dumps for inspection. Local restore is not hosted restore, real workload or production UAT.

## Fresh review and revised rehearsal

Fresh review reproduced two Important gaps on local PG18.6: changed view/sequence/table durability, and BYPASSRLS changing visible tenants from one to two, left the old fingerprint unchanged. Six new database regression cases first failed (6 failed / 2 passed); after the single fix pass all eight catalog tests passed. They also cover view `security_invoker`, relation options, sequence ownership and advancing values, table/security-definer ownership, and reachable membership INHERIT/SET drift. Temporary roles/schemas are rolled back.

New immutable receipt: [2026-10-03-r02-historical-rehearsal-v2.json](evidence/2026-10-03-r02-historical-rehearsal-v2.json). Real PG18.6 dump/restore with the revised collector passed; original 82 table row hashes and all 66 ledger rows remained unchanged within this rehearsal. Changed-catalog refusal, forced transaction rollback and repeat refusal all passed (P0001), with 94 final tables and one separate receipt.

- Revised before catalog: `80cc7b28974479232db5500930b9bec65d6ba790757f77dfe7d24e1886aea3ba`.
- Revised post-release catalog: `a248dfd69d544e6662a4970e67fc4b2b45d048d2b341f49ea2b4afb97f373ac4`.
- This new fixture's ledger before/after: `f6b186ef5a981e57f4f79378e4435a7bfeb307d07082f239a96593ac2f2679c0`; timestamps differ between separately created fixtures and are not fabricated.
- Frozen SQL `3b8bb4362dac26b2dead8df843288af5f975d9f523c99fc67d17284fec6195ad` and manifest `e1abf95905a5be9315eccf62446cab368f6e3c5941b008e52f644aa728618cae` remain byte-identical.

These hashes describe a synthetic loopback fixture. An approved hosted release requires fresh observed hashes using its **actual restricted app role**, environment and exact approved build; never copy the local hashes into a hosted approval.

The same Important privilege fix pass also reproduced a security-definer owner's membership change: its function returned two companies instead of one while the collector stayed `postgres` and the old hash stayed unchanged. This additional targeted RED was 1 failed / 8 filtered out; the complete catalog file then passed 9/9 with no skips. Recursive membership traversal now covers object owners as well as the current app role.

Final immutable rehearsal: [2026-10-03-r02-historical-rehearsal-v3.json](evidence/2026-10-03-r02-historical-rehearsal-v3.json). Restore, catalog refusal, transaction rollback and repeat refusal passed again. Catalog hashes agree with v2 for this all-`postgres`-owned historical fixture; v3's separate original ledger hash is `191ff06570a07ca78e3355aa20258e13ca4f4f6423c8d8b703b07b7b23604a9f` before/after. The restricted security-definer fixture provides the additional owner-membership proof. Earlier receipts remain immutable.

The Minor review finding remains deferred: the rehearsal receipt's `source_baseline` denotes historical provenance and does not independently identify the executing revision/source-file hashes. PR commits and the separate review verification receipt identify this local fix; future rehearsal receipt source identity remains follow-up work. The external approval artifact/runtime loader remains accurately blocked and is not replaced by a local fixture.

## Remaining approval inputs

DB owner: approved hosted staging identity and app role; logical owners for the seven unattributed tables; sole DDL owner/freeze and non-FK dependency review. Release owner: reviewed external build/environment-bound approval artifact, complete contract hashes, deployment/scheduler identities and acceptance receipts. No new production migration or deployment has been performed.
