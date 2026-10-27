# Native track open: AP-00 binding form

**Prepare only. Native NO_GO. No AP is approved. execution_enabled is false.**

Candidate git SHA to compare a future deployment against:
`79ad0c04da892ec03601f11c12d82fcc84039b31` (draft PR #149).

Previous unapproved plan: `cosec-20261025-native-plan-fccb7c22`, source
`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`, delivery
`531887acce5468f7321a3a2919a7afaa20dedac1`. That plan's runtime notes do not
carry forward. This form replaces its empty binding table for the current
candidate. The old files stay as historical preparation.

Write `NOT_READY` for every unknown. Do not invent a URL, run ID, database
name, Auth ID, object key, or fixture ID to make a row look complete. Secrets
stay out of this file.

## Gate A — Willy fills these before anyone proposes AP-01-RO-1

| Field | Required value | This refresh |
| --- | --- | --- |
| `environment_owner` | Person accountable for the existing isolated target | `NOT_READY` |
| `existing_isolated_url` | URL that already exists. Absence stays `NOT_READY` | `NOT_READY` |
| `runtime_project_id` | Project or runtime ID | `NOT_READY` |
| `deployment_id` | Deployment ID of the artifact under test | `NOT_READY` |
| `observed_source_sha` | SHA that deployment runs. Must match the approved candidate | `NOT_READY` |
| `observed_artifact_checksum` | Artifact checksum | `NOT_READY` |
| `required_ci_run_ids_and_results` | Required check names, run IDs, results, for that head | `NOT_READY` |
| `artifact_sbom_and_dependency_disposition` | SBOM or lockfile identity and accepted dependency disposition | `NOT_READY` |
| `db_provider_project_id` | Database provider project ID | `NOT_READY` |
| `db_branch_id` | Database branch ID | `NOT_READY` |
| `database_name` | Database name | `NOT_READY` |
| `app_role` | Application role for the product path | `NOT_READY` |
| `readonly_observer_role` | Observer role used to confirm identity. Not a superuser | `NOT_READY` |
| `server_identity_binding` | Host, proxy, port, migration ledger, catalog, checksum, privileges | `NOT_READY` |
| `auth_tenant_id` | Auth tenant ID | `NOT_READY` |
| `role_identity_manifest` | Auth ID, internal user, profile, team, revision, and existing-session method for each Gate A alias | `NOT_READY` |
| `network_allowlist` | Approved hosts only | `NOT_READY` |
| `read_only_cost_ceiling_and_expiry_hkt` | Currency, amount, HKT window, expiry, approver name | `NOT_READY` |
| `cleanup_manifest_and_disposition` | Retain-only plan for sessions this slice would open | `NOT_READY` |

### Gate A aliases

Actual Auth ID, internal user ID, profile ID, team ID, and revision are
`NOT_READY` for every alias.

| Alias | Relationship the owner must confirm | Actual IDs |
| --- | --- | --- |
| `ADMIN_PRIMARY` | Existing QA admin | `NOT_READY` |
| `ADMIN_RECOVERY` | Second existing QA admin, able to recover | `NOT_READY` |
| `STAFF_SOURCE` | Team A staff with open work across the three case types | `NOT_READY` |
| `STAFF_OWNER` | Team A owner successor | `NOT_READY` |
| `STAFF_REVIEWER` | Team A reviewer successor | `NOT_READY` |
| `MANAGER_A` | Team A manager | `NOT_READY` |
| `STAFF_B` | Team B staff, own company and case | `NOT_READY` |
| `MANAGER_B` | Team B manager | `NOT_READY` |
| `CLIENT_A` | Client membership on company A, no staff role | `NOT_READY` |
| `CLIENT_B` | Client membership on company B, no staff role | `NOT_READY` |
| `STAFF_NO_TEAM` | Active staff, team id null | `NOT_READY` |
| `AUTH_NO_PROFILE` | Auth account with no staff profile | `NOT_READY` |
| `STAFF_INACTIVE` | Disabled staff | `NOT_READY` |
| `STAFF_NO_SKILL` | Staff whose skills do not match the action | `NOT_READY` |

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

## AP status on candidate `79ad0c04`

| AP | Status | Why |
| --- | --- | --- |
| AP-00 | `NOT_READY` | Gate A and Gate B are blank. `approved_packet_ids` is empty |
| AP-01 | `NOT_READY` | No isolation URL, CI run, database identity, or Auth manifest. AP-01-RO-1 is named and not started |
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
