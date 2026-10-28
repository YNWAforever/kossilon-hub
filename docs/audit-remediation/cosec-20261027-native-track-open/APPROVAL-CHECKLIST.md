# Native track open: AP-00 binding form

**Prepare only. Native NO_GO. No AP is approved. execution_enabled is false.**

Candidate git SHA to compare a future deployment against:
`ae9cbc195878235d72c8d0f1d1e49d0f3ad3e5c0` (`main`, PR #149 squash merge; unapproved).
Original comparison SHA `79ad0c04da892ec03601f11c12d82fcc84039b31` is historical.
No deployed artifact or hosted CI result is verified by this repin.

Previous unapproved plan: `cosec-20261025-native-plan-fccb7c22`, source
`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`, delivery
`531887acce5468f7321a3a2919a7afaa20dedac1`. That plan's runtime notes do not
carry forward. This form replaces its empty binding table for the current
candidate. The old files stay as historical preparation.

Gate A discovery now records committed repo identifiers in
[gate-a-discovery.json](gate-a-discovery.json). Its `sources` map pins each
source path, git blob, and SHA256 at reviewed #150 head
`51b9a2ebaff965726963cbeb6b7146e860248f90`. No provider state was refreshed.
`repository_known` values are historical references or code contracts; they
are not selected/approved bindings. All 19 Gate A fields still need owner
input or confirmation. `approval-request.json.bindings` keeps unresolved
Gate A values as `OWNER_REQUIRED`; Gate B stays `NOT_READY`.

Use `OWNER_REQUIRED` for unknown Gate A identifiers, approvals, and secret
slots. Do not invent a URL, run ID, database name, Auth ID, object key, or
fixture ID. Never commit emails, passwords, tokens, cookies, OTP, connection
strings, private keys, or session material. `NOT_IN_ENV` is not asserted:
ComSec environment values were not inspected.

## Gate A — repo discovery filled; owner confirmation still required

| Field | Non-secret repo evidence filled | Still `OWNER_REQUIRED` |
| --- | --- | --- |
| `environment_owner` | Vercel team `team_qvzlsFmfCsLkgItSypqHjw3z`, `ynwaforever's projects`, slug `ynwaforevers-projects` | Accountable human/business owner; a platform team is not that person |
| `existing_isolated_url` | Historical demo fixed URL `https://kossilon-hub-demo-dpp5u56nf-ynwaforevers-projects.vercel.app`; documented alias `https://kossilon-hub-demo.vercel.app` | Existing isolated origin, current availability and DB/Auth/data isolation; neither URL was visited |
| `runtime_project_id` | Historical demo `kossilon-hub-demo` / `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`; production reference `kossilon-hub` / `prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC` | Select and confirm an isolated target; production is excluded |
| `deployment_id` | Historical demo `dpl_2YSZmZTxQzxPLsL3nUnUF6vLeeEY`, recorded `READY`, target label `production` inside the demo project | Same-candidate deployment/artifact binding; old demo metadata exposes no Git SHA |
| `observed_source_sha` | Expected comparison SHA `ae9cbc195878235d72c8d0f1d1e49d0f3ad3e5c0` (`main` after #149 squash merge, separate from #150 packet) | Deployment-observed SHA; the expected SHA is not an observation |
| `observed_artifact_checksum` | Deployed checksum field and scope identified | Deployed artifact checksum; no local build/packet/lockfile hash substituted |
| `required_ci_run_ids_and_results` | `.github/workflows/ci.yml`: workflow `CI`, runtime checks `Node22` / `Node24`, aggregate `verify` | Required-check policy and exact candidate-head run IDs/results; no hosted CI queried |
| `artifact_sbom_and_dependency_disposition` | `package-lock.json` and `bun.lock` paths, git blobs and SHA256 in discovery JSON; unchanged from candidate | Deployed resolved SBOM or deployed lock identity and accepted dependency disposition |
| `db_provider_project_id` | Historical Neon project `red-morning-00331124` | Isolated DB target selection and owner confirmation; historical shared project is not isolation |
| `db_branch_id` | Historical child `br-fragrant-sunset-aosoylhr`, name `kossilon-r01-staging-20261004`; parent production `br-muddy-mountain-aov8bbku` | Usable isolated branch and runtime link. Historical child had no endpoint; later endpoint creation failed, Auth was not enabled |
| `database_name` | Historical database `neondb`, technical owner `neondb_owner` | Name on selected isolated branch; no demo-runtime DB binding proved |
| `app_role` | Historical catalog names `neondb_owner`, `authenticator`, `anonymous`, `authenticated`; application binding `DATABASE_URL` | Actual restricted application role and effective privileges; no catalog role selected |
| `readonly_observer_role` | Historical observer `neondb_owner` identified and rejected as proof: BYPASSRLS/CREATE capabilities | Actual read-only non-superuser observer and privileges |
| `server_identity_binding` | `DATABASE_URL`, `HYPERDRIVE`, `DATABASE_SSL`, `PGSSLMODE`; `db/migrations/`; app ledger `schema_migrations`, optional `sha256`; extra historical `hk_funding_schema_migrations` | Host, proxy, port, physical catalog/ledger, checksum and privileges. No port or connection string guessed |
| `auth_tenant_id` | Neon Auth / `better_auth`; binding names `NEON_AUTH_URL`, `NEON_AUTH_COOKIE_SECRET`; resolver `src/features/auth/neon-auth-server.ts` | Actual isolated tenant/instance ID and non-secret HTTPS base URL; domains/project IDs are not tenant IDs |
| `role_identity_manifest` | Code columns for staff, user, team, active state, skills, `staff_profiles.access_revision` and client memberships mapped in discovery JSON | Actual 14-alias manifest and existing QA session method; no seed/test identities substituted |
| `network_allowlist` | Reference app hosts recorded; known production `kossilon-hub.vercel.app` / `www.kossilon-hub.vercel.app` excluded | Exact approved hosts; `approved_hosts` stays `[]`; reference URLs grant no access |
| `read_only_cost_ceiling_and_expiry_hkt` | Packet timezone `Asia/Hong_Kong`; previous metadata window is closed | Currency, amount, HKT window/expiry and approver; no old budget/approval reused |
| `cleanup_manifest_and_disposition` | Proposed `RETAIN_ONLY`; this pass creates no runtime resource and opens no QA session | Owner sign-off and future exact session references; no delete/reset/suspend/revoke/sign-out authorized |

Source details: discovery `sources.demo_metadata` is the committed
[2026-10-25 metadata receipt](../cosec-20261025-ap01-form-61f03672/AP01-METADATA-EXECUTION.json),
not a new read. The historical DB child comes from the
[2026-10-04 creation receipt](../evidence/2026-10-04-r01-staging-created.json)
and [blocked endpoint receipt](../evidence/2026-10-04-r01-b1-capability-blocked.json).
Production/catalog references come from the
[Vercel](../evidence/2026-10-03-r03-target-vercel.json) and
[Neon](../evidence/2026-10-03-r03-target-neon.json) inventories.
Each field's `source_refs` resolves to a hashed repo source and, where useful,
a JSON pointer. These references do not establish current existence, authority,
isolation, same-SHA execution, or a Native PASS.

### Public config and feature-flag contracts

These are repo values and paths, not changes to a deployment or selected Native settings.

| Name/path | Repo contract | Gate A implication |
| --- | --- | --- |
| `VITE_ENABLE_DEMO_AUTH` in `src/features/runtime/data-mode.ts` | True only selects demo data in a non-production build | Local demo evidence cannot supply Native identities |
| `VITE_PROVIDER_MODE` in `src/server/provider-mode.ts` | `local`, `simulated`, `live`; absent/blank defaults to `live`; simulated requires `FIRM_ID=kossilon-demo` | Actual target value `OWNER_REQUIRED`; do not assume provider sends are disabled |
| `VITE_ENABLE_NEON_AUTH_DEMO`, `FIRM_ID`, `DEMO_FIRM_ID` in `docs/runbooks/neon-auth-demo.md` and `scripts/validate-neon-auth-demo.ts` | Documented demo uses flag true, provider simulated and firm `kossilon-demo` | Demo contract only; it does not prove runtime configuration or Native acceptance |
| `MAINTENANCE_SCHEDULER_OWNER` in `wrangler.template.jsonc` | Template `paused` | No actual scheduler selected/activated; AP-11 stays blocked |
| `vercel.json` → `git.deploymentEnabled.main` | `false` | Main deploy hold retained; no deploy requested |
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

## AP status on candidate `ae9cbc19`

| AP | Status | Why |
| --- | --- | --- |
| AP-00 | `NOT_READY` | Gate A references filled, selected bindings/14 alias IDs `OWNER_REQUIRED`; Gate B `NOT_READY`; no approved packets |
| AP-01 | `NOT_READY` | No approved isolated target, exact-head deployment/CI, DB/Auth/role manifest, budget or expiry; AP-01-RO-1 is not started |
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
| AP-12 | `NOT_READY` | Cleanup IDs are blank. Default disposition is retain. Nothing was created |

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
