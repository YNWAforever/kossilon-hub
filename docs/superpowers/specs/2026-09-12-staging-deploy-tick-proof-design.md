# Staging deploy: prove the tick fires

**Date:** 2026-09-12
**Status:** design approved, implementation not started
**Phase:** the first sub-project after A–F

## Why this, and why only this

Phases A–F are code-complete and merged. Everything still open is gated on
something the repository cannot provision for itself, and one of those blockers
is different in kind from the rest:

> `BLOCKED_INTEGRATION: deployment-runtime` is the only blocker that is
> **unverifiable** rather than merely unbuilt. No amount of reading, local
> testing or CI clears it. Only a real invocation on a real deployment can.

Everything else in the backlog — the malware scanner, the AI provider, WhatsApp
media download, the pilot itself — depends on having a deployment that can be
observed. A scanner adapter cannot be confirmed to work without a Worker that
can reach the network.

This sub-project therefore deploys, and integrates nothing.

The case for keeping it that narrow is this session's own evidence. Every
surface that had never actually run turned out to be wrong: CI found eight SQL
defects the moment it first executed them, a migration rehearsal against a
populated database found a ninth that CI structurally could not see, and the
test suite could not be run twice against one database. A deployment is the next
never-run surface. Deploying four provider adapters alongside it would put four
more never-run surfaces into the same change, and a failure would not be
attributable to any of them.

## The finish line

**Not "the deploy succeeded".** Four facts, all readable on `/operations`:

| # | Check | Proves |
| --- | --- | --- |
| 1 | Schema panel reads 一致, `appliedCount` equal to `EXPECTED_MIGRATIONS.length` (33 at the time of writing) | `0023`–`0033` actually ran against the staging database |
| 2 | A run row with trigger 排程 | The five-minute cron fires on a real runtime |
| 3 | Maintenance state is not `never-observed` | The tick is being recorded, not merely scheduled |
| 4 | Dispatch reports fixture-origin **cancelled > 0, sent = 0** | The send-gate holds in a live Worker, not only in tests |

Check 1 exercises the schema-drift check for the first time against a database
somebody else migrated. Check 2 is what clears `deployment-runtime`. Check 4 is
the safety property, and it is an acceptance criterion rather than an assumption
precisely because it has never run anywhere but in tests.

## Non-goals

Explicitly **out of scope**, and to stay out of scope even if they look easy
once a deployment exists:

- The malware scanner, the AI provider, WhatsApp media download and WhatsApp
  sending. All four stay unconfigured so their capabilities stay disabled.
- **F-5**, the pilot. It needs the scanner for `verified` → package approval, and
  `pilot-measurement-plan.md` requires the baseline to be collected *before*
  anyone is handed the product.
- **F-6**, scale and query plans. Still blocked: there is no representative
  dataset, and adding indexes without measurement is what plan F2 forbids.
- **F-7**, backup/restore verification. Needs a database and a bucket restored
  together, which is its own sub-project.

## Sequence

Steps 1–3 are local, safe and reversible. Step 4 is the only one that changes
anything outside this machine.

1. **Local gate.** `check:production-imports`, then `verify:firm -- --dry-run`.
2. **Render `wrangler.template.jsonc`.** Nine placeholders. Six of them —
   `FIRM_ID`, `NEON_AUTH_URL`, `WOZTELL_API_BASE_URL`, `WOZTELL_CHANNEL_ID`,
   `EMAIL_FROM`, `RESEND_FROM` — must be real values; `validate-firm-runtime.ts`
   rejects a file whose placeholders are unrendered.

   The two WOZTELL entries are **not** a contradiction of the non-goal above.
   They are routing configuration, and the validator will not let the deployment
   exist without them. What makes sending impossible in this phase is the
   withheld auth secret, not an empty base URL. Rendering config and withholding
   credentials are different things, and only the second one gates capability.
3. **`verify:firm` against the rendered file.** Proves the deploy surface is
   complete before any database is touched.
