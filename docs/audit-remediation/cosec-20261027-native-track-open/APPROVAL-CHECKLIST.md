# Native track open: AP-00 binding form

**Prepare only. Native NO_GO. No AP is approved. execution_enabled is false.**

Selected QA deployed source: `48371b2c3cdd73e6faab60ec733896d5f3b71fa8`
(`main`). Historical repository comparison/source references and lockfile
hashes remain pinned to `d5183ba04cd510230e7a7f6b6b53c4529141aad6` (PR #150);
they are not the selected QA artifact. Older plan/runtime conclusions do not
transfer. The previous Native plan remains unapproved and unchanged.

Latest owner input: **Willy approved binding Gate A `selected_binding` to the QA
IDs via ComSec OS relay, 2026-10-30 ~01:45 HKT (UTC+8)**. QA status is
`selected_binding_approved_by_owner`; `selected_binding_approval=true` and
`all_selected_bindings_unchanged=false`. Scope is QA ID binding only, **not
Native/AP execution approval or deployment/production authorization**. Demo is
a recorded candidate only, not selected or preferred. Owner stays Willy (YNWAforever).

Of **19 top-level `selected_binding` values, 11 are recorded and 8 remain
`OWNER_REQUIRED`**. The recorded count includes `PROVIDER_EXPOSES_NO_DIGEST`
as a provider limitation, not an artifact digest. Required CI run IDs/results
remain `OWNER_REQUIRED`; ComSec OS reports main CI run `40892827294` GREEN at
`48371b2c` as evidence only. All 14 alias IDs, required-check policy, acceptable
checksum substitute/disposition, runtime DB/Auth URL linkage and data isolation
remain open. Native stays **NO_GO**, `execution_enabled=false`,
`approved_packet_ids=[]`; Gate B and all 13 APs stay `NOT_READY`.

Shepherd verified two read-only provider queries at 2026-10-30 ~01:52 HKT:
Vercel `get_deployment` and Neon `get_neon_auth_config`. These add to the prior
ten reads (Vercel 2, Neon 8): **12 cumulative reads, Vercel 3 / Neon 9**.
This docs editor made zero provider calls. This follow-up performs zero provider
mutations, deployments, role creations, DB connections or Native/AP actions.
QA runtime env DB/Auth URL linkage was **NOT re-read by shepherd**; it is
ComSec OS-reported only. The Neon read confirms the public Auth config/base URL,
which does not establish runtime DB URL linkage or data isolation.

Discovery: [gate-a-discovery.json](gate-a-discovery.json); current evidence:
[approval-request.json](approval-request.json), `qa_binding_evidence`.
The original ten-read evidence source/hash remains in `provider_candidate_evidence`;
the new two-read evidence is supplied in the owner relay, with no invented
external evidence filename or digest. Packet fingerprints cover both blocks.
`repository_known` stays historical/reference data.

Use `OWNER_REQUIRED` for unknown Gate A identifiers, approvals, and secret
slots. Do not invent a URL, run ID, database name, Auth ID, object key, or
fixture ID. Never commit emails, passwords, tokens, cookies, OTP, connection
strings, private keys, or session material. `NOT_IN_ENV` is not asserted:
ComSec environment values were not inspected.

## Gate A — QA ID binding approved; Native/AP approval absent

| Field | Recorded value or remaining owner input |
| --- | --- |
| `environment_owner` | Recorded: Willy (YNWAforever), unchanged; no Native/AP approval |
| `existing_isolated_url` | Selected QA stable alias `https://kossilon-cosec-qa-20261025.vercel.app`; runtime DB/Auth linkage, isolation and Native origin/availability remain `OWNER_REQUIRED` |
| `runtime_project_id` | Selected QA `prj_5Q6rrOoH7voW4jEmxhhMqxz0s8qp` / `kossilon-cosec-qa-20261025`; team `team_qvzlsFmfCsLkgItSypqHjw3z` |
| `deployment_id` | Selected QA `dpl_82pmUQuebGV1cZ1Ly7pwNnW1h7RU`, shepherd-verified `READY`; immutable URL above; no deploy performed here |
| `observed_source_sha` | Selected QA Git `main@48371b2c3cdd73e6faab60ec733896d5f3b71fa8`; historical repo/lock references stay pinned to `d5183ba` |
| `observed_artifact_checksum` | Recorded `PROVIDER_EXPOSES_NO_DIGEST`, a provider limitation, not a digest; acceptable checksum substitute/disposition remains `OWNER_REQUIRED` |
| `required_ci_run_ids_and_results` | `OWNER_REQUIRED`; main CI `40892827294` GREEN at `48371b2c` is evidence only, not required-check policy or required CI run selection |
| `artifact_sbom_and_dependency_disposition` | `OWNER_REQUIRED`: deployed SBOM or verified deployed lockfile identity and accepted dependency disposition; historical repo hashes do not close this |
| `db_provider_project_id` | Selected `broad-mouse-83325496` / `kossilon-cosec-isolated-20261025`; runtime DB URL linkage and isolation remain open |
| `db_branch_id` | Selected `br-aged-flower-b3clbnr6` (`main`); runtime linkage, data lineage/disposability and access policy remain open |
| `database_name` | Selected `kossilon_qa`; owner role is not selected as an app or observer role |
| `app_role` | `OWNER_REQUIRED`: `NONE_EXISTS`, only `kossilon_qa_owner` previously observed; restricted role creation/approval required later |
| `readonly_observer_role` | `OWNER_REQUIRED`: `NONE_EXISTS`; restricted read-only role and verified privileges required later |
| `server_identity_binding` | `OWNER_REQUIRED`: host/proxy/port binding, migration ledger, physical catalog, checksum and effective privileges; API exposes no port, no 5432 assumption |
| `auth_tenant_id` | Selected `0f60a808-46df-46f3-8723-a47767ad48ba`; shepherd confirms public Auth base URL only; runtime env linkage and data isolation remain open |
| `role_identity_manifest` | `OWNER_REQUIRED`: all 14 actual alias IDs, user/profile/team/revision mapping and existing QA session method; no seed/test IDs substituted |
| `network_allowlist` | `OWNER_REQUIRED`: exact approved hosts for later slice; `approved_hosts=[]`, reference hosts grant no access |
| `read_only_cost_ceiling_and_expiry_hkt` | `OWNER_REQUIRED`: currency, amount, HKT window/expiry and approver; no old budget reused |
| `cleanup_manifest_and_disposition` | Recorded `RETAIN_ONLY`, unchanged; no delete/reset, no session/resource created here; future exact cleanup/session IDs require a later packet |

### QA selected by owner; demo recorded candidate only

QA status is `selected_binding_approved_by_owner`. Vercel `get_deployment`
confirms `dpl_82pmUQuebGV1cZ1Ly7pwNnW1h7RU` READY at Git `main@48371b2c`.
The selected URL is the stable QA alias; immutable deployment URL is
`https://kossilon-cosec-qa-20261025-r9c1abtfo-ynwaforevers-projects.vercel.app`.
Ready time: 2026-10-30 01:52:31 HKT (`1793296351640` ms), region `sin1`,
framework `tanstack-start`, target `production` inside the QA project only.
QA aliases in the evidence grant no network access.

| Stack | Vercel observation | Neon/Auth observation and limitation |
| --- | --- | --- |
| Demo (recorded candidate only, not selected or preferred) | `kossilon-hub-demo` / `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`; `dpl_J9ZwsCtnJ99f3N4RWsBYgXMdhR1c` READY at `d5183ba`; demo URL retained in JSON | `green-unit-86146635` / `br-raspy-math-azlq08ge` / `kossilon_demo`; only `kossilon_demo_owner`; Auth `53ec191d-f012-46bb-b595-a583e514cc95`; runtime DB/Auth linkage `UNPROVEN` |
| QA (`selected_binding_approved_by_owner`) | `kossilon-cosec-qa-20261025` / `prj_5Q6rrOoH7voW4jEmxhhMqxz0s8qp`; `dpl_82pmUQuebGV1cZ1Ly7pwNnW1h7RU` READY at `48371b2c`; team `team_qvzlsFmfCsLkgItSypqHjw3z` / `ynwaforevers-projects` | `broad-mouse-83325496` / `kossilon-cosec-isolated-20261025`, branch `br-aged-flower-b3clbnr6` (`main`), database `kossilon_qa`, compute `ep-delicate-math-b35l9rdb` (`aws-ap-southeast-1`); only `kossilon_qa_owner` in earlier evidence; Auth `0f60a808-46df-46f3-8723-a47767ad48ba`. Shepherd confirms Auth base URL, not runtime env linkage or data isolation |

| Stack | Direct host candidate | Pooled host candidate | Proxy host candidate | Port |
| --- | --- | --- | --- | --- |
| Demo | `ep-holy-surf-aztq6cid.c-3.ap-southeast-1.aws.neon.tech` | `ep-holy-surf-aztq6cid-pooler.c-3.ap-southeast-1.aws.neon.tech` | `c-3.ap-southeast-1.aws.neon.tech` | `OWNER_REQUIRED` |
| QA | `ep-delicate-math-b35l9rdb.c-4.ap-southeast-1.aws.neon.tech` | `ep-delicate-math-b35l9rdb-pooler.c-4.ap-southeast-1.aws.neon.tech` | `c-4.ap-southeast-1.aws.neon.tech` | `OWNER_REQUIRED` |

These hosts grant no access; `approved_hosts` stays `[]`. Both role inventories
show `app_role=NONE_EXISTS` and `readonly_observer_role=NONE_EXISTS`. Their
selected bindings stay `OWNER_REQUIRED`; Willy must arrange role creation and
approval later. No role creation occurs in this pass.

The selected QA checksum field is `PROVIDER_EXPOSES_NO_DIGEST`: Vercel Git
deployment exposes no digest. This is a recorded provider limitation; acceptable
checksum substitute/disposition remains `OWNER_REQUIRED`. Historical demo
`/files` 404 is ComSec OS-reported only, not re-run. Source SHA, CI runs and repo
lockfile hashes are **LABELLED SUBSTITUTES ONLY, explicitly not a deployed
artifact digest or approval**. The two historical lock hashes stay pinned to
`d5183ba`; current branch lockfiles differ and are not substituted.

QA public Auth base URL is
`https://ep-delicate-math-b35l9rdb.neonauth.c-4.ap-southeast-1.aws.neon.tech/kossilon_qa/auth`,
confirmed by shepherd `get_neon_auth_config`. ComSec OS-reported runtime
`NEON_AUTH_URL`/DB URL linkage was **NOT re-read by shepherd** and remains open.
Main CI [run 40892827294](https://github.com/YNWAforever/kossilon-hub/actions/runs/40892827294)
is ComSec OS-reported GREEN at `48371b2c`, evidence only. Required CI IDs/results
and `required_check_policy` remain `OWNER_REQUIRED`.

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
The follow-up establishes the QA deployment/Auth metadata and owner-approved QA
ID selection only; neither source type grants Native authority or a Native PASS.

### Public config and feature-flag contracts

These are repo values and paths, not changes to a deployment or selected Native settings.

| Name/path | Repo contract | Gate A implication |
| --- | --- | --- |
| `VITE_ENABLE_DEMO_AUTH` in `src/features/runtime/data-mode.ts` | True only selects demo data in a non-production build | Local demo evidence cannot supply Native identities |
| `VITE_PROVIDER_MODE` in `src/server/provider-mode.ts` | `local`, `simulated`, `live`; absent/blank defaults to `live`; simulated requires `FIRM_ID=kossilon-demo` | Actual target value `OWNER_REQUIRED`; do not assume provider sends are disabled |
| `VITE_ENABLE_NEON_AUTH_DEMO`, `FIRM_ID`, `DEMO_FIRM_ID` in `docs/runbooks/neon-auth-demo.md` and `scripts/validate-neon-auth-demo.ts` | Documented demo uses flag true, provider simulated and firm `kossilon-demo` | Demo contract only; it does not prove runtime configuration or Native acceptance |
| `MAINTENANCE_SCHEDULER_OWNER` in `wrangler.template.jsonc` | Template `paused` | No actual scheduler selected/activated; AP-11 stays blocked |
| `vercel.json` → `git.deploymentEnabled.main` | `false` | Main Git auto-deploy hold retained; demo and QA Git-source deployments are prior external evidence, not actions by this refresh |
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

## AP status with QA binding at `48371b2c`

| AP | Status | Why |
| --- | --- | --- |
| AP-00 | `NOT_READY` | Eleven recorded values (including no-digest limitation); eight top-level bindings/14 alias IDs `OWNER_REQUIRED`; isolation unproven; Gate B `NOT_READY`; no approved packets |
| AP-01 | `NOT_READY` | QA deployment/Auth config recorded; checksum substitute, SBOM, required CI runs/policy, runtime linkage/isolation, roles/manifest, allowlist, budget and expiry `OWNER_REQUIRED`; AP-01-RO-1 is unauthorized and not started |
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
