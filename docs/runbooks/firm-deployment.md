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

## REQUIRES EXPLICIT APPROVAL: Render and deploy

Approval is required before deploying to any hosted runtime.

1. Render `wrangler.template.jsonc` into `wrangler.jsonc`. Six values must be
   real, not placeholders: `FIRM_ID`, `NEON_AUTH_URL`, `WOZTELL_API_BASE_URL`,
   `WOZTELL_CHANNEL_ID`, `EMAIL_FROM`, `RESEND_FROM`.
   `scripts/validate-firm-runtime.ts` rejects a file whose placeholders survive.
2. Set every secret through `wrangler secret put` or the provider dashboard.
   Secrets never belong in the rendered file, in source control, or in a chat
   transcript.
3. Re-run the gate against the rendered file: `npm.cmd run verify:firm`.
4. Deploy: `npx wrangler deploy`.

Rendering `WOZTELL_API_BASE_URL` and `WOZTELL_CHANNEL_ID` is routing
configuration and does not enable sending. Sending requires the auth secret,
which is a separate decision and a separate approval.

## Runtime health

After the deploy, open `/operations`. Until it shows a run with trigger 排程, the
five-minute schedule has never been observed to fire on this runtime, and every
reminder, escalation and scan it owns should be assumed not to have run —
`BLOCKED_INTEGRATION: deployment-runtime`. Reading that screen day to day is
covered in [the pilot operations runbook](pilot-operations.md), which also holds
the capability-pause and rollback procedures.

Verify the following bindings through the deployment provider's redacted environment view: `FIRM_ID`, Neon Auth URL and cookie secret, `DATABASE_URL`, `DOCUMENTS_BUCKET`, WOZTELL bindings, and `EMAIL_FROM`.

`DOCUMENTS_BUCKET` is satisfied two ways. On Cloudflare Workers it is the R2 binding declared in `wrangler.template.jsonc`. On a runtime without Workers bindings (Vercel, Node) the same R2 bucket is reached over its S3-compatible API, and these names are required instead: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, plus optional `R2_ENDPOINT` to override the default `https://<account-id>.r2.cloudflarestorage.com`. Supply the R2 API token values per deployment; they never belong in source control. When both forms are present the Workers binding wins.

## REQUIRES EXPLICIT APPROVAL: Provider provisioning

Approval is required before provisioning or changing Neon Auth, R2, Hyperdrive, email, WOZTELL, or malware-scanning resources.

For the planned isolated Neon Auth demo workflow, see [the Neon Auth demo runbook](neon-auth-demo.md).

## REQUIRES EXPLICIT APPROVAL: WhatsApp template approvals

Approval is required before creating or changing WhatsApp templates in the WOZTELL/Meta
dashboard. Outside WhatsApp's 24-hour session window, free-form text is rejected and an
approved template is required. Both of the following must be approved in the dashboard,
in `zh_HK` language, before automated reminders can reach a client who has gone quiet:

- [ ] **`annual_return_reengagement`**
  - Where: WhatsApp Manager → Message Templates in the WOZTELL/Meta dashboard
  - Language: `zh_HK` (see note below on language variants)
  - Category: UTILITY (flag this for confirmation with WOZTELL support; UTILITY is the typical category for service reminders, but the firm's account settings may require a different choice)
  - Status: Must show "Approved", not "Pending" or "Rejected"; Meta review takes time and may request revision
  - Body (zero variables/placeholders): see suggested draft below

- [ ] **`service_subscription_reengagement`**
  - Where: WhatsApp Manager → Message Templates in the WOZTELL/Meta dashboard
  - Language: `zh_HK` (see note below on language variants)
  - Category: UTILITY (flag this for confirmation with WOZTELL support; UTILITY is the typical category for service reminders, but the firm's account settings may require a different choice)
  - Status: Must show "Approved", not "Pending" or "Rejected"; Meta review takes time and may request revision
  - Body (zero variables/placeholders): see suggested draft below

**Suggested body copy** (REVIEW BEFORE SUBMITTING — this is client-facing copy and the
firm should approve the wording):

```
你好，我們就貴公司的法定申報事宜有更新需要與您跟進。請回覆本訊息，我們的同事會盡快為您處理。
```

This must contain no variables or placeholders. The template cannot name the client or
the case — that is why a reply is requested rather than details being sent.

**Language variant warning:** Meta treats each language as a separate template. If you
author this template under `zh_TW`, `zh_CN`, or bare `zh` instead of `zh_HK`, the
dashboard will show "Approved" but the application will never match it (the code requests
`zh_HK` specifically). Both templates will fail silently in production with no error visible
in the app itself. Verify the language code in the dashboard exactly matches `zh_HK`.

**Both template names and the language code are code constants** in
`src/features/whatsapp/fallback-templates.ts`; changing either requires changing it there.

### Staff-initiated WhatsApp templates

The two templates above cover the automated sweeps only. Three further templates reach the
wire when a staff member sends a follow-up or a manual chase from the case screen, and
until now they appeared in no runbook and on no checklist. They are subject to the same
Meta approval requirement, and to the same silent-failure mode described below.

They are currently sent in **`en`**, not `zh_HK`. That is recorded as the fact it is, not
corrected: which language the firm submitted them under is a fact about the Meta dashboard
that this repository cannot read, and changing the code to `zh_HK` would break a
deployment where `en` is what was approved. **Confirm the language actually approved for
each, and align the code to it.**

- [ ] **`annual_return_document_replacement`** — language: `en`
  - Sent when staff ask a client to replace a rejected document.
- [ ] **`annual_return_payment_proof_replacement`** — language: `en`
  - Sent when staff ask a client to replace a rejected payment proof.
- [ ] **`annual_return_manual_reminder`** — language: `en`
  - Sent by the manual chase action, and by `queueAnnualReturnWhatsAppReminder`.

All five names are enumerated in `src/features/whatsapp/approved-templates.ts`, and a send
whose template is not listed there is now refused at the call site rather than at WOZTELL.
That converts a silent provider rejection into an immediate error naming the template, but
it does **not** verify Meta approval — nothing in this repository can.

**Error logging:** If a template is missing or unapproved, WOZTELL rejects the send and
the dispatcher logs it as `console.error("notification dispatch failed", {...})` to the
Cloudflare Worker logs (viewable via `wrangler tail`). The application UI has no way to
detect this — sweep failures are invisible there because the screen reading
`notification_outbox` filters on `idempotency_key like 'follow-up:%'`, and the
`redactExpired` cleanup nulls error columns after 90 days. Permanently unapproved templates
surface only as an aggregate count in Worker logs. Verify the `live blocked gates` section
below — `whatsapp` being blocked indicates the integration still needs an approved
environment, which includes these templates.

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