4. **Apply `0023`–`0033` to staging. REQUIRES EXPLICIT APPROVAL AT THE MOMENT OF
   RUNNING.** Then confirm `schema_migrations` holds 33 rows, and confirm the
   active `sla_policies` row for `work_type = 'corporate_change_request'` that
   the deployment runbook warns about after `0020`.
5. **Deploy the Worker.**
6. **Wait up to two cron intervals (~10 minutes)** — which is exactly
   `MISSED_TICKS_BEFORE_STALE`, so a tick that has not arrived by then is late by
   the product's own definition — and read `/operations`.

### Credential handling

Every secret is set by the operator, through `wrangler secret put` or the
provider dashboard. Secrets are never pasted into chat, never committed, and
never echoed back. This design and the work that follows it reference **binding
names only**, per `CLAUDE.md`.

## Safety design

Two independent layers, because on staging the messaging path is the only thing
that could reach a person.

**Primary, data-driven.** `scripts/db-seed-annual-return.ts` writes
`data_origin: "fixture"`, and `dispatcher.ts` calls
`cancelFixtureOriginNotifications(now)` before sending, which cancels outbox rows
for companies whose `data_origin <> 'client'`. Seeded reminders are therefore
cancelled rather than delivered, by construction. Acceptance check 4 is what
turns "by construction" into "observed".

**Secondary, absence of capability.** The WOZTELL auth secret is not configured
in this phase, so anything that bypassed the first layer would fail to send
rather than succeed in sending.

### Finding: staging cannot declare itself non-live

`normalizeProviderMode` resolves an **absent** `VITE_PROVIDER_MODE` to `live`,
deliberately — production sets nothing. `"simulated"` is rejected unless
`FIRM_ID === "kossilon-demo"`, and `"local"` throws in a production build.

A staging deployment of any firm other than the demo one is therefore **forced
into `live` provider mode**. There is no configuration that says "this is
staging, do not send". That is why the safety argument above rests on
`data_origin` rather than on provider mode.

This does not block this phase. It is recorded because it is a real gap, and
because the obvious later instinct — "set staging to simulated" — will not work
and should not be attempted without changing `resolveProviderMode`.

## Failure modes

| Symptom | Meaning | Why it is acceptable |
| --- | --- | --- |
| `/operations` stays `never-observed` | The cron never fired | Visible rather than silent. This is exactly what F-1 and F-2 were built to make legible. |
| Schema panel says `behind` | Migrations did not all apply | Names the earliest missing migration rather than failing as a scattered `relation ... does not exist`. |
| Schema panel says `ahead` | The database is newer than the deployed code | A deploy-order problem. Do **not** run the migrator. |
| The page fails outright | The database is unreachable (Hyperdrive misconfigured) | The ledger read happens first and is deliberately unguarded: a database that cannot be reached is not one this screen can report on. |
| Dispatch shows `sent > 0` | **Stop.** The send-gate did not hold | Pause the deployment per `pilot-operations.md` before investigating. |

## Documentation changes in scope

- `docs/runbooks/firm-deployment.md` jumps from "Migration rehearsal" straight to
  "After the deploy". Add the render-and-deploy step between them.
- `docs/implementation/kossilon/status.md` still claims no branch has been pushed
  and lists a CI run as outstanding. Both are stale: PR #59 and #60 merged, and
  CI has run green against a migrated and seeded Postgres.

## What this still does not clear

`document-text-extraction` (new work, not a provider) and
`external-handoff-destination` (needs the internal server's protocol) remain
blocked and are untouched by this phase. The four provider-gated integrations
remain blocked *by choice* here, and each becomes its own sub-project once a
deployment exists to verify it against.

## Open question for implementation

Whether the staging database already holds rows. If it does, `0026` carries a
data backfill and is not purely additive, so it should be rehearsed against a
throwaway copy of that database first — the technique that caught the
`data_origin` defect CI could not see. On an empty staging database this is
unnecessary.
