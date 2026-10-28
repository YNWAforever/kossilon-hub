# Kossilon CoSec OS implementation plan

Goal: staff find their next authorized task, keep case context, understand documents/payment/blockers and verify durable outcomes.

Base: `1c57a67213af72bff8d776694e6ed8c986b921db`, branch `codex/cosec-20261023`, isolated checkout `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`.
Run: `cosec-20261023-79d324f0`. User-approved specification: `C:/Users/laich/Documents/kossilon-hub/cosec-input-20261023-79d324f0/Development_Plan.md`.

Architecture: extend the existing repositories and server authorization contracts. Share search predicates between bounded reads and bulk snapshots; retain scan/version/payment/approval guards. Existing correct main repairs receive same-candidate regression coverage. No parallel write ownership overlaps.

## Constraints and evidence

- Local source/tests/docs and proven disposable targets only. No push, merge, deploy, production migration/data/accounts, messages, payments, filing or paid requests.
- Original 35 F / 15 R / 100 UC (UC99–UC198) / 34 LA IDs and historical results remain immutable; new results state their actual layer.
- Before DB client/fixture/migration/cleanup: prove resource identity, port/path mapping, disposability and import side effects. Docker metadata access currently denied; DB/native acceptance remains blocked unless resolved.
- Graph index upload rejected by automatic review; use safe local source inspection, do not retry disclosure.
- Review focus: missing team/inactive actor; proof belonging to an unloaded case; unknown total; search/filter/cursor drift; unsafe file bytes and stale document versions.

## Ordered tasks

- [x] Intake: AGENTS/RTK, exact remote/base/dirty state, current main fetch, preserved worktree inventory, read current audit and scope limits.
- [ ] A / R25.1: source and migration compatibility comparison, security advisory status, candidate rationale and rollback prerequisites (no migration execution).
- [ ] A / R14: regression RED for original three authorization failures; scoped list/get and role matrix; GREEN and denial-before-query.
- [ ] A / R24: getSession/actor failure and bounded recovery tests; truthful sign-in outcomes, safe return and account cache reset.
- [ ] B / R26.1–3: verify existing ID/context, metadata/bytes separation and readiness/closed-state contracts; repair demonstrated gaps only.
- [ ] B / R17: targeted proof-to-case reads, reachable payment pages/debt and server document search; preserve amount/version guards.
- [ ] B / R16 + R28: shared authorized work search/filter SQL, bounded stable cursor pages and URL context; identical bulk predicate.
- [ ] C / R15: authorized cross-business Today read model and clear next steps.
- [ ] C / R19: company overview and safe current-version document entry points.
- [ ] C / R20: scoped existing-case management search/filter/pagination, distinguish create picker.
- [ ] C / R18: unknown-total snapshot, draft-only WhatsApp scope, bounded terminal-aware progress and recoverable failures.
- [ ] C / R21: reachable conversation/message history with stable paging and preserved selection.
- [ ] C / R22 + R26.4: Manager import navigation policy, role/language/recovery and same-candidate maintenance contracts.
- [ ] D / R25.2 + R27: run safe local contracts; only attempt native ticks/providers after verified authorized identity; retain external blockers.
- [ ] E / R23: necessary unit/component, typecheck/lint/build, independent review, exact candidate fingerprints and F→R→UC/LA matrix. Keep production acceptance blocked.
- [ ] Delivery: DELIVERY.md, acceptance-results.csv, release-candidate.json, blockers.md, logs and exact pending checkpoints.

Each repair follows reproduce → minimal root-cause change → focused regression. Final combined checks run after content stabilizes. API/DB/reload and external/provider results are reported separately from unit/component results.


## Final scoped disposition —2026-10-23

Local source/test/document work for A/B/C and safe D/E contracts is complete at e8ecf3fad979adc4321a58eb64a90d0927e175de. Final2464unit,146SQL,21Node,12demo-browser, typecheck/lint/build and184-original integrity passed. R25.1 source/migration comparison is delivered with current production compatibility UNKNOWN/NO_GO; R25.2 heartbeat local repair delivered, native ticks outstanding. R27 provider and R23 native release/UAT remain BLOCKED by concrete prerequisites. Earlier unchecked task boxes describe full acceptance exits, not missing authorized local repairs. The verified disposable target was used only after identity checks, then removed; initial Docker/index refusals and all failed runs remain historical. See DELIVERY.md and blockers.md; no further source work or external action is pending under this bounded authorization.

