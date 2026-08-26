# Firm Deployment Runbook

This runbook validates one firm environment without printing secrets or provisioning resources.

## Local dry run

```powershell
npm.cmd run check:production-imports
npm.cmd run verify:firm -- --dry-run
```

## REQUIRES EXPLICIT APPROVAL: Migration rehearsal

```powershell
$env:DATABASE_URL = "<approved staging connection string>"
npm.cmd run db:migrate
```

Approval is required to use any staging or production `DATABASE_URL`, run migrations outside an isolated local database, or rotate a secret.

- After migration 0020 is applied, confirm an active `sla_policies` row exists with
  `work_type = 'corporate_change_request'` (seeded automatically by `npm run db:seed`
  in demo/staging; in production, insert it manually the same way `annual_return_case`'s
  policy was originally set up, referencing an existing active `business_calendars` row).
  Without it, creating a corporate change request fails with "No active SLA policy
  exists for work type corporate_change_request."

## Runtime health

Verify the following bindings through the deployment provider's redacted environment view: `FIRM_ID`, Neon Auth URL and cookie secret, `DATABASE_URL`, `DOCUMENTS_BUCKET`, WOZTELL bindings, and `EMAIL_FROM`.

`DOCUMENTS_BUCKET` is satisfied two ways. On Cloudflare Workers it is the R2 binding declared in `wrangler.template.jsonc`. On a runtime without Workers bindings (Vercel, Node) the same R2 bucket is reached over its S3-compatible API, and these names are required instead: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, plus optional `R2_ENDPOINT` to override the default `https://<account-id>.r2.cloudflarestorage.com`. Supply the R2 API token values per deployment; they never belong in source control. When both forms are present the Workers binding wins.

## REQUIRES EXPLICIT APPROVAL: Provider provisioning

Approval is required before provisioning or changing Neon Auth, R2, Hyperdrive, email, WOZTELL, or malware-scanning resources.

For the planned isolated Neon Auth demo workflow, see [the Neon Auth demo runbook](neon-auth-demo.md).

## REQUIRES EXPLICIT APPROVAL: WhatsApp template approvals

Outside WhatsApp's 24-hour session window, free-form text is rejected and an
approved template is required. Both of the following must be approved in the
WOZTELL/Meta dashboard, in `zh_HK`, before automated reminders can reach a client
who has gone quiet:

- [ ] `annual_return_reengagement`
- [ ] `service_subscription_reengagement`

**Note:** These are the first `zh_HK` templates in this deployment. Every other
template path in the codebase defaults to `"en"`. Setting up a new language locale
requires careful verification in the dashboard — template name mismatches will cause
silent failures in production with no way to detect the error from within the
application.

Both are no-variable templates — they prompt the client to reply, which reopens the
window; they cannot name the client or the case. Their names are code constants in
`src/features/whatsapp/fallback-templates.ts`; changing one here requires changing
it there.

If a template is missing or unapproved, WOZTELL rejects the send and the failure is
logged by the dispatcher as `notification dispatch failed` with the notification
type and error code. Nothing in CI or `verify:firm` can detect this — it is a
dashboard-side fact.

## REQUIRES EXPLICIT APPROVAL: Webhook and auth probes

1. Verify Neon Auth invite and magic-link login for a staff user and a client user.
2. Verify a client cannot list or download another company's documents.
3. Send a signed WOZTELL webhook fixture and verify deduplication on repeated delivery.
4. Verify the firm integration health page exposes status only, never secret values.

Use local fixtures by default. Approval is required before sending a real provider webhook, inviting external users, or sending a real WhatsApp message.

## Named verification gates

The dry-run verifier emits a stable check list with pass, fail, or blocked status:

- Local pass gates: strict-data-mode, local-provider-mode, migration-schema, neon-auth-capability, and cron.
- Live blocked gates: database, storage, malware-scanner, whatsapp, email, backups, and browser-evidence.

A blocked gate is evidence that the integration still needs an approved environment or an observed verification artifact. It is not a request to place a secret in source control or in the verifier result. The verifier must remain offline and must not provision resources.
