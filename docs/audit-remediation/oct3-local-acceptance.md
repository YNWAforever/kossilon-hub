# Oct3 task acceptance ledger

This is local regression acceptance of the existing architecture, not fresh provider/business acceptance. The original 50 UAT CSV is byte-unchanged: 19 historical LOCAL ONLY passes and 31 blocked. F01–F20/T00–T23 IDs remain intact; R00–R11 and F21/F22 are additional records.

Machine commands, actual counts, timestamps and retained log/report hashes: [2026-10-03-local-acceptance.json](evidence/2026-10-03-local-acceptance.json). Domain source baseline is main `6f0a851`; R02 adds only release/Operations compatibility. Passing existing contracts does not justify rewriting those flows.

| Task | Local recheck | Genuine acceptance still missing |
| --- | --- | --- |
| R04 | Documents lineage/visibility, scan/AI worker contracts, shared readiness, payment evidence/current version/concurrency and payment UI | Approved hosted target and fresh staff identity; actual R2 bytes/scan verdict; per-document legacy recovery decision; owner-labeled OCR/AI corpus. No metadata marked clean. |
| R05 | Actual PG Admin invariants plus server/document/actor authorization | Fresh magic-link/Google/expiry/revoke receipts and controlled two-company/team role matrix; tenant-verified invitation API/scope. No grants or invitations written. |
| R06 | Actual PG bulk snapshot/actions/partial/idempotency, NAR mapping/normalize/XLSX parser/100-row apply, metrics and full-scope pagination | Approved original XLSX, business scope/provenance and controlled staging native worker; 3-row then 100-row apply approval. Local synthetic inputs do not clear this gate. |
| R07 | Webhook signature/replay, ambiguous intake/media, session/provider/outbox contracts and all-origin suppression | Verified WOZTELL sandbox/channel/CDN protocol, approved recipient/purpose/send scope, genuine inbound/outbound/query/receipt evidence. Unknown never blindly retried. |
| R08 | Actual PG immutable handoff/history/races, destination contract, manual UI and authorized export boundary | Real platform ZIP/streaming sample; approved manual operator/reference and quarantined return/reconciliation proof. Automated destination protocol/auth/query contract remains absent. Export is not submission. |
| R09 | Actual PG incorporation/corporate lifecycle and template versions; Settings save/revision contracts | Controlled fresh-role full journeys, 390/1280 keyboard/focus/touch screenshots. CI's demo browser regressions remain separate. |
| R10 | Metrics/page-scale, schema/native-health separation and scheduler wiring contracts | Owner-adopted SLO and hosted equivalent PG18/platform/region/pool dataset; 10k/50k with representative versions/officers, 25 users with 5-minute ramp/15-minute steady, cold/warm p50/p95/p99/error/HTTP/RTT/render; three native ticks and failure/recovery. No production load test performed. |

Existing local performance receipts remain dated and scoped: [SLA/NAR before-after](sla-calendar-performance.md), [query performance](performance.md). They are evidence of already integrated local fixes, not new hosted measurements or an accepted SLO. The current NAR100 regression retains its original timeout; no correctness or safety gate was relaxed.

## R11 release gate: NO_GO

Reviewable packages:

1. Baseline/evidence delta PR122, R00 installer parity PR123.
2. Actual-live old-schema security candidate PR124, exact base `aa5d3cb` and patched head `257fb9d0be17525a305f38bd26001ad8fa45deb8`; deploy only after same-schema preview and an explicit artifact/target acceptance gate.
3. R02 additive historical compatibility PR125, code `ae88f194d5862f27399001235102378294989c11`, frozen SQL/manifest and local restore evidence. Its external approval/runtime binding remains missing.
4. R03–R11 local acceptance/runbooks and exact external owner inputs in this delivery. No external resource was activated.

For a formal operation, fill the approved hosted target, app role, seven logical owners/non-FK dependencies and sole DDL freeze; verify restore and current strict pre-guard; review exact package/manifest/payload hashes; name exact web and scheduler artifacts separately; attach full post-release contracts, fresh-role/provider/UC receipts and signed business scope. Pause competing triggers/dispatch first. Never activate the four pending sends or fourteen analysis jobs as a blanket release step.

Web remains last-observed `aa5d3cb / dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`; scheduler artifact is `not_verified`, and recorded Sep30 ticks are stale. Both artifacts must independently match one approved release contract. Main `gitDeploymentEnabled=false` means automatic main deployment is disabled; it does not prove a production candidate was promoted or a scheduler ran.

Rollback retains uncertain attempts, data and additive schema. Restore only a reviewed compatible patched build/configuration; committed DB changes use a reviewed forward fix. Hosted restore needs an approved write pause, exact backup/target and data-loss window. Read-only/offline parser success, config presence, local mocks, manual ticks and CI success cannot change this NO_GO decision.
