# R01 F25 follow-up execution

Spec: docs/superpowers/specs/2026-10-09-r01-f25-maintenance.md.

## Task1 — baseline, minimal dependency fix and compatibility

Interface: exact d8c9312 source/locks -> native patched locks; Task2 consumes those identical inputs.
1. Read actual branch instructions/CI; record aa5 lineage, migration/source hashes; run both baseline audits and fresh Bun-installed ten real-package regressions. Expected: three advisories; meaningful security failures with functional DOCX/LRU positive controls.
2. Apply only the three security overrides and existing driver peer declaration; regenerate both locks. Expected: audits0; DOCX/security/LRU10/10 on actual fresh npm and Bun trees; no schema/auth/domain changes.
3. Run a complete fresh local PG18 fixture suite, lint/typecheck/build and unchanged gates. Expected: actual counts/skips; cleanup exact-owned resources; no genuine provider acceptance. Commit small source/spec/plan changes.

## Task2 — evidence, one review and draft PR

1. Write exact hashes/commands/counts, release/rollback and external owner inputs. Expected: R01 maintenance candidate preserves the approved schema boundary; runtime NO_GO explicit.
2. One fresh whole-branch reviewer; one RED→GREEN fix pass for Critical/Important only; minors deferred. Expected: local complete suite green.
3. Push isolated draft PR against codex/oct3-live-security-base, attach it and run all existing exact-head CI. Expected: concrete candidate/CI receipt, no main merge/production promotion. Keep worktree for review.

Pre-flight: both tasks consume identical manifest/locks and schema hash; do not cherry-pick the main branch's whole lock or schema. Runtime/production acceptance is never inferred from CI.
