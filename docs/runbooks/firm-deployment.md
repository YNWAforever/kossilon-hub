# Firm Deployment Runbook

This runbook validates one firm environment without printing secrets or provisioning resources.

## Local dry run

```powershell
npm.cmd run check:production-imports
npm.cmd run verify:firm -- --dry-run
```

## Migration rehearsal

```powershell
$env:DATABASE_URL = "<approved staging connection string>"
npm.cmd run db:migrate
```

`REQUIRES EXPLICIT APPROVAL`: use a production `DATABASE_URL`, run migrations against production, or rotate any secret.

## Runtime health

Verify the following bindings through the deployment provider's redacted environment view: `FIRM_ID`, Neon Auth URL and cookie secret, `DATABASE_URL`, `DOCUMENTS_BUCKET`, WOZTELL bindings, and `EMAIL_FROM`.

`REQUIRES EXPLICIT APPROVAL`: provisioning Neon Auth, R2, Hyperdrive, email, WOZTELL, or malware-scanning resources.

## Webhook and auth probes

1. Verify Neon Auth invite and magic-link login for a staff user and a client user.
2. Verify a client cannot list or download another company's documents.
3. Send a signed WOZTELL webhook fixture and verify deduplication on repeated delivery.
4. Verify the firm integration health page exposes status only, never secret values.

`REQUIRES EXPLICIT APPROVAL`: sending a real provider webhook, inviting external users, or sending a real WhatsApp message.
