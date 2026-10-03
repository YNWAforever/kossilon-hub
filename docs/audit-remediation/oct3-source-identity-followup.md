# R02 follow-up: rehearsal executing source identity

Spec: Oct3 implementation plan R02/F01/F17, current-version build/environment/hash evidence. Continue the committed Oct3 execution ledger; do not repeat completed R00–R11 local work.

## Task 1: Bind a new rehearsal receipt to the executing source

- Preserve historical `source_baseline`, historical Git provenance, frozen SQL/manifest, original ledger and v1/v2/v3 receipts.
- RED: real temporary Git repositories must distinguish HEAD/tree from staged, unstaged and untracked executing bytes. A difference between start/end source or HEAD snapshots must refuse a success receipt.
- Add a small offline collector recording full commit/tree, clean/dirty worktree state, SHA256 of explicitly listed execution source/inputs/locks, Node version/platform/architecture. It is not a resolved dependency SBOM or release approval.
- Capture before local database work; compare execution bytes and HEAD/tree again before writing the immutable receipt. Unrelated evidence generated during the run may change worktree state without changing execution identity.
- Fresh review fix: refuse a foreign working directory before capture or DB work, so cwd-relative inputs and Git reads are bound to the same repository. Snapshot comparison is not continuous mutation detection or an atomic filesystem snapshot.
- GREEN: source contracts, npm lint/typecheck, full existing suite with owned PG18; produce a new v4 real dump/restore/rollback/repeat-refusal rehearsal.
- Commit the code before the final v4 run so it identifies committed executing code. Commit the resulting receipt and tracker/evidence delta separately.

Expected: all local tests pass with actual counts; 82 original tables and 66 ledger rows preserved, 94 post-release tables and one separate receipt; no hosted writes; unchanged historical package hashes.

## Review focus

Staged/untracked bytes, mid-run source/commit drift, path traversal, incomplete execution input inventory, Git absence, dirty-worktree claims, old receipts remaining immutable. Confirm the source snapshot cannot masquerade as hosted approval or provider verification.

Runtime and release gates remain governed by r03-staging-acceptance.md. Standing green-PR normal merge authority applies; it does not authorize production deployment.
