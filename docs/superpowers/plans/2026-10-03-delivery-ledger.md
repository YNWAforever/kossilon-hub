# B09: reconcile the verified delivery ledger

Spec: the October audit assignment requires maintained status, environment and UAT
evidence, preservation of all original acceptance cases, honest runtime blockers,
and normal green-only source integration. This task changes documentation only.

Baseline: implementation merge f07e8226c8575730f5f92fab45c4d2821484e04c,
PR119, exact completed main CI37061430788. The current status header still names
73d999f as current; the environment Source row still requires merging PR102;
finding coverage still treats B08 review/CI as pending. These statements no longer
describe the observed implementation checkpoint.

## Continuation after the security prerequisite

The first document head c6fddb9 is preserved. Its CI37088145785 failed both
unchanged Bun audit steps on the newly indexed braces advisory before tests.
B10/PR121 subsequently removed the vulnerable legacy tagger path through the
supported wrapper2.7.2, without weakening audits or age guards. It was normally
merged as dba55b8a5259b613ff3f4244aed2660d954f586f; exact source/main complete
CI and the sole fresh review passed. B09 now normally integrates that main,
retaining its published commit and failed raw receipt, and updates the dated
implementation checkpoint to dba55b8. The earlier B08 checkpoint and deferred
minor remain historical evidence. Documentation-only scope is measured against
this new completed base; B10 dependency edits are inherited, not reimplemented.
New B09 exact-head CI/review and postmerge verification remain mandatory.

During this local refresh, the metadata producer's default JSON date conversion
and culture string parse corrupted Oct03/HK time. The raw GET was correct. The
exact raw UTC/HK offset contract failed first, then passed after DateKind String
and invariant roundtrip parsing. Rejected outputs and RED/GREEN hashes are retained
in the checkpoint; the raw observation snapshot is immutable so a later closing
GET cannot invalidate it. This correction changes local evidence, not runtime.

## Interfaces and global constraints

status.md, environment-matrix.md and finding-coverage.md consume the same verified
source/main CI, dated provider metadata and unchanged original UAT CSV. Preserve
all dated historical entries. Identify f07e822 as an implementation checkpoint,
not a promise that subsequent documentation-only main commits have the same SHA.
Source verification, provider presence, actual runtime acceptance and production
release remain distinct. No src/scripts/CI/dependency/migration/runtime edits;
no original UAT edits; no provider/DB/env/deploy/send/invite/grant writes.

## Task 1: reconcile actual delivery evidence

1. Reproduce the three stale current/pending statements by reading the baseline
   files; fresh read-only main and complete CI must match the implementation SHA.
   Expected: old current73d999f / pendingPR102 / pendingB08 statements observed;
   actual remote mainf07e822 and complete SUCCESS both runtime legs.
2. Verify saved B08 source/main raw-log hashes and select only safe receipt fields;
   refresh project/production alias with authenticated GET only. Preserve source
   50 versus last-observed production66 and all unknown provider/runtime facts.
   Expected: receipts agree on parents/tree/counts; no secrets or business rows.
3. Correct only current overview/matrix/coverage statements and add a dated,
   reviewable checkpoint with command/result/hash/environment evidence. Preserve
   original50UAT byte hash and all historical body entries.
   Expected: latest completed implementation gates explicit, not production PASS.
4. Validate diff scope, references/hashes, originalUAT counts/hash and whitespace;
   commit normal documentation changes, push and create draft PR.
   Expected: only docs paths changed, UAT19LOCALONLYpass/31blocked, diff-check0.
5. Run the unchanged complete CI on the exact document head. After full workflow
   success, official completion gate revalidates counts/all steps/head/evidence.
   Expected: mandatory LinuxNode22/24 realPG17 full suites and browsers pass;
   every original gate retained. No new mirror tests for this reversible doc edit.
6. Obtain the sole fresh whole-branch review, record all rulings/deferred minors,
   archive own scratch and normal-merge only exact reviewed all-green head.
   Expected: actual merged-main CI and independent live metadata recorded later
   in the PR; no forward-looking success claim in the committed checkpoint.

Task completion command: the owned PowerShell gate checks the exact complete
source workflow, unchanged docs-only scope and originalUAT, raw receipts/hash
bindings, safe deployment observation, checkpoint references and diff --check.

## Review Focus

Historical versus current facts; implementation SHA versus future documentation
head; raw-log hash provenance and fresh read-only observations; source50 versus
last-observed production66; local-only UAT versus real provider acceptance; current
code_verified classification versus historical baseline finding classifications;
all original acceptance cases/production boundaries preserved; no secret values,
new runtime settings, speculative provider APIs or retrospective GREEN claims.
