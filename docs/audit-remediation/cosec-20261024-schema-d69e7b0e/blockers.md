# Blockers and remaining scope

Release gate: **NO_GO**. Native matrix stays **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Original F01 / R23 / R25 / UC189 / LA27 IDs and historic failures remain intact.

- No approved same-version native application environment, Auth roles or native HTTP acceptance. DB tests use a new disposable PostgreSQL superuser, not production/application-role permission or RLS proof. Existing Operations component tests cover UI access-denial/cache/error recovery with a mock query; no new browser runtime was run.
- No production artifact/SBOM, migration registry, catalog, permissions or current deployment readback. Production SHA `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` is user-supplied historical evidence only.
- The new scheduler guard verifies expected migration IDs and the existing catalog's dispatch marker column/index facts. It does not verify all tables, SQL checksums, execution privileges or concurrent DDL safety. Other application mutation entrypoints are outside this repair. LA27 is not passed.
- Historical/divergent schema remains refused even if a separate diagnostic policy could identify a reviewed compatible artifact. No target/build-bound historical exception is installed or authorized here. Do not rewrite the ledger, add production seed or run a production migration to bypass refusal.
- Refusal intentionally writes no heartbeat to an incompatible target. The HTTP wrapper returns its existing generic 503 and the native hook throws; Operations retains independent read diagnostics. This is not a new successful tick or evidence of scheduler liveness.
- Recovery test injects a no-effect job, verifies real durable claim/finish/heartbeat SQL inside a rolled-back transaction and never promotes `manual` trigger evidence to native proof. No provider/message/payment/filing/storage mutation occurred.
- UC188 native ticks, UC134 approved Hong Kong holiday calendar, UC193 approved backup/restore and all native journeys remain outstanding. A later local continuation can cover UC189 non-scheduler mutation admission separately; this delivery does not claim those entrypoints are guarded.

Rollback candidate: an ordinary new commit reverting the source commit recorded in `source-candidate.json`; retain all evidence and published Git history. No migration or external resource change needs releasing. Both owned tmpfs targets were verified empty/restored before removal; credentials removed. No push, merge or deploy.
