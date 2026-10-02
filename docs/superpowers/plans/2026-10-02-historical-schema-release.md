# Historical schema release compatibility

Source baseline: main73d999dfa524f273d0c062458cbf780f65630e6c.
Binding spec: the 2026-10-01 implementation pack, T01/T22, and
docs/audit-remediation/schema-reconciliation.md. This is a bounded supplement
to completed T00–T23 local source work, not a restart of the audit.

Observed target: Neon red-morning-00331124 / br-muddy-mountain-aov8bbku /
neondb, production/default/ready. Read-only2026-10-02 catalog:66 ledger IDs,
all recorded hashes unknown;89public tables/1043columns/274indexes/1352constraints;
3companies/14documents/14versions/4pendingoutbox. No dispatch marker.
Historical b87dfbba374add601d6a5fdbf772dd539c73cd88 retains all66 SQL files;
current0074 tries to add the existing nar_import_batches.return_year.

## Global constraints

- Reuse the existing linked worktree and a new codex branch; preserve all histories.
- Provider operations are read-only. SQL writes/recovery/deployment remain separately gated.
- Local reproduction uses only dedicated localhost Postgres17/18 with synthetic rows.
- Unknown historical hashes stay unknown; source hashes are provenance, not applied receipts.
- Published migration bytes remain preserved. Bridge execution records its own actual receipt.
- No automatic replay, fake0034/0074 ledger entry, clean scan/receipt, unknown send retry,
  reset/reseed, table retirement or inferred historical payment/document decision.
- Original50 UAT results/acceptance columns remain unchanged until genuine execution.

### Task 1: Reproduce historical catalog and candidate collisions

Files: existing66 historical SQL at b87; ignored owned rehearsal artifacts;
docs/audit-remediation/evidence/2026-10-02-historical-schema.json.
Interfaces: produce dated source hashes, actual provider physical facts, local catalog
parity and exact candidate failure; Task2 consumes these observations.

1. Preserve the actual read-only catalog and resolve each original ledger ID from git.
2. Execute all66 original SQL files on a new dedicated local database; record only
   locally executed migration receipts. Compare physical columns/indexes/constraints.
3. Add controlled synthetic existing-year/unknown-workflow rows; apply current candidate
   SQL inside a rollback-only transaction and record the first actual collision.
Expected: historical provenance covers66 IDs; applied hashes remain unknown; real
candidate failure is reproduced with no production writes or persistent candidate DDL.

### Task 2: Prepare and verify a guarded release bridge

Files: a reviewed bridge under docs/audit-remediation/, associated actual Postgres
integration contracts, updated status/environment/runbook and exact evidence.
Interfaces: consume Task1's verified legacy definitions; produce a concrete SQL/receipt/
rollback package and explicit per-feature remaining incompatibilities.

1. Write a contract exposing the observed collision against the real candidate artifact.
2. Prepare the smallest additive bridge that validates existing definitions and values,
   retains historic tables/rows/unknowns and records only the SQL actually executed.
3. Prove repeat/refusal/rollback and unchanged rows/ledger on the owned Postgres fixture.
4. Run the existing CI/real Postgres gates; one fresh whole-branch review, then one
   RED/GREEN fix pass if needed. Commit/push/draft PR with actual receipts.
Expected: local contracts pass, source/runtime remain distinct; unresolved mappings or
   genuine provider clone/restore/Auth/provider acceptance retain precise blockers.

Review focus: false equivalence of historic IDs, incompatible existing types/defaults/
constraints, active old workflow/idempotency fences, transaction failure before receipt,
published SQL mutation, local evidence mistaken for provider restore/production readiness.
