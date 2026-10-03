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
3. R02 additive historical compatibility PR125, final code `875734397f03479e1a0a915608b7dd60a06a9361`, frozen SQL/manifest and v3 local restore evidence. Fresh review's two Important findings are fixed: physical view/sequence/durability and tenant privilege/ownership/membership drift now invalidate the contracts. Its external approval/runtime binding remains missing.
4. R03–R11 local acceptance/runbooks and exact external owner inputs in this delivery. No external resource was activated.

For a formal operation, fill the approved hosted target, app role, seven logical owners/non-FK dependencies and sole DDL freeze; verify restore and current strict pre-guard; review exact package/manifest/payload hashes; name exact web and scheduler artifacts separately; attach full post-release contracts, fresh-role/provider/UC receipts and signed business scope. Pause competing triggers/dispatch first. Never activate the four pending sends or fourteen analysis jobs as a blanket release step.

Web remains last-observed `aa5d3cb / dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`; scheduler artifact is `not_verified`, and recorded Sep30 ticks are stale. Both artifacts must independently match one approved release contract. Main `gitDeploymentEnabled=false` means automatic main deployment is disabled; it does not prove a production candidate was promoted or a scheduler ran.

Rollback retains uncertain attempts, data and additive schema. Restore only a reviewed compatible patched build/configuration; committed DB changes use a reviewed forward fix. Hosted restore needs an approved write pause, exact backup/target and data-loss window. Read-only/offline parser success, config presence, local mocks, manual ticks and CI success cannot change this NO_GO decision.

## Fresh review closeout

One fresh whole-branch reviewer found no Critical and two Important R02 defects. Actual restricted-role and security-definer fixtures both demonstrated tenant count 1→2 without the old fingerprint changing. The single fix pass added seven meaningful database regressions: the complete catalog file is 9/9 PASS; unfiltered explicit Node22.23.3 / PG18.6 suite is 237 files / 2245 PASS / 0 fail / 0 skip. npm lint is 0 errors with one pre-existing warning; typecheck passes. V3 real dump/restore, catalog refusal, forced transaction rollback and repeat refusal passed, retaining 82 original tables' rows and all 66 ledger rows, ending with 94 tables and one separate receipt.

Receipts: [review verification](evidence/2026-10-03-r02-review-verification.json), [owner verification](evidence/2026-10-03-r02-owner-verification.json), [final rehearsal](evidence/2026-10-03-r02-historical-rehearsal-v3.json). The initial full-suite result (2243 pass / 1 existing NAR child parent timeout), unchanged isolated child PASS and complete subsequent 2244/2245 PASS runs are preserved; no timeout or CI gate was relaxed. The Windows Bun-shell lint path error and successful unchanged npm gate are also retained.

Baseline PR122 and R00 PR123 were normally merged after reviewed exact-head CI SUCCESS; main R00 CI37105773083 also passed on both Node runtimes (235 files / 2214 tests and 12 demo browser cases each). Final source/runtime-document checks remain attached to their exact PR heads; normal integration requires green checks. PR124 stays a draft dedicated old-schema security candidate because genuine same-schema runtime evidence and formal promotion authority remain absent. It must not downgrade current main or carry the full main schema into the maintenance base.

Deferred Minor: the rehearsal receipt's historical `source_baseline` does not separately record the executing revision/source hashes inside that receipt. Existing receipts are preserved; the separate verification receipts provide source-file hashes for this local delivery.
