# Pilot Operations Runbook

Status: **runtime signed off; owner-gated items remain** (2026-11-09).

This runbook is the checklist for the staff pilot. Re-check it with the read-only sign-off command before the
pilot starts and after any risky deploy:

```bash
npm run pilot:signoff          # prints JSON; add -- --write to refresh the receipt
npm run rehearse:rollback      # verifies the rollback candidate + capability pause
```

Latest machine receipts: [`pilot-signoff-latest.json`](../releases/pilot-signoff-latest.json),
[`rollback-rehearsal-latest.json`](../releases/rollback-rehearsal-latest.json).

## Current verified facts

| Fact                 | Value                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Production identity  | `kossilon-hub.vercel.app`, `environment=production`, `dataMode=production`, sha matches the deployment |
| Demo identity        | `kossilon-hub-demo.vercel.app`, `dataMode=demo` (fixture, read-only)                                   |
| Scheduler            | `/api/health` 200 · `running=true` · `evidence=platform-verified` · `maintenance=healthy`              |
| Security headers     | `/login` returns nosniff + report-only CSP (+ HSTS in production)                                      |
| Request-access state | honest mailto fallback; persisted form hidden until migration 0083 is applied                          |
| Capabilities         | `/api/capabilities` lists firm/database/auth/documents/email/whatsapp/document-scanner/scheduler       |
| Alerting             | scheduled smoke failure opens/updates an `ops-alert` GitHub issue (email to watchers)                  |
| Rollback             | previous READY deployment verified by read-only rehearsal (no traffic switch)                          |

## Sign-off checklist

| #   | Requirement                            | Status                        | Evidence / next step                                                                                                                                                                                                |
| --- | -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI + auto-deploy + post-deploy smoke   | **YES**                       | GitHub Actions `CI`; smoke workflow green on every main merge                                                                                                                                                       |
| 2   | Deployment identity                    | **YES**                       | `/api/version` sha matches deployed commit                                                                                                                                                                          |
| 3   | Scheduler liveness + platform evidence | **YES**                       | `/api/health` platform-verified; five-minute Vercel cron                                                                                                                                                            |
| 4   | Alert delivery                         | **YES**                       | `ops-alert` issue path exercised (issue #171 simulated; #176 real outage, both closed)                                                                                                                              |
| 5   | Rollback rehearsal                     | **YES**                       | `npm run rehearse:rollback` — candidate version/health/login verified, read-only                                                                                                                                    |
| 6   | Capability-pause rehearsal             | **YES**                       | migration 0083 staged; `/request-access` fallback proven (`form=false`)                                                                                                                                             |
| 7   | Integration states honest              | **PARTIAL**                   | `/api/capabilities` + `/operations` report bindings; R2/docs configured; email/WhatsApp/scanner unconfigured. Staff-facing nav hiding for WhatsApp/scanner is **not yet implemented** — see `pilot-integrations.md` |
| 8   | Request-access persistence             | **NO — owner approval**       | migration `db/pending-migrations/0083…`; apply procedure in `pilot-integrations.md`                                                                                                                                 |
| 9   | Admin invite / role-team provisioning  | **NO — design + Neon Auth**   | review queue exists (approve/reject); actual invitation call not wired                                                                                                                                              |
| 10  | `FIRM_ID` / `EMAIL_FROM` provisioning  | **NO — owner values**         | `pilot-integrations.md` §3                                                                                                                                                                                          |
| 11  | Backup/restore drill                   | **NO — credentials + target** | `backup-restore.md`; Neon PITR + retained branch exist but restore was never exercised                                                                                                                              |
| 12  | Authenticated UAT re-run               | **NO — invited accounts**     | audit UC99–UC118 + P1 findings; portal/readiness code fixes already landed, runtime proof missing                                                                                                                   |

Do not start the staff pilot while rows 8–12 are “NO”. Rows 7–12 each need an owner decision or an approved
resource; they are not code caveats.

## The one thing to check every morning

`/operations` scheduler state (or `GET /api/health`):

| State     | Meaning                                               | Action                                                                                                |
| --------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| never run | No scheduled run has **ever** been recorded           | Cron not registered or wrong deployment. Do not trust reminder/chase lists.                           |
| stale     | Two consecutive ticks missed (default tolerance 600s) | Nothing has been re-evaluated since the last run. Treat every chase list and deadline as unrefreshed. |
| failing   | The tick did not complete                             | Read the structured runtime logs; `/api/health` returns 503.                                          |
| partial   | Some passes threw; the rest ran                       | The named pass did nothing this tick.                                                                 |
| healthy   | Clean run inside tolerance                            | Nothing.                                                                                              |

Also confirm `/api/version` shows the latest `main` SHA. The scheduled smoke now checks freshness before the health
checks and opens an `ops-alert` issue if production is running an older commit.

Only platform-verified cron invocations count as evidence. A manual `curl` cannot make a dead cron look alive.
A failing smoke or health check opens/updates the `ops-alert` GitHub issue; close it only after the next two ticks are
healthy.

## Pausing a capability

A capability is paused by **removing its binding**, not by deleting rows or reversing migrations.

| To pause                   | Remove                                             | What happens                                                                                       |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Document scanning          | `DOCUMENT_SCANNER_URL`, `DOCUMENT_SCANNER_API_KEY` | Scan pass reports not-configured; documents stay quarantined and visible; nothing is marked clean. |
| AI analysis tier           | AI provider binding                                | Tier 3 skipped; tiers 1–2 still run; no finding disappears.                                        |
| WhatsApp sending           | `WOZTELL_ACCESS_TOKEN`                             | Dispatch fails loudly; outbox retains rows; no loss, no double send.                               |
| Email sending              | `RESEND_API_KEY`                                   | Same shape as WhatsApp.                                                                            |
| Request-access persistence | keep migration 0083 staged (do not apply)          | Public page shows mailto fallback; admin queue shows “not enabled yet”; no row can be written.     |

`/api/capabilities` and `/operations` are the source of truth for what is paused/configured. Never fake a capability
as enabled.

## Rollback

Roll back the **deployment**, not the data: this schema is forward-only and additive.

1. Run `npm run rehearse:rollback` to confirm the previous READY deployment still serves version/health/login and
   to record the candidate sha.
2. Use Vercel instant rollback to that candidate; re-run the rehearsal; `/api/version` must show the candidate sha.
3. Do not rewrite `main` history (Lovable constraint). Data restore is a separate operation — see
   [`backup-restore.md`](backup-restore.md), including its open requirement to verify database and R2 together.

## Incident lesson (2026-11-09)

Adding an unapplied migration to `EXPECTED_MIGRATIONS` stopped the maintenance tick with 503 for ~65 minutes: the
schema guard refuses to run when the expected ledger is ahead of the database. Forward migrations must stay in
`db/pending-migrations/` until the apply operation moves them into `db/migrations/` together with `schema.sql` and the
expected ledger.

## What this runbook cannot tell you yet

- Backup/restore integrity (database + R2 together) — never exercised.
- Provider deliveries (Resend email, WOZTELL WhatsApp, scanner, AI) — no approved provider accounts.
- Authenticated UAT outcomes and role/session isolation — needs invited accounts.
- Representative performance past 200 cases / 10k work items on production data.
