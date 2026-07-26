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

## Runtime health

Verify the following bindings through the deployment provider's redacted environment view: `FIRM_ID`, Neon Auth URL and cookie secret, `DATABASE_URL`, `DOCUMENTS_BUCKET`, WOZTELL bindings, and `EMAIL_FROM`.

`DOCUMENTS_BUCKET` is satisfied two ways. On Cloudflare Workers it is the R2 binding declared in `wrangler.template.jsonc`. On a runtime without Workers bindings (Vercel, Node) the same R2 bucket is reached over its S3-compatible API, and these names are required instead: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, plus optional `R2_ENDPOINT` to override the default `https://<account-id>.r2.cloudflarestorage.com`. Supply the R2 API token values per deployment; they never belong in source control. When both forms are present the Workers binding wins.

## REQUIRES EXPLICIT APPROVAL: Provider provisioning

Approval is required before provisioning or changing Neon Auth, R2, Hyperdrive, email, WOZTELL, or malware-scanning resources.

For the planned isolated Neon Auth demo workflow, see [the Neon Auth demo runbook](neon-auth-demo.md).

## REQUIRES EXPLICIT APPROVAL: Webhook and auth probes

1. Verify Neon Auth invite and magic-link login for a staff user and a client user.
2. Verify a client cannot list or download another company's documents.
3. Send a signed WOZTELL webhook fixture and verify deduplication on repeated delivery.
4. Verify the firm integration health page exposes status only, never secret values.

Use local fixtures by default. Approval is required before sending a real provider webhook, inviting external users, or sending a real WhatsApp message.

## Named verification gates

The dry-run verifier emits a stable check list with pass, fail, or blocked status:

- Local pass gates: strict-data-mode, route-import-guard, local-provider-mode, migration-schema, neon-auth-capability, and cron.
- Live blocked gates: database, storage, malware-scanner, whatsapp, email, backups, and browser-evidence.

A blocked gate is evidence that the integration still needs an approved environment or an observed verification artifact. It is not a request to place a secret in source control or in the verifier result. The verifier must remain offline and must not provision resources.
