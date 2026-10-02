# B05 / T01, T22 — historical release compatibility

**NO_GO for production.** This is a locally verified, offline review package. It does
not authorise SQL, deployment, scheduler activation, messages, invites or grants.
Original 50 UAT cases remain 19 LOCAL ONLY pass / 31 blocked / 0 not_run.

## Current source and observed target

All fourteen source PRs #102–#115 are merged by normal merge commits. Main is
`73d999dfa524f273d0c062458cbf780f65630e6c`; push CI
[37006479098](https://github.com/YNWAforever/kossilon-hub/actions/runs/37006479098)
passed all existing gates, real Postgres17, 230 files / 2183 tests / 0 skips and
12 local Chrome demo tests. This does not prove runtime UAT.

Vercel last read-only observation 2026-10-02T12:34:36Z: production alias remains
`aa5d3cbddd895bca953b6eef7266ae1cc0b46215`, deployment
`dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`, READY. Source Git deployments for main are held
in vercel.json; manual CLI/API promotion and external automation require separate
controls. No new production deployment was performed.

Neon target `red-morning-00331124` / `br-muddy-mountain-aov8bbku` / `neondb` is
production/default/ready. Read-only inventory 2026-10-02T12:57:40Z: Postgres18.6,
66 ledger IDs with unknown recorded hashes, 89 tables / 1043 columns / 274 indexes /
1352 constraints, 3 companies / 14 documents / 14 versions / 4 pending outbox rows.
Dispatch marker is absent. Later metadata-only fingerprint is timestamped in
[catalog guard evidence](evidence/2026-10-02-historical-catalog-guard.json).

## Reproduced conflicts and reviewed adaptations

All 66 original SQL files were retrieved with exact git-blob hashes from
`b87dfbba374add601d6a5fdbf772dd539c73cd88` and actually executed locally. Those hashes
prove source provenance; they do not establish the bytes historically applied to Neon.
On Postgres18.6, all 82 attributable tables match columns, indexes and constraints;
the package fingerprint also includes their triggers and nine original functions.
Postgres17's 699 differences were explicit Postgres18 NOT NULL catalog constraints;
the nullable column facts match and Postgres18 has zero differences.

| Input | Actual failure                                                                    | Adaptation                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0073  | P0001, old seven-kind CHECK correctly rejected                                    | Validate exact, validated old/bridge CHECK; retain all seven old kinds and add runBulkAssignments. No old work state or lease rewrite.                                        |
| 0074  | 42701, return_year already exists                                                 | Validate nullable integer/no default/exact validated 1900–2100 CHECK; retain chosen and unknown years; execute the remaining statements.                                      |
| 0080  | 42701, external_reference already exists; document_version_id also already exists | Validate nullable text/UUID, no defaults, and exact validated document-version RESTRICT FK; retain old evidence and stricter deletion contract; execute remaining statements. |
| 0082  | 42701, revision already exists                                                    | Validate integer NOT NULL/default1/exact validated positive CHECK; retain current revision values; execute remaining statements.                                              |

Published db/migrations bytes and db-migrate.ts guards are unchanged. Twelve input
files execute verbatim; four are explicitly adapted. Input hashes, bridge/compiler
hashes, full package hash and DDL payload hash are recorded in the
[manifest](releases/2026-10-02-historical-release-manifest.json).

The [compiled SQL](releases/2026-10-02-historical-release.sql) takes the existing
migration advisory lock and bounded locks on all 82 attributable tables **before**
reading the catalog. These locks remain until commit/rollback. It requires the exact 66 IDs and
Postgres18 physical fingerprint, rejects existing temporary objects, applies all
reviewed DDL in one transaction, verifies the original complete ledger unchanged,
then inserts one independent `schema_release_receipts` row for the executed package.
The receipt hashes the actual DDL payload; manifest input hashes are provenance,
including explicit adaptations. Review the complete artifact SHA256 externally.
No original migration ID is invented. Repeat or a pre-existing receipt table fails
closed; after any SQL error, issue ROLLBACK on that session before further reads.

The fingerprint includes index valid/ready/live flags and trigger enabled modes,
as well as their definitions. All coordinated function/schema DDL must acquire the
same transaction advisory lock `hashtext('kossilon:schema-migrations')` (as the normal
migrator already does). A two-connection contract proves table DDL and cooperating
function DDL cannot pass the fence. PostgreSQL relation locks do not prevent a
privileged operator changing a function while ignoring that advisory lock: the
release owner must prove a sole DDL owner/freeze and permissions before hosted execution.
Those permission/owner facts remain unverified and production NO_GO; no grant or
revoke is performed by this package.

Adapted 0080 uses a temporary non-unique manifest index; verbatim 0081 replaces it
with final active-attempt uniqueness in the same transaction. Valid completed/cancelled
duplicate approvals remain unchanged, while a legacy NULL/unknown outstanding attempt
still blocks a new attempt. It never creates transient full uniqueness over all history.

**Source history health intentionally remains divergent after this package.**
There is no automatic receipt-to-migration alias. The strict migrator still refuses
unknown historic IDs/gaps and cannot be used for this release. A reviewed application
lineage/readiness policy and per-feature runtime acceptance remain separate work.

## Reproducible local verification

The actual commands and aggregate/row-hash evidence are in
[historical reproduction](evidence/2026-10-02-historical-schema.json) and
[complete package rehearsal](evidence/2026-10-02-historical-release-rehearsal.json).
No production connection string is used. Rehearsal creates a uniquely named owned
database on the inspected `kossilon-release-pg18-20261002` container, loopback55448,
and requires Postgres18. It never resets an existing database. It retains the owned
database for review; clean it up only by its recorded exact identity.

```powershell
$env:TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55448/kossilon_release_contract'
$env:DATABASE_SSL='disable'
node --experimental-strip-types scripts/rehearse-historical-schema-release.mjs
node node_modules/vitest/vitest.mjs run scripts/prepare-historical-schema-release.test.ts
```

The historical git object must be available; fetch that exact original object if
missing. Full rehearsal validates all original 82 tables' row hashes across success,
forced pre-receipt failure/rollback and repeat refusal. A controlled unexpected column
is rejected before DDL. Local fixtures include old unknown maintenance work, explicit
2026/NULL year and revision7; these are synthetic preservation cases, not live data.
The complete package ends at 94 local tables / 66 unchanged migration rows / 1 actual
release receipt. It does not certify scan, receipt, payment or external submission.

Independent review found three Important issues, now reproduced and fixed in one
RED/GREEN pass: enforcement flags, pre-catalog DDL locks, and completed handoff history.
Seventeen new real Postgres contracts pass, including genuinely failed concurrent
unique-index creation and two-connection races. The complete historical rehearsal now
contains two returned/cancelled attempts sharing a manifest and one legacy unknown
attempt; original rows remain identical, a new attempt after completion is allowed,
and a new attempt over unknown is refused23505. The new test file is in the repository's
serialized DB integration registry; the initial362e127 CI failure exposed that omission.

The compiler is offline: `node --experimental-strip-types
scripts/prepare-historical-schema-release.ts` writes SQL to stdout only. The tracked
artifact is frozen by the rehearsal, not an automatic production migration command.
Preserve UTF-8/LF when saving stdout; changing SQL or compiler requires fresh review,
hashes and local rehearsal.

## Remaining gates, owner and next action

| Gate                                       | Owner                      | Next concrete action                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seven unattributed tables                  | DB/data owners             | Identify hk_funding_schema_migrations, personal_workspaces, sync_changes, sync_conflicts, sync_entities, sync_field_revisions, sync_operation_receipts. Their six FKs link within that group; no observed attributable FK points to them. Ownership, grants and non-FK dependencies remain unknown. Preserve every object/row. |
| Provider recovery and real workload        | DB/release operator        | Review this exact SQL/hash and pause/drain the actual scheduler; approve a non-finalizing isolated clone/recovery point and genuine restore/row/FK/catalog/workload rehearsal. Never swap the production endpoint to inspect a snapshot.                                                                                       |
| Source lineage/readiness                   | App/DB owners              | Review the separate release receipt versus expected migration IDs; do not add fake aliases or historical applied hashes. Validate all feature contracts and preserve strict migration refusal.                                                                                                                                 |
| Fresh Auth / 31 blocked UAT                | Auth/business owners       | Supply approved isolated staging origin and existing controlled-role credential-store locations; perform fresh callbacks and original acceptance flows. No existing browser session substitutes for Auth verification.                                                                                                         |
| Storage, scanner, OCR/AI, WOZTELL, handoff | Respective provider owners | Complete the exact controlled samples/receipt/golden-accuracy gates in release-checklist.md; do not label mocks or dry-run as integration.                                                                                                                                                                                     |
| Deployment/runtime                         | Release/Operations owners  | Node24 production versus Node22 CI parity; concrete candidate deployment package and new approval; sole scheduler owner and three actual native ticks. No live sends authorised.                                                                                                                                               |

## Rollback

Before commit, any guard/DDL/uniqueness/receipt failure rolls back the whole transaction.
Keep dispatch paused. Do not selectively skip a rejected statement to finish a release.
After commit, retain additive fields/tables/constraints, unknown-send fences and the
actual receipt; prefer approved code rollback while dispatch remains paused. Do not
drop evidence, reopen unknown work or rewrite the ledger. A provider restore is a
separately approved incident operation; preserve and reconcile writes made after the
recovery point before restoring. Local rollback is not a provider restore claim.
