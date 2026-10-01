# Payment evidence release — candidate 0070

## Scope and deployment order

`0070_payment_evidence_entries.sql` adds attributable receipt entries and indexes. It does not change invoice amounts, existing payment statuses/dates, document versions or migration history. An old `Payment received` label without current attributable receipt entries supplies no readiness credit. Finance remains a business persona mapped to existing authorized staff roles.

Production application is **not authorized** for this candidate. Target inventory remains Neon `red-morning-00331124 / br-muddy-mountain-aov8bbku / neondb`, current Web `aa5d3cb`. Resolve historical 0034 ledger/physical drift and review the complete 0067–0070 release sequence before any DDL; do not replay the old integration branch or edit recorded hashes.

1. Release owner records the exact build, migration hashes, target identity and current read-only schema report.
2. DB owner creates and verifies a recoverable snapshot, then rehearses the reviewed migration sequence on an isolated populated restore. Compare invoice/payment/document/version/audit counts and values before/after. The only expected new payment object is an empty evidence table and its indexes; historical amounts/dates/statuses remain identical.
3. Apply approved DDL in the migration runner transaction before enabling this application build. Unique indexes/FKs may take locks; abort on preflight/hash/physical drift, and keep the old deployment available.
4. Verify actual authorized private object/scan bytes and fresh-role login with controlled samples before pilot acceptance. Local injected scanner contracts do not satisfy this step. No external messages are involved in the payment commands.

## Business commands

Record only the amount and actual receipt date observed in the current proof. Neither invoice amount nor calendar import supplies a receipt. Recording is distinct from approving. Every command binds case/payment/document/current proof version and the preview source token, rechecks server authorization, and writes changes/audit in one transaction. A conflict returns HTTP409; refresh and review the new source, never blindly retry.

Approval credits only the exact current scanned bytes and attributed business review. Partial credit keeps the invoice pending and the balance visible. A repeated current version or active duplicate SHA256 cannot create more credit. Rejection needs a reason code and concrete text; preserve the rejected entry and submit an additive replacement. Superseded evidence supplies no credit. A generic document verification is not a payment amount/date approval.

## Rollback and reconciliation

- Failed migration transactions roll back without altering the ledger. Do not manually insert migration IDs or hashes.
- For an application rollback, disable new payment writes and retain `payment_evidence_entries`, versions and audits. Never drop populated receipt history or rewrite payments to match old UI assumptions. An old application that can infer full payment from document verification is unsuitable as a payment-write rollback target; keep payment writes unavailable until the fixed build is restored.
- A DB restore requires explicit approval and a recovery plan that preserves all post-snapshot receipts, documents and audit records. Compare values and reconcile actual evidence before reopening writes. Do not reset or reseed production.

## Local evidence

Postgres17 `localhost:55441/kossilon_pr02_ci` only. The integration test uses attributable synthetic fixtures, actual transactions, two different backend PIDs and observed lock contention. It checks partial credit, duplicate proof, reasoned return/replacement, stale V1/V2, concurrent review and atomic audit. Synthetic provider verdicts are explicitly labelled and rolled back or deleted by exact fixture IDs. Production R2/scanner/Auth UAT remains blocked with the storage/security/Auth owners.
