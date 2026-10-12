# R13 dependency gate implementation

Spec: docs/superpowers/specs/2026-10-09-r13-dependency-gates.md.

## Task1 — reproduce and patch the actual dependency paths

Interfaces: current main manifest/npm/Bun locks and official advisories -> installed safe graph with actual DOCX compatibility. Task2 consumes the identical patched manifests/locks.

1. Capture exact metadata and failure logs. Fresh npm install and both current audits. Add meaningful upstream security and DOCX API/CLI tests before changing overrides. Expected: audits fail at actual advisories; negative security/obsolete dependency path tests fail while positive DOCX cases pass.
2. Pin only shell-quote1.11.0/source-map-js1.2.2 and replace argparse1's path with argparse2.0.1. Regenerate both locks without wholesale dependency upgrades. Expected: current audits0, new regressions0fail, no sprintf-js in either graph, old formatter and CI unchanged.
3. Run the full suite before claiming Task1 complete; commit reviewable tests/manifest/locks/spec/plan together. Expected: actual counts and preserved bytes recorded.

## Task2 — install/runtime gates, evidence and draft PR

1. Exercise fresh npm and Bun installations, npm-installed lint/typecheck, actual disposable PG18 migrations/reference seed/full suite, build and offline release gates. Expected: actual results incl skips; no genuine runtime/provider acceptance.
2. Append current baseline delta (PR124 merged to security-base, main/production unchanged; PR142 audit failure), environment/status and new R13/F25 row without renumbering original tasks/UAT. Record exact commands/log hashes and rollback/release boundaries.
3. One fresh whole-slice review. Critical/Important get one RED/GREEN fix pass; minors recorded. Push the isolated branch and create a draft PR. Watch unchanged CI; do not merge while any gate fails, and do not infer deployment authority. Expected: concrete PR and exact-head CI receipt or precise remaining blocker.

Pre-flight: Task1 installs and Task2 gates must use the same pins and hashes; independent production candidate may reuse the minimal dependency-only commit after separate compatibility proof, never merge the entire main branch into it.
