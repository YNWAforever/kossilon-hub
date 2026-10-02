# Capability diagnosis — T23 / F17

Operations separates **implemented**, local binding **configured**, recorded **health**, **lastVerifiedAt**, manual **approvalRequired**, **owner** and **nextAction**. A binding is not a provider probe, adapter code is not runtime verification, and recovery does not cancel approval. Rendering performs no provider requests, writes, invitations or test messages.

| Capability | Evidence and smallest blocker                                                                                      | Owner / next action                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Database   | Catalog/ledger reads; dispatch marker column/index coverage only, not all application DDL                          | DB/release: reconcile historical IDs/hashes and approved additive SQL; read failure is unknown                                |
| Scheduler  | Recent scheduled run and historical success timestamp; lease expiry/unknown counts; safe scope explicitly labelled | Operations: inspect actual owner/platform trigger, corroborate three real ticks; `scheduler-runbook.md`                       |
| Neon Auth  | Required bindings present, fresh login/roles unverified                                                            | Auth: controlled Admin/Manager/Staff/Client A/B and fresh magic-link/Google; no implicit invitations                          |
| R2         | Four bindings present, bucket identity/permissions/roundtrip unverified                                            | Storage: approved private sample and current-version authorisation                                                            |
| Scanner    | Existing HTTP adapter; scanner bindings absent from observed Vercel inventory                                      | Security/provider: approved endpoint/token presence, contractual response and controlled real verdict; keep quarantine closed |
| Text layer | Existing unpdf implementation; recorded extraction existence does not prove current sample/version                 | Document: scanner-safe version/checksum, citation and runtime golden samples                                                  |
| OCR / AI   | OCR not implemented; AI HTTP adapter exists but bindings absent from observed project inventory                    | Provider: approved protocol/model/key and real grounded sample; AI never approves                                             |
| WOZTELL    | Outbox/webhook implemented; four bindings absent from observed project inventory                                   | Messaging: official media protocol and controlled recipients; accepted != delivered, unknown requires reconciliation          |
| Handoff    | Manifest implemented, external transport protocol unknown; export != submission                                    | Internal-server/business: approved upload/receipt contract or explicit manual evidence/intake                                 |

The inventory is read-only at 2026-10-01. Absence in Vercel is not absence in an uninspected Cloudflare environment. No secret values are included.

## Partial queries

Schema, scheduled history, last success, queues, text-layer evidence, catalog and lease health are independently read. A failing query returns unknown for its own fact and leaves other successful facts visible. Admin diagnostics expose failed read names and correlation ID; other staff get only authorised operational status. Database/provider errors and tokens are not returned or logged.

An old successful tick is **stale**, not “never observed”. A failed last-success query is **unknown**, not “never succeeded”. Incomplete/negative/noninteger recorded job counts are unknown, not partial counts presented as complete. Explicit unknown lease state is counted immediately; active started work is only treated as unresolved after expiry.

## Updating evidence

Use `environment-matrix.md`, `uat-results.csv` and scoped evidence JSON. Record exact build, environment, command, timestamp, sample version and approving owner. Never mark healthy from config presence, fixtures, dry-run, an existing session or a manual cron request. Current UI probe states remain unknown unless real recorded evidence is supplied. Update this table with each connector task rather than inventing a new provider API.
