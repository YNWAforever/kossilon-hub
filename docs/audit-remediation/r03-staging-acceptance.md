# R03: staging inputs and native acceptance

## Fresh read-only backlog, 2026-10-03

[Inventory](evidence/2026-10-03-r03-backlog-inventory.json) targets only Neon `red-morning-00331124 / br-muddy-mountain-aov8bbku / neondb` and records the exact SELECT statements and UTC observations.

Three companies remain recorded as `client`. Business classification is unverified; their UUIDs or resemblance to seed data are not classification evidence. Four notifications remain pending, attempt count 0, with no delivery approval or recorded provider message ID. Fourteen analysis jobs remain pending, with no upload intent and no verified bytes. No row was updated, activated, marked clean or retried.

Before action, refresh each item's exact PostgreSQL version, linked case/company scope, idempotency/attempt evidence and provider acceptance; obtain a per-item owner decision. Unknown dispatch results require query/reconciliation, never blind retry. Legacy analysis recovery requires actual object bytes and a reviewed upload/scan/review path; metadata cannot authorize clean status.

Seven unattributed tables still require logical-owner and non-FK dependency review: `hk_funding_schema_migrations`, `personal_workspaces`, `sync_changes`, `sync_conflicts`, `sync_entities`, `sync_field_revisions`, `sync_operation_receipts`. They are preserved and included in runtime catalog discovery.

## Precise external inputs

| Owner | Missing input / next action |
| --- | --- |
| DB / Data | Approve hosted staging project, branch, database and restricted app role; identify the seven logical owners and sole DDL owner/freeze; authorize one backup export/restore and verify row/key/hash receipts. Local PG18 restore does not clear this gate. |
| Release / Ops | Name one staging scheduler (Vercel or Cloudflare), its platform account/plan capability, exact scheduler artifact SHA and matching approved release contract. Supply invocation log access. Record web artifact SHA separately. Keep dispatch/provider passes off. |
| Storage / Security | Approve isolated R2 bucket and credential binding through the secret store: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (optional `R2_ENDPOINT`); supply controlled objects and integrity samples. |
| Auth / QA | Approved staging origin/callback, existing controlled Admin/Manager/Staff/Client identities and two-company/team membership matrix; `NEON_AUTH_URL` and cookie secret supplied through the environment owner. Fresh login, expiry/revoke and negative access receipts are required. |
| Scanner / Analysis | Verified endpoint protocols, controlled clean/infected/error/stale byte samples and labeled OCR/AI corpus: `DOCUMENT_SCANNER_URL`/`DOCUMENT_SCANNER_API_KEY`, `DOCUMENT_AI_URL`/`DOCUMENT_AI_API_KEY`. Binding presence is not provider PASS. |
| Channel | Verified `WOZTELL_API_BASE_URL`, `WOZTELL_ACCESS_TOKEN`, `WOZTELL_CHANNEL_ID`, `WOZTELL_WEBHOOK_SECRET`; approved sandbox recipient/purpose/send scope plus real inbound/media/outbound/receipt contract. Never send secrets in chat. |
| Filing | Approved manual uploader, package and external reference/return proof. Automated handoff additionally requires verified destination protocol, scope, authentication, query/receipt behavior and sandbox; a stub is not integration. |
| Business / QA | Original approved XLSX, provenance decisions for 3 companies/4 notifications/14 documents, Finance/Reviewer mapping to existing roles, acceptance owners and performance SLO adoption. |

## Local staging contracts and activation sequence

1. Run existing synthetic `client`/`fixture`/`historical` origin fixtures with dispatch off. Preserve suppression and claim-to-dispatch origin checks; mocked transports prove only local contracts.
2. Restore the approved hosted backup into the named isolated branch; verify original data/ledger and full physical contracts. Apply only a reviewed target-specific package, retain strict ordinary-migrator refusal and compare R02 receipt/hash/build/environment.
3. Pause competing triggers. Enable exactly one authorized native staging trigger after identity/schema/role checks; do not use HTTP calls as evidence. Unsafe provider passes remain disabled until their own explicit sandbox acceptance.
4. Observe three actual five-minute platform ticks. For each save platform invocation ID, UTC slot, native trigger, exact artifact SHA, correlation/run/job IDs, lease/fencing state, start/finish, per-job counts and queue before/after. Compare source/build/DB/R2/Auth identity to the approved contract.
5. Introduce one controlled per-job failure on staging; verify partial results, other-job progress, correlated error and recovery. Started/unknown work is reconciled rather than replayed. Confirm latest genuine tick is within the UI ten-minute freshness threshold.
6. Attach the three platform receipts, partial-failure/recovery evidence, full R02 catalog and restore receipt. Until then native acceptance is `not_run/runtime-blocked`, regardless of local tests, built hook or manual tick success.

Rollback: pause the selected trigger and dispatch, retain uncertain attempts/leases/data, restore only the reviewed compatible web/scheduler artifacts and configuration. Hosted restore and any permission write require concrete target/diff/hash/acceptance/rollback authority. Cleanup only the exact owned staging fixtures named in receipts.
