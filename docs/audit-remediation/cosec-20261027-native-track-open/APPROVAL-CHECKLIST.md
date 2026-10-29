# Native track open: AP-00 binding form

**Prepare only. Native NO_GO. No AP is approved. execution_enabled is false.**

Candidate/comparison SHA: `d5183ba04cd510230e7a7f6b6b53c4529141aad6`
(`main`, PR #150 merge). Supplied verified demo deployment and CI evidence now
bind this SHA for packet comparison only. Previous comparison candidate
`ae9cbc195878235d72c8d0f1d1e49d0f3ad3e5c0` (PR #149 squash merge) and original
`79ad0c04da892ec03601f11c12d82fcc84039b31` are **HISTORICAL / SUPERSEDED**.

Prior demo/refresh authority: **Willy Approve 2026-10-29 ~21:17 HKT — "deploy
demo then brief Codex packet refresh only"**. Current authority: Willy approved
starting to fill `OWNER_REQUIRED` fields with provider-observed candidates only.
The shepherd gathered ten read-only metadata queries at 2026-10-29 ~22:55 HKT
(UTC+8): Vercel 2, Neon 8. This docs pass transcribes that evidence, makes no
additional provider or hosted CI request, deploys nothing, and runs no AP.
Provider `READY` is an observation; all binding approval still awaits Willy.

Previous unapproved plan: `cosec-20261025-native-plan-fccb7c22`, source
`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`, delivery
`531887acce5468f7321a3a2919a7afaa20dedac1`. That plan's runtime notes do not
carry forward. This form replaces its empty binding table for the current
candidate. The old files stay as historical preparation.

Gate A discovery is in [gate-a-discovery.json](gate-a-discovery.json). All 26
repository source paths, git blobs and SHA256 values were rechecked at
`d5183ba04cd510230e7a7f6b6b53c4529141aad6`; the source bytes are unchanged from
the previous discovery. Supplied evidence is recorded separately in
[approval-request.json](approval-request.json), `demo_deploy_evidence` and
`provider_candidate_evidence`, and covered by this packet's verification
fingerprints. Ten provider reads are counted for this pass; the editor made no
additional queries. `repository_known` remains historical/reference data; all
seven previously recorded `selected_binding` values remain unchanged, without
Native approval. New `observed`/`candidates` blocks select no binding. Twelve
top-level Gate A values and all 14 alias IDs remain
`OWNER_REQUIRED`. DB/Auth/data isolation and required-check policy also remain
`OWNER_REQUIRED`; Gate B stays `NOT_READY`.

Use `OWNER_REQUIRED` for unknown Gate A identifiers, approvals, and secret
slots. Do not invent a URL, run ID, database name, Auth ID, object key, or
fixture ID. Never commit emails, passwords, tokens, cookies, OTP, connection
strings, private keys, or session material. `NOT_IN_ENV` is not asserted:
ComSec environment values were not inspected.

## Gate A — supplied demo evidence recorded; Native approval absent

| Field | Recorded evidence (not Native approval) | Remaining requirement |
| --- | --- | --- |
| `environment_owner` | Willy (YNWAforever), confirmed accountable human/business owner; team `team_qvzlsFmfCsLkgItSypqHjw3z` / `ynwaforevers-projects` | Owner recorded; no email supplied; no Native/AP approval |
| `existing_isolated_url` | Supplied demo URL `https://kossilon-hub-demo-4oxc6afow-ynwaforevers-projects.vercel.app`; aliases below | `OWNER_REQUIRED`: DB/Auth/data isolation and approved Native origin/availability; URL not visited here |
| `runtime_project_id` | Demo only: `kossilon-hub-demo` / `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`; not listed in Vercel `linkedProjects`, but supplied Git-source `create_deployment` succeeded | `OWNER_REQUIRED`: DB/Auth/data isolation; production `kossilon-hub` excluded |
| `deployment_id` | `dpl_J9ZwsCtnJ99f3N4RWsBYgXMdhR1c`, supplied state `READY`, target `production` **inside demo project only** | Artifact checksum and isolation remain `OWNER_REQUIRED`; no AP authorized |
| `observed_source_sha` | Demo `get_deployment` corroborates `d5183ba04cd510230e7a7f6b6b53c4529141aad6`, ref `main` | QA has no verified deployment at this SHA; no Native approval |
| `observed_artifact_checksum` | Observed `PROVIDER_EXPOSES_NO_DIGEST`: demo `get_deployment` exposes no digest; Git deploy `/files` 404 is ComSec OS-reported | Status/selected binding stay `OWNER_REQUIRED`; source SHA, CI run and lockfile hashes are labelled substitutes only, explicitly not a deployed digest or approval |
| `required_ci_run_ids_and_results` | [Run 40755216699](https://github.com/YNWAforever/kossilon-hub/actions/runs/40755216699) `SUCCESS`, same SHA; jobs `Node22` / `Node24` / `verify` `SUCCESS` | `OWNER_REQUIRED`: required-check policy and accepted dependency disposition; logs not inspected or CI rerun here |
| `artifact_sbom_and_dependency_disposition` | `package-lock.json` and `bun.lock` paths, git blobs and SHA256 rechecked at `d5183ba` in discovery JSON | Deployed resolved SBOM or deployed lock identity and accepted dependency disposition |
| `db_provider_project_id` | Demo candidate `green-unit-86146635`; QA candidate `broad-mouse-83325496` | `OWNER_REQUIRED`: Willy must select and approve an isolated target |
| `db_branch_id` | Demo candidate `br-raspy-math-azlq08ge`; QA candidate `br-aged-flower-b3clbnr6` | `OWNER_REQUIRED`: branch approval, runtime linkage and isolation |
| `database_name` | Demo candidate `kossilon_demo`; QA candidate `kossilon_qa` | `OWNER_REQUIRED`: database selection; demo runtime-to-DB/Auth URL link remains `UNPROVEN` |
| `app_role` | `NONE_EXISTS` on both candidate branches; only `kossilon_demo_owner` / `kossilon_qa_owner` observed | `OWNER_REQUIRED`: restricted role must be created and approved by Willy later; no owner role selected |
| `readonly_observer_role` | `NONE_EXISTS` on both candidate branches; only their `*_owner` roles observed | `OWNER_REQUIRED`: read-only role must be created and approved by Willy later, with privileges verified |
| `server_identity_binding` | Direct, pooled and proxy host candidates below; repository ledger/catalog contracts retained in discovery | Status/selected binding and port stay `OWNER_REQUIRED`; API exposes no port, so do not assume 5432; catalog/ledger/checksum/privileges unverified |
| `auth_tenant_id` | Demo `53ec191d-f012-46bb-b595-a583e514cc95`; QA `0f60a808-46df-46f3-8723-a47767ad48ba`; public base URLs in JSON | `OWNER_REQUIRED`: tenant selection and isolation. QA Auth URL match is ComSec OS-reported only; demo runtime link is `UNPROVEN` |
| `role_identity_manifest` | Code columns for staff, user, team, active state, skills, `staff_profiles.access_revision` and client memberships mapped in discovery JSON | Actual 14-alias manifest and existing QA session method; no seed/test identities substituted |
| `network_allowlist` | Reference app hosts recorded; known production `kossilon-hub.vercel.app` / `www.kossilon-hub.vercel.app` excluded | Exact approved hosts; `approved_hosts` stays `[]`; reference URLs grant no access |
| `read_only_cost_ceiling_and_expiry_hkt` | Packet timezone `Asia/Hong_Kong`; previous metadata window is closed | Currency, amount, HKT window/expiry and approver; no old budget/approval reused |
| `cleanup_manifest_and_disposition` | `RETAIN_ONLY` recorded; this refresh creates no runtime resource and opens no QA session | No delete/reset; future exact session references need a later packet; AP-12 remains `NOT_READY` |

### Provider-observed candidate stacks — neither selected nor approved

Both stacks are `RECORDED_FOR_PACKET_ONLY_NOT_APPROVED`. Selected bindings
remain unchanged; all twelve previously unresolved fields stay `OWNER_REQUIRED`.
Provenance: `/workspace/cli-logs/comsec-gate-a-owner-required.provider-evidence.md`,
gathered by shepherd 2026-10-29 ~22:55 HKT (UTC+8). Its SHA256, query counts,
per-provider provenance, public Auth URLs and full candidate metadata are in
`approval-request.json#/provider_candidate_evidence`. QA is new to this packet.

| Stack | Vercel observation | Neon/Auth observation and limitation |
| --- | --- | --- |
| Demo | `kossilon-hub-demo` / `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`; `dpl_J9ZwsCtnJ99f3N4RWsBYgXMdhR1c` `READY` at `d5183ba` | `green-unit-86146635` / `br-raspy-math-azlq08ge` / `kossilon_demo`; only `kossilon_demo_owner`; Auth `53ec191d-f012-46bb-b595-a583e514cc95`. Runtime `DATABASE_URL`/`NEON_AUTH_URL` link `UNPROVEN` because sensitive env was unread |
| QA | `kossilon-cosec-qa-20261025` / `prj_5Q6rrOoH7voW4jEmxhhMqxz0s8qp`; latest CLI `dpl_FN5etCBSmhy1unZvBjx7pQG1TEt6` has no SHA; Git `dpl_AUMBEB8NtguuEwx6kpHWfXJHrpMt` at `4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`, no verified `d5183ba` deployment | `broad-mouse-83325496` / `br-aged-flower-b3clbnr6` / `kossilon_qa`; only `kossilon_qa_owner`; Auth `0f60a808-46df-46f3-8723-a47767ad48ba`. `NEON_AUTH_URL` match proof reported by ComSec OS; shepherd did not re-read env. This does not establish DB URL linkage or data isolation |

| Stack | Direct host candidate | Pooled host candidate | Proxy host candidate | Port |
| --- | --- | --- | --- | --- |
| Demo | `ep-holy-surf-aztq6cid.c-3.ap-southeast-1.aws.neon.tech` | `ep-holy-surf-aztq6cid-pooler.c-3.ap-southeast-1.aws.neon.tech` | `c-3.ap-southeast-1.aws.neon.tech` | `OWNER_REQUIRED` |
| QA | `ep-delicate-math-b35l9rdb.c-4.ap-southeast-1.aws.neon.tech` | `ep-delicate-math-b35l9rdb-pooler.c-4.ap-southeast-1.aws.neon.tech` | `c-4.ap-southeast-1.aws.neon.tech` | `OWNER_REQUIRED` |

These hosts grant no access; `approved_hosts` stays `[]`. Both role inventories
show `app_role=NONE_EXISTS` and `readonly_observer_role=NONE_EXISTS`. Their
selected bindings stay `OWNER_REQUIRED`; Willy must arrange role creation and
approval later. No role creation occurs in this pass.

For demo `dpl_J9ZwsCtnJ99f3N4RWsBYgXMdhR1c`, the observed checksum value is
`PROVIDER_EXPOSES_NO_DIGEST`: `get_deployment` has no digest field; the Git deploy
`/files` 404 is reported by ComSec OS and was not re-run. Source SHA
`d5183ba04cd510230e7a7f6b6b53c4529141aad6`, existing CI run `40755216699`, and
existing `package-lock.json` / `bun.lock` hashes are **LABELLED SUBSTITUTES ONLY,
explicitly not a deployed artifact digest or approval**. Both hashes remain
pinned to `d5183ba` in discovery and the labelled substitute block; the current packet branch
lockfiles differ and are not substituted. Checksum status/selected binding
stay `OWNER_REQUIRED` pending Willy's acceptable evidence/disposition decision.

The counter increases from 0 to 10: Vercel `get_deployment` / `list_deployments`
once each; Neon `list_postgres_roles`, `list_postgres_databases`,
`list_branch_computes`, `get_auth` twice each. ComSec-reported `/files` and env
match evidence are not extra queries in this count. No sensitive env value,
connection string, password, QA session or AP action was read or executed.

Assigned demo aliases from the supplied evidence (reference hosts only;
`approved_hosts` stays `[]`): `kossilon-hub-demo.vercel.app`,
`kossilon-hub-demo-ynwaforevers-projects.vercel.app`,
`kossilon-hub-demo-git-main-ynwaforevers-projects.vercel.app`.

**HISTORICAL / SUPERSEDED demo binding:**
`dpl_2YSZmZTxQzxPLsL3nUnUF6vLeeEY` at
`https://kossilon-hub-demo-dpp5u56nf-ynwaforevers-projects.vercel.app` is retained
in discovery and its original receipt for audit provenance, not as the current
deployment or source binding.

Source details: discovery `sources.demo_metadata` is the committed
[2026-10-25 metadata receipt](../cosec-20261025-ap01-form-61f03672/AP01-METADATA-EXECUTION.json),
not a new read. The historical DB child comes from the
[2026-10-04 creation receipt](../evidence/2026-10-04-r01-staging-created.json)
and [blocked endpoint receipt](../evidence/2026-10-04-r01-b1-capability-blocked.json).
Production/catalog references come from the
[Vercel](../evidence/2026-10-03-r03-target-vercel.json) and
[Neon](../evidence/2026-10-03-r03-target-neon.json) inventories.
Each field's `source_refs` resolves either to a base-pinned repo source (and,
where useful, a JSON pointer) or the explicitly labelled supplied-evidence
reference. Historical receipts do not establish current existence or isolation.
The new supplied observation establishes the demo source binding only; neither
source type grants Native authority or a Native PASS.

### Public config and feature-flag contracts

These are repo values and paths, not changes to a deployment or selected Native settings.

| Name/path | Repo contract | Gate A implication |
| --- | --- | --- |
| `VITE_ENABLE_DEMO_AUTH` in `src/features/runtime/data-mode.ts` | True only selects demo data in a non-production build | Local demo evidence cannot supply Native identities |
| `VITE_PROVIDER_MODE` in `src/server/provider-mode.ts` | `local`, `simulated`, `live`; absent/blank defaults to `live`; simulated requires `FIRM_ID=kossilon-demo` | Actual target value `OWNER_REQUIRED`; do not assume provider sends are disabled |
| `VITE_ENABLE_NEON_AUTH_DEMO`, `FIRM_ID`, `DEMO_FIRM_ID` in `docs/runbooks/neon-auth-demo.md` and `scripts/validate-neon-auth-demo.ts` | Documented demo uses flag true, provider simulated and firm `kossilon-demo` | Demo contract only; it does not prove runtime configuration or Native acceptance |
| `MAINTENANCE_SCHEDULER_OWNER` in `wrangler.template.jsonc` | Template `paused` | No actual scheduler selected/activated; AP-11 stays blocked |
| `vercel.json` → `git.deploymentEnabled.main` | `false` | Main Git auto-deploy hold retained; supplied demo Git-source deployment is prior evidence, not an action by this refresh |
| Vercel environment labels | Historical `production`, `preview`, `development` | A label does not prove isolation |

Runtime non-secret binding names additionally include `DOCUMENTS_BUCKET`,
`R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `FIRM_ID` and `HYPERDRIVE`.
Their actual isolated values remain owner input. Gate B is unchanged.

### Gate A aliases

Actual Auth ID, internal user ID, profile ID, team ID, and revision are
`OWNER_REQUIRED` for every alias.

| Alias | Relationship the owner must confirm | Actual IDs |
| --- | --- | --- |
| `ADMIN_PRIMARY` | Existing QA admin | `OWNER_REQUIRED` |
| `ADMIN_RECOVERY` | Second existing QA admin, able to recover | `OWNER_REQUIRED` |
| `STAFF_SOURCE` | Team A staff with open work across the three case types | `OWNER_REQUIRED` |
| `STAFF_OWNER` | Team A owner successor | `OWNER_REQUIRED` |
| `STAFF_REVIEWER` | Team A reviewer successor | `OWNER_REQUIRED` |
| `MANAGER_A` | Team A manager | `OWNER_REQUIRED` |
| `STAFF_B` | Team B staff, own company and case | `OWNER_REQUIRED` |
| `MANAGER_B` | Team B manager | `OWNER_REQUIRED` |
| `CLIENT_A` | Client membership on company A, no staff role | `OWNER_REQUIRED` |
| `CLIENT_B` | Client membership on company B, no staff role | `OWNER_REQUIRED` |
| `STAFF_NO_TEAM` | Active staff, team id null | `OWNER_REQUIRED` |
| `AUTH_NO_PROFILE` | Auth account with no staff profile | `OWNER_REQUIRED` |
| `STAFF_INACTIVE` | Disabled staff | `OWNER_REQUIRED` |
| `STAFF_NO_SKILL` | Staff whose skills do not match the action | `OWNER_REQUIRED` |

Session method must use an existing QA session. Account creation, role grant,
invitation send, and magic-link request stay off Gate A.

## Gate B — still AP-00, not needed to describe the first slice

| Field | This refresh | Blocks |
| --- | --- | --- |
| `storage_account_and_bucket_id` | `NOT_READY` | AP-04, AP-09 |
| `approved_object_prefix` | `NOT_READY` | AP-04, AP-09 |
| `scanner_sandbox_id` | `NOT_READY` | AP-04, AP-09 |
| `fixture_driver_diff_and_physical_row_budget` | `NOT_READY` | AP-02 |
| `actual_fixture_ids_and_versions` | `NOT_READY` | AP-02, AP-03, AP-05 |
| `approved_calendar_version_hash_and_expected_dates` | `NOT_READY` | AP-07, UC134 |
| `fault_clone_id` | `NOT_READY` | AP-07 |
| `fault_runtime_url_and_artifact_binding` | `NOT_READY` | AP-07 |
| `scheduler_owner_runtime_and_allowed_job_ids` | `NOT_READY` | AP-11 |
| `backup_id_and_restore_target` | `NOT_READY` | AP-11 |
| `restore_runtime_url_and_artifact_binding` | `NOT_READY` | AP-11 |
| `provider_destinations_models_cost_and_receipt_contracts` | `NOT_READY` | AP-09 |
| `physical_device_browser_and_network_profile` | `NOT_READY` | AP-10 |

Later aliases, actual IDs `NOT_READY`:

| Alias | Blocks |
| --- | --- |
| `RACE_SOURCE_01` … `RACE_SOURCE_06` | AP-05 |
| `PAGING_SOURCE` | AP-06 |

Proposed ceilings in the previous JSON are copied into
[approval-request.json](approval-request.json) as unapproved proposals. They are
not a grant of reads, commands, spend, or setup rows.

## AP status on candidate `d5183ba`

| AP | Status | Why |
| --- | --- | --- |
| AP-00 | `NOT_READY` | Seven supplied values recorded; twelve top-level bindings/14 alias IDs `OWNER_REQUIRED`; isolation unproven; Gate B `NOT_READY`; no approved packets |
| AP-01 | `NOT_READY` | Supplied same-SHA demo deployment/CI recorded; checksum, isolation, DB/Auth/role manifest, allowlist, budget and expiry `OWNER_REQUIRED`; AP-01-RO-1 is unauthorized and not started |
| AP-02 | `NOT_READY` | Fixture driver diff and exact IDs are blank. Setup writes are not authorized |
| AP-03 | `NOT_READY` | Depends on AP-01 and AP-02. Local route edits on #149 are not a native Today-to-case journey |
| AP-04 | `NOT_READY` | Storage and scan receipts are blank. Payment amounts in the old plan are oracles for a future fixture, not a result of this refresh |
| AP-05 | `NOT_READY` | Seven QA profiles that the old plan would allow to be disabled are unidentified. No disable is approved |
| AP-06 | `NOT_READY` | 104-obligation batch and `PAGING_SOURCE` are unbound |
| AP-07 | `NOT_READY` | Calendar answer, fault clone, and fault runtime are blank. Historical UC134 is `NOT_RUN` |
| AP-08 | `NOT_READY` | Large-setup manifest is unbound |
| AP-09 | `NOT_READY` | Provider destination, model, corpus, and cost are blank. Approved calls and spend are 0 |
| AP-10 | `NOT_READY` | Device and network profile are blank. Depends on unbound AP-08 data |
| AP-11 | `NOT_READY` | Scheduler jobs, backup, and restore target are blank |
| AP-12 | `NOT_READY` | `RETAIN_ONLY`, no delete/reset; future cleanup IDs unbound. This refresh created nothing |

## First slice after Gate A exists

**AP-01-RO-1.** Read-only check of deployment metadata, required CI identity,
catalog and privileges, and existing QA sessions for the Gate A aliases.

This checklist does not start it. A human approval in a later file would have
to set `execution_enabled` to `true` and include only the approved packet IDs.
Known write side effects on a GET exclude that request from AP-01-RO-1.
AP-02 stays behind a reviewed fixture driver even after AP-01-RO-1.

## Owner sign-off line

Leave this line until a human actually approves a later packet.

| Approver | Approved packet IDs | Expiry (HKT) | execution_enabled |
| --- | --- | --- | --- |
| `NOT_READY` | `[]` | `NOT_READY` | `false` |
