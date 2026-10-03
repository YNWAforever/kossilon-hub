# R02 source identity execution review

Plan: oct3-source-identity-followup.md. PR127. Original Oct3 completed-task ledger remains in oct3-execution-review.md.

Local code 8e9eeab8c9f466c79b8f2c31fe679e885dabee42; final238files2252PASS0skip; v5 actual PG18 restore/rollback/refusals PASS. CI/normal merge exact-head outcome remains a separate GitHub delivery receipt. Formal NO_GO; no hosted writes. All rulings and review findings below are preserved before scoped scratch cleanup.

# SDD ledger — plan: docs/audit-remediation/oct3-source-identity-followup.md
Pre-flight: no shared interfaces between tasks; one bounded R02 follow-up, committed Oct3 ledger retained.
Task 1: in-progress; BASE 12fb960da16c577d9aeb8da27f5bd9651c0cedae.
Ruling: local reads continue under the user's explicit graph-index refusal — private source transmission is not authorized — discovery may take longer.
Ruling: reuse the clean linked worktree on a new branch from latest main — no other edits exist and no new worktree is needed — branch ancestry must remain normal.
Task 1: source contract RED6fail → GREEN6pass; old v3 receipt independently reproduces missing execution_source (assertion exit1). npm lint0errors/1existingwarning; project and script typecheck0. Full PG18 suite in progress. Production read-only technical-role66ledger/4pending/14docs; initial SELECT used nonexistent notifications table and was corrected from actual pg_tables inventory; no writes.
Task 1: full suite encountered unchanged NAR failed-child parent timeout (30080ms). Keep first run evidence. Investigate child boot/cleanup and rerun isolated only after the serialized DB project closes; no timeout/config change authorized or applied.
Task 1: default full suite actual238files2250PASS1unchangedNARtimeout0skip; isolated unchanged timeout parent1PASS12.73s. Local hardware12logicalCPU/31.7GBRAM but1.56GBfree at observation. Ruling: rerun every test with local maxWorkers=4 to test resource sensitivity — no assertions/timeouts/DB serialization/CI gates are changed — cost if wrong: scheduling-dependent defects still require default CI proof. Resource causality is a hypothesis, not established root cause.
Task 1: bounded full PG18 suite238files2251PASS0fail0skip; source commit 844cc685c33d7ac15effb6659c78e140d241f896. First default timeout and isolated PASS retained; resource causality not proven.
Task 1: v4 actual PG18 restore/catalog refusal/transaction rollback/repeat refusal PASS; executing source 844cc685c33d7ac15effb6659c78e140d241f896, clean at start,28input hashes;82 originaltables66ledger preserved/94finaltables1receipt; hosted writes0. Source verification receipt and tracker now record actual2251PASS and original failed run.
Task 1: complete (commits 12fb960..1cebb79, tests: C:\Users\laich\Documents\kossilon-hub\audit-t03-readiness-worktree\.worktrees\node22-runtime\node-v22.23.3-win-x64\node.exe node_modules/vitest/vitest.mjs run scripts/rehearsal-source-identity.test.ts →    Duration  8.23s (transform 90ms, setup 0ms, import 175ms, tests 6.54s, environment 0ms))
Final review: fresh-context GPT-6.1 Sol; Critical0/Important1/Minor0. Important: module-root identity hashes can differ from cwd-relative consumed JSON/Git inputs; one RED→GREEN fix pass required, fail cwd realpath before capture/DB.
Final: Ruling: installed dependencies/binaries/SBOM remain separate external artifact evidence — selected local byte hashes are explicitly scoped — cost if wrong: provenance is overstated as runtime integrity.
Final: Ruling: hosted restore/restricted role/owners/freeze/external approval remain owner gates — no hosted input or authority supplied — cost if wrong: unsafe release acceptance.
Final: Ruling: Auth/provider/UAT/scheduler artifact stay blocked — no genuine acceptance claimed — cost if wrong: false business PASS.
Final: Ruling: NAR timeout causality remains unproven — failed default run and isolated/bounded results retained; original CI required — cost if wrong: scheduling-sensitive failure remains unresolved.
Final: Ruling: before/after comparisons detect persistent drift, not reverted edits or HEAD movement — local snapshot contract is explicit — cost if wrong: transient mutation is missed.
Final: Ruling: final capture/write is not an atomic filesystem snapshot — external DDL/source freeze and immutable artifact controls remain separate — cost if wrong: concurrent last-interval modification is missed.
Final: Ruling: clean state is ordinary Git status, excluding ignored files/index suppression semantics — selected execution bytes are independently hashed — cost if wrong: clean may be mistaken for whole runtime integrity.
Final: Ruling: unchanged compiler/catalog/migrator/product implementation is retained — range contains only source-provenance follow-up — cost if wrong: existing defect is not rediscovered here.
Final: Ruling: reviewer uses saved provider observations; primary refreshed GET/SELECT at08:26/08:28UTC — no provider mutations — cost if wrong: later live drift awaits a fresh observation.
Final: no deferred minors.
Final fix pass: foreign-root CLI contract RED1fail6PASS→GREEN7PASS. Full238files2251PASS1newDB-registry-convention-fail0skip; preserve evidence. Ruling: register the DB-URL subprocess suite in the existing serialized project — the existing marker rule is conservative even for a port1 refusal probe — cost if wrong: seven pure-source checks add sequential runtime; no gate weakened.
Final: fixed Important foreign-cwd input/hash mismatch — real-script foreign cwd RED1fail6PASS→GREEN7PASS; registry RED→GREEN9tests; full238files2252PASS0fail0skip, npm lint/type/script-type0. Commit 8e9eeab8c9f466c79b8f2c31fe679e885dabee42. No second reviewer; one fix pass complete.

Final: v5 actualPG18 PASS on clean8e9eeab with28inputs; source before/after snapshots are limited as declared.
Final: Ruling: standing user normal merge-if-all-green authority replaces the finishing menu — source PR127 stays gated on final exact-head CI/review and production hold — cost if wrong: source publication needs a normal revert; no production authority is inferred.
