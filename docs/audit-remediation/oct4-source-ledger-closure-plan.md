# R11 source-delivery ledger closure

**Spec:** oct3-execution-plan.md Task12 and the user requirement to retain exact
source/CI receipts independently of runtime and original UAT. Continue from
main360dc756cbadfd732de1d95aab5b643e42e87989. R10 PR136 and R03 PR137 were
normally merged after every exact-head check passed; their independent main CI
passed. The tracker still carries publication-pending language. Do not repeat
the implementations or promote their local/CI evidence to genuine acceptance.

## Task 1: close the completed source gates

**Interfaces:** consumes retained public exact-head/main CI JSON and logs,
normal Git merge parents and source snapshots; produces a source-only immutable
receipt, append-only reports and exactly two changed tracker records R10/R03.
No new provider payload, pending B1 policy, application or migration code.

Lock the actual receipt contract before edits: PR136 head6c9db0e/main e38a310,
runs37190490404/37191108857, each Node241files2304PASS0FAIL0SKIP+12DEMO;
PR137 head2681abf/main360dc75, runs37197306735/37198190257, each
Node242files2315PASS0FAIL0SKIP+12DEMO. Read every original job/step and per-Node
log summary. Verify exact merge parents and that each merged tree equals its
reviewed head. Expected: every source gate really succeeded; no UAT transition.

Add a new receipt; append status/environment/evidence delta. Update only R10/R03
code_status, delivery/commands/counts/evidence/time/commit fields. Leave actual
executing-code current_build_sha, runtime/release fields and all other physical
records/header unchanged. Preserve every old tracked file except these four
documents, all UAT/migration/lock/CI/evidence bytes, and the unpublished B1 branch.
Expected: source merged/pass; runtime blocked/formalNO_GO; new genuine0.

Run owned byte/hash/CSV/CI verification and the original release verifier.
Expected: exact2 records changed, 10 others byte-identical, all protected files
unchanged; release verifier exit0/NO_GO. This is documents-only: no fresh local
full suite or PG rehearsal is necessary or claimed. Original remote CI gates
remain required for the new publication head and independent normal-merge main.
Commit the report slice, obtain one fresh whole-branch review, record every
finding/ruling, publish a generic source/CI-only draft PR and merge normally only
all exact-head checks green. Pending hosted policy/owner decisions remain pending.

## Review Focus

Wrong SHA/run attribution, missing/failed/skipped steps, combined rather than
per-Node counts, ledger formatting loss outside the two records, overwriting
old evidence, changed execution-source identity, source success mistaken for
genuine runtime/UAT, accidental publication of private provider payload or the
unapproved B1v3 branch, and schema/CI/app changes hidden in a document delivery.
