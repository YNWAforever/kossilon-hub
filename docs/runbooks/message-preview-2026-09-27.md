# T18 case contact, preview and approved WhatsApp queue

Scope: local implementation on `codex/kossilon-message-preview`, stacked on T17. K18 and K22 are addressed locally. T03 is still runtime gated. This is not evidence of a production send or deployment.

## Flow and invariants

A staff member chooses an authorized annual-return case and a saved company contact. The contact must have a human-confirmed E.164 number, evidence note and language. Changing the saved raw phone clears its verification in the database. Reply preview requires a matching provider conversation and an inbound message inside the 24-hour window. Reminder preview requires the exact active provider-verified template body and language. Both freeze recipient, text, mode, template, contact version and case context for ten minutes. Staff explicitly approves the preview; the queue transaction locks the preview, case and contact, rechecks permission and content, then reuses the existing WhatsApp outbox service. Duplicate queue of a preview is refused for inspection.

Production follow-up automation now shows the recipient and exact rendered case text before approval. It recomputes its hash, verified contact and session in the queue transaction. A replay with a different approval is refused. The live dispatcher checks persisted contact and case state, plus the 24-hour send mode, immediately before crossing the provider-call boundary. A stale approval is cancelled; no substitute template or automatic unknown-outcome retry is used. A provider call already started remains in the existing reconciliation path.

The current provider capability gate requires a fresh same-deployment health result. Without it, preview is read-only and queue is unavailable. Demo remains read-only. Staff correct missing contact details from the client profile; no arbitrary phone entry is accepted by the send endpoint. No recipient, number, template or approval evidence is inferred from fixture data.

## Schema and release preparation

Forward SQL: `db/migrations/0044_message_preview.sql`. It adds evidence-backed contact verification, provider template approval evidence and durable short-lived previews. Existing contact phones and templates remain unverified. The schema snapshot and compatibility registry include 0044. Inspect the *actual target* database ledger and definitions before any migration; the T00 production binding and legacy `0006_client_register.sql` remain unresolved. Do not run this migration against production under this assignment.

Guarded rollback SQL: `docs/runbooks/message-preview-rollback-0044.sql`. It runs in one transaction, locks affected tables, and refuses rollback if any preview, verified contact or provider approval evidence exists. A nonempty deployment requires a forward repair instead of dropping audit data. Production rollback is not authorized here.

## Provider and pilot dependencies

The T17 runbook lists WOZTELL BotAPI, webhook and Open API bindings. For T18 the minimum additional evidence is: current deployment provider-mode/config identity; a scoped read-only capability probe in that deployment; verified template name, language and body from the actual tenant; an authorized non-client test recipient with an inbound message; and a provider receipt/status webhook observed against the queued test message. Only after a separately authorized pilot may runtime status become `runtime-verified` or `pilot-accepted`. No live recipient send, provider subscription change or deployment is included in local verification.

## Local evidence

The named T18 direct-preview tests were RED 3/3 on the stub and GREEN 3/3. The final dispatch gap was RED 1/1 (transport called without a follow-up guard) and GREEN after the preflight and persisted-state guard. PostgreSQL integration covers raw-phone invalidation, old-preview refusal, atomic queue and follow-up contact invalidation. Full-suite, build, lint, migration rehearsal and review evidence are recorded in `06_EXECUTION_STATUS.csv` after final verification.
