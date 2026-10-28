# Native blockers after the 2026-10-27 track open

Native gate: **NO_GO**. Historical matrix, recounted and not re-executed:
**70 BLOCKED / 114 NOT_RUN / 0 PASS** in
`../cosec-20261025-native-plan-fccb7c22/acceptance-results.csv`
(SHA256 `287bafceb836b4e42b96cfbc006ee83dd9ac65900100d1ba199f93631537e6fb`).

Current unapproved git comparison candidate / PR base:
`ae9cbc195878235d72c8d0f1d1e49d0f3ad3e5c0` on `origin/main` after PR #149 squash merge.
Original candidate `79ad0c04da892ec03601f11c12d82fcc84039b31` and previous plan candidate
`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1` remain historical references; their
ancestry analysis applies to the original branch. No deployed checksum or
hosted CI result is bound to the current candidate here.

`execution_enabled` is `false`. `approved_packet_ids` is `[]`. Actual actions
for AP-00 through AP-12 are 0. Gate A selected bindings and 14 actual alias IDs
are `OWNER_REQUIRED`; Gate B remains `NOT_READY`. Repo reference values are
filled in [gate-a-discovery.json](gate-a-discovery.json) and
[APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md), with hashed source paths.
Historical identifiers and code contracts do not close a Native binding.

## Still blocked

1. Same-candidate artifact, required CI, SBOM or lockfile disposition, and database catalog, ledger, application role, and observer role. Local docs and the historical 41 `src/` files in `4d63818..79ad0c04` are not that identity. No schema, Wrangler, package, or workflow file changed in that range.
2. Real Auth tenant and the Gate A role map: admin, manager, staff, client, cross-team, no-team, no-profile, inactive, and no-skill. Account-switch cache, revoked sessions, RLS, and HTTP are unrun.
3. Today to the correct company and case, safe documents and internal payment review, blockers, authorized writes, independent readback, cancel, return, and reload. UC186 full handover and the 100+4 paging batch still need Native fixtures that are not identified.
4. Approved Hong Kong calendar (historical UC134 is `NOT_RUN`), three native five-minute ticks, QA backup and object restore with signed RTO/RPO, real accessibility and device performance, and controlled provider or filing receipts. Those targets are `NOT_READY`.

## What the #149 local work does not close

On the original track-open history, reminder command UUIDs, reminder receipt reads after case lock, and staff
recovery finalize resume are local product slices on top of draft PR #147
(`fcce28d6`) and the protocol note in draft PR #148 (`713f4a3d`, not an ancestor
of #149). They do not bind provider delivery, Auth, RLS, object storage, scan,
or a browser reload of a committed intent.

## First slice that waits on Gate A

AP-01-RO-1, described in [DELIVERY.md](DELIVERY.md). It is not authorized.
AP-02 through AP-12 wait on Gate B as well as on AP-01. AP-12 has no resource
IDs because this prepare pass created none.

## Repo discovery narrows owner lookup, not the execution gate

The demo Vercel project/team/deployment and fixed hostname are already in a
2026-10-25 committed receipt. That receipt leaves its deployed Git SHA and
DB/Auth isolation unknown. The historical Neon child
`br-fragrant-sunset-aosoylhr` / `kossilon-r01-staging-20261004` in
`red-morning-00331124` had no endpoint; a later endpoint create failed and Auth
was not enabled. It is not proved linked to the demo runtime. Production
`br-muddy-mountain-aov8bbku` and its privileged observer are reference evidence,
not selected Native bindings.

Workflow `CI` / `Node22` / `Node24` / `verify`, lockfile hashes, runtime binding
names, feature flags, and role-manifest columns are filled from repo code.
Exact candidate CI runs, deployed artifact/SBOM, actual target/roles/Auth/14 QA
identities, approved hosts, cost/expiry and human sign-off remain
`OWNER_REQUIRED`. Every Gate A row still needs input or confirmation; all AP
statuses, Gate B fields, historical 70/114/0 counts and execution disable remain.
