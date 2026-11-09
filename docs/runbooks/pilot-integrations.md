# Pilot integrations — decisions and rollout

**Decided:** 2026-11-09 (owner asked for the Track 1 decision set) · **Status:** policy decided; provisioning and
form work are the next Track 1 increments.

This is the decision record for the pilot. It exists so "not configured" never masquerades as "enabled" and so no
production env value is changed by accident. Canonical environments: [`environments.md`](environments.md).

## 1. Signup model — invite-only

**Decision: invite-only. No self-service signup, no open trial.**

- `/login` remains invite-only; `/request-access` stays the public explanation.
- The next increment adds a **request-access form with persistence** (a new forward-only migration) so requests
  become a reviewable queue instead of a mailto. Approval is needed before applying any production migration.
- Pricing stays "TBC"; no checkout or public purchase path is offered until the business confirms it.

## 2. Integration scope for the pilot

Policy: **configure and verify** what the pilot needs; **hide or disable** everything else. A capability that is not
provisioned must never render an enabled-looking action.

| Capability              | Decision                                  | Current state / required action                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document storage (R2)   | **Configure**                             | R2 S3 credentials and bucket name exist in production env; verify upload → quarantine → scan-result → review end to end in Track 1. Keep visible.                                                                                                             |
| Email delivery (Resend) | **Configure once the sender is approved** | `RESEND_API_KEY` exists; `EMAIL_FROM`/`RESEND_FROM` and the sender domain are **not chosen**. Until the owner approves a sender, email-dependent actions stay hidden/disabled. No email UI should look live.                                                  |
| WhatsApp / WOZTELL      | **Hide for the pilot**                    | No WOZTELL bindings in production env and no approved `zh_HK` templates. Hide the WhatsApp capability from pilot staff until bindings + `annual_return_reengagement` / `service_subscription_reengagement` templates are approved. Do not loosen the webhook. |
| Malware scanner         | **Defer / hide**                          | No scanner provider configured. Uploads that would need scanning stay unavailable with a visible capability explanation; do not silently accept unscanned files.                                                                                              |
| Backups / restore       | **Operations, not UI**                    | Neon PITR plus the retained recovery branch `br-little-truth-aolvycnr`. Schedule and record a restore drill as part of pilot sign-off.                                                                                                                        |
| Browser evidence / E2E  | **CI, not UI**                            | Post-deploy smoke is live; add Playwright critical journeys per Track 3.                                                                                                                                                                                      |

## 3. Production env provisioning — approval required

These values are deployment configuration, not documentation. They are **not** in this repo and must not be guessed:

| Binding                      | Needed value                                                                                   | Status                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FIRM_ID`                    | Deployment-level firm slug (format `^[a-z0-9][a-z0-9-]{1,62}$`; demo uses `kossilon-demo`)     | **Owner to confirm production slug.** Setting it is a production env change requiring explicit approval. |
| `EMAIL_FROM` / `RESEND_FROM` | Verified sender address on the firm's email domain                                             | **Owner to choose.** Then set with approval and verify one real send.                                    |
| WOZTELL bindings             | `WOZTELL_API_BASE_URL`, `WOZTELL_ACCESS_TOKEN`, `WOZTELL_CHANNEL_ID`, `WOZTELL_WEBHOOK_SECRET` | Deferred with the WhatsApp capability; only after template approval.                                     |
| `DOCUMENTS_BUCKET`           | Optional on Vercel/Node when the `R2_*` S3 trio is set (per `firm-deployment.md`)              | R2 path already satisfies document storage; keep as-is unless a Workers binding is used.                 |

Approval rule: production env changes are their own reviewed operation, followed by a deploy and the post-deploy
smoke run. No feature PR may carry them.

## 4. Scheduler verification policy

**Decision: an authenticated Vercel cron invocation is platform-verified evidence.**

- Vercel Cron sends `Authorization: Bearer $CRON_SECRET` plus `x-vercel-cron-schedule` (docs: Managing Cron Jobs).
  The maintenance endpoint already verifies the secret with a constant-time comparison; it now also matches the
  schedule header against the expression this deployment declares (`*/5 * * * *`).
- Such a run is recorded as `triggerEvidence: "platform-header"` and `platformTriggerVerified: true`, so the strict
  `/operations` maintenance view counts it. Missing header, mismatched expression or a hand invocation remain
  `http-candidate` / `manual` and are **not** counted as verified.
- `/api/health` still reports liveness from candidates and exposes `evidence` (`platform-verified` once a cron run
  lands after this deploy). A dead or failing cron still returns 503 and opens/updates the `ops-alert` issue.

## 5. Alert delivery

**Decision: GitHub issue is the default alert channel.**

- Scheduled smoke (and any failing run) opens or updates an `ops-alert` issue, which triggers GitHub's normal
  notifications/email for watchers. A manual dispatch with `simulate_failure=true` verifies the path.
- `SMOKE_ALERT_WEBHOOK` remains optional for Slack/Teams; it needs an incoming-webhook URL and is set as a
  repository secret. It is not required for alerting to work.

## 6. Capability transparency and security baseline

- `GET /api/capabilities` (public, no secrets) reports which integrations this deployment is provisioned for, by
  binding name only. Anything `configured: false` must not look enabled in the UI; `/operations` remains the
  authenticated detail view. Use it in support triage instead of reading env values.
- HTML responses carry baseline security headers (nosniff, referrer policy, frame denial, permissions policy,
  HSTS in production) plus a **report-only CSP**; `SECURITY_HEADERS=enforce` enforces it after an observation
  window. Auth POSTs are throttled per instance (30/5 min/IP) as a speed bump — the durable layer is the platform
  edge/WAF.
- Platform decisions (Vercel-only, staging plan, invite-only, zh-HK app, release cadence, branch cleanup) are
  recorded in [`../adr/0002-platform-decisions.md`](../adr/0002-platform-decisions.md).

## 7. Rollout order

1. Provision `FIRM_ID` + `EMAIL_FROM` (approval) → verify document + email path.
2. Request-access form + migration (approval) → manual invite flow.
3. Hide/disable WhatsApp + scanner in staff UI with capability text; keep `/operations` as the source of truth.
4. Restore drill + UAT re-run → pilot sign-off.
