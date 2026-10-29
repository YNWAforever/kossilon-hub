# Native blockers after the 2026-10-29 demo evidence refresh

Native gate: **NO_GO**. **Prepare-only. execution_enabled=false. No AP
authorized. No Ready/merge/Native ask.** `approved_packet_ids` is `[]`; AP-00
through AP-12 remain `NOT_READY` with actual actions 0. Gate B stays `NOT_READY`.

Authority: **Willy Approve 2026-10-29 ~21:17 HKT — "deploy demo then brief
Codex packet refresh only"** (demo deploy + packet refresh only).

Current comparison candidate / PR base:
`d5183ba04cd510230e7a7f6b6b53c4529141aad6` (`main`, PR #150 merge). Supplied
verified evidence records demo `kossilon-hub-demo` /
`prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`, team `team_qvzlsFmfCsLkgItSypqHjw3z` /
`ynwaforevers-projects`, deployment `dpl_J9ZwsCtnJ99f3N4RWsBYgXMdhR1c`, state
`READY`, target `production` **inside the demo project only**. The demo project
is absent from Vercel `linkedProjects`; supplied Git-source `create_deployment`
succeeded. Production `kossilon-hub` was not touched.

Demo URL: `https://kossilon-hub-demo-4oxc6afow-ynwaforevers-projects.vercel.app`.
Assigned aliases: `kossilon-hub-demo.vercel.app`,
`kossilon-hub-demo-ynwaforevers-projects.vercel.app`,
`kossilon-hub-demo-git-main-ynwaforevers-projects.vercel.app`.
Observed SHA equals the comparison candidate, `githubCommitRef=main`.
[CI run 40755216699](https://github.com/YNWAforever/kossilon-hub/actions/runs/40755216699)
is supplied as `SUCCESS` on the same SHA, jobs `Node22` / `Node24` / `verify`
`SUCCESS`. Willy (YNWAforever) is the confirmed human/business owner; cleanup
is `RETAIN_ONLY`, no delete/reset. No email or artifact digest was supplied.

Seven top-level values are now recorded for this packet, without Native/AP
approval. Twelve top-level Gate A values and all 14 alias IDs remain
`OWNER_REQUIRED`; DB/Auth/data isolation and required-check policy also remain
`OWNER_REQUIRED`. Reference hosts grant no access: `approved_hosts` is `[]`.
Evidence is in [approval-request.json](approval-request.json),
[gate-a-discovery.json](gate-a-discovery.json) and
[APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md). This refresh queried no provider
or hosted CI, visited no runtime URL, deployed nothing and executed no AP.

## Still blocked

1. Deployed artifact checksum and artifact SBOM/dependency disposition. CI/source identity is recorded, but required-check policy remains unconfirmed. Packet, Git and lockfile hashes are not a deployed artifact checksum.
2. Usable isolated DB project, branch/endpoint and database name; server identity, catalog, migration ledger, application and read-only observer roles/privileges. Demo `READY` does not prove DB/Auth/data isolation.
3. Real isolated Auth tenant, Gate A role identity manifest/existing QA session method and all 14 alias IDs. No account creation, invitation or session action is authorized. Account-switch cache, revoked sessions, RLS and HTTP remain unrun.
4. Approved network allowlist, currency, cost ceiling, HKT window/expiry and approver for a later slice. The limited demo/refresh authority supplies no AP budget, expiry or execution approval.
5. Today-to-case Native journey, document safety/payment review, authorized writes, independent readback and recovery; UC186 handover and the 100+4 paging batch still lack Native fixtures.
6. Gate B calendar (historical UC134 `NOT_RUN`), fault runtime, storage/scanner/provider targets, device/network profile, scheduler jobs, backup and restore targets. No Native tick, provider receipt or performance result is claimed.

## Historical evidence retained

Previous comparison `ae9cbc195878235d72c8d0f1d1e49d0f3ad3e5c0`, original
`79ad0c04da892ec03601f11c12d82fcc84039b31`, and previous plan candidate
`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1` are historical; their runtime
conclusions do not transfer. Old demo `dpl_2YSZmZTxQzxPLsL3nUnUF6vLeeEY`
is **HISTORICAL / SUPERSEDED**, preserved in its receipt and discovery.

Historical Neon project `red-morning-00331124`, child
`br-fragrant-sunset-aosoylhr` / `kossilon-r01-staging-20261004`, database
`neondb` are references only. The historical child had no endpoint; later
endpoint creation failed and Auth was not enabled. No current usable isolated
DB/Auth binding is proved; no Neon resource was queried or created here.
Production parent `br-muddy-mountain-aov8bbku` and its privileged observer are
historical reference evidence, not selected Native bindings.

Historical matrix, locally recounted and not re-executed: **70 BLOCKED /
114 NOT_RUN / 0 PASS** in
`../cosec-20261025-native-plan-fccb7c22/acceptance-results.csv`
(SHA256 `287bafceb836b4e42b96cfbc006ee83dd9ac65900100d1ba199f93631537e6fb`).
The original #149 reminder/recovery work remains local evidence, without
provider delivery, Auth/RLS, object storage or Native browser acceptance.

## First slice still unauthorized

AP-01-RO-1 is described in [DELIVERY.md](DELIVERY.md); it is unstarted and
unauthorized. Every later AP remains blocked. AP-12 retains all resources and
has no session/resource IDs from this refresh, which created none. Historical
receipts, older packets and the 70/114/0 matrix remain unchanged. Recording
these demo bindings does not request approval or open Native execution.
